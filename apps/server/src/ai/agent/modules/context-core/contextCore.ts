import type {
  AssistantCompletionReason,
  AssistantOutputChannel,
  BookmarkSummary,
  BranchRuntimeState,
  BranchViewModel,
  ContextNodeKind,
  ProviderPayloadItem,
  ToolActivityView,
  TranscriptMessage,
} from "@magick/contracts/chat";
import type { ProviderKey } from "@magick/contracts/provider";
import type { DatabaseClient } from "../../../../persistence/database";
import {
  InvalidStateError,
  NotFoundError,
  PersistenceError,
} from "../../shared/errors";
import type { ClockService, IdGeneratorService } from "../../shared/runtime";
import type {
  ContextCoreInterface,
  ProviderPayload,
} from "./contextCoreInterface";

type ContextNodeStatus =
  | "streaming"
  | "complete"
  | "interrupted"
  | "failed"
  | null;

type ContextNodeRow = {
  id: string;
  parent_id: string | null;
  kind: ContextNodeKind;
  sequence: number;
  provider_key: ProviderKey | null;
  payload_json: string;
  status: ContextNodeStatus;
  created_at: string;
  updated_at: string;
};

type BookmarkRow = {
  id: string;
  provider_key: ProviderKey;
  title: string;
  target_node_id: string;
  created_at: string;
  updated_at: string;
};

type UserMessagePayload = {
  readonly messageId: string;
  readonly content: string;
};

type AssistantMessagePayload = {
  readonly turnId: string;
  readonly messageId: string;
  readonly channel: AssistantOutputChannel;
  readonly content: string;
  readonly reason: AssistantCompletionReason | null;
};

type ToolCallPayload = {
  readonly turnId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly title: string;
  readonly argsPreview: string | null;
  readonly input: unknown;
  readonly path: string | null;
  readonly url: string | null;
};

type ToolResultPayload = {
  readonly turnId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: "completed" | "failed";
  readonly resultPreview: string | null;
  readonly modelOutput: string;
  readonly path: string | null;
  readonly url: string | null;
  readonly diff: ToolActivityView["diff"];
  readonly error: string | null;
};

interface BookmarkRuntimeState {
  readonly runtimeState: BranchRuntimeState;
  readonly activeTurnId: string | null;
  readonly lastError: string | null;
}

export class ContextCore implements ContextCoreInterface {
  readonly #database: DatabaseClient;
  readonly #clock: ClockService;
  readonly #idGenerator: IdGeneratorService;
  readonly #runtimeByBookmark = new Map<string, BookmarkRuntimeState>();

  constructor(args: {
    readonly database: DatabaseClient;
    readonly clock: ClockService;
    readonly idGenerator: IdGeneratorService;
  }) {
    this.#database = args.database;
    this.#clock = args.clock;
    this.#idGenerator = args.idGenerator;
  }

  bootstrap(input: { readonly instructions: string }): void {
    try {
      const now = this.#clock.now();
      const root = this.#database
        .prepare("SELECT id FROM context_nodes WHERE kind = 'root' LIMIT 1")
        .get() as { id: string } | undefined;

      if (!root) {
        const rootId = this.#idGenerator.next("node");
        this.#insertNode({
          id: rootId,
          parentId: null,
          kind: "root",
          providerKey: null,
          payload: {},
          status: null,
          now,
        });
        this.#insertNode({
          id: this.#idGenerator.next("node"),
          parentId: rootId,
          kind: "system_prompt",
          providerKey: null,
          payload: { content: input.instructions },
          status: "complete",
          now,
        });
        return;
      }

      this.#database
        .prepare(
          `
            UPDATE context_nodes
            SET payload_json = ?, updated_at = ?
            WHERE kind = 'system_prompt'
          `,
        )
        .run(JSON.stringify({ content: input.instructions }), now);
    } catch (error) {
      throw new PersistenceError({
        operation: "context_core.bootstrap",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  listBookmarks(): readonly BookmarkSummary[] {
    const rows = this.#database
      .prepare(
        `
          SELECT id, provider_key, title, target_node_id, created_at, updated_at
          FROM bookmarks
          ORDER BY updated_at DESC
        `,
      )
      .all() as BookmarkRow[];

    return rows.map((row) => ({
      bookmarkId: row.id,
      providerKey: row.provider_key,
      title: row.title,
      runtimeState: this.#readRuntime(row.id).runtimeState,
      latestActivityAt: row.updated_at,
      updatedAt: row.updated_at,
    }));
  }

  createBookmark(input: {
    readonly providerKey: ProviderKey;
    readonly title?: string;
  }): BranchViewModel {
    const now = this.#clock.now();
    const bookmarkId = this.#idGenerator.next("bookmark");
    const targetNodeId = this.#requireTrunkTail().id;
    this.#database
      .prepare(
        `
          INSERT INTO bookmarks (id, provider_key, title, target_node_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        bookmarkId,
        input.providerKey,
        input.title?.trim() || "New chat",
        targetNodeId,
        now,
        now,
      );

    return this.buildBranchView({ bookmarkId });
  }

  selectBookmark(input: { readonly bookmarkId: string }): BranchViewModel {
    return this.buildBranchView(input);
  }

  renameBookmark(input: {
    readonly bookmarkId: string;
    readonly title: string;
  }): BranchViewModel {
    const title = input.title.trim();
    if (!title) {
      throw new InvalidStateError({
        code: "bookmark_title_required",
        detail: "Bookmark title cannot be empty.",
      });
    }

    const result = this.#database
      .prepare("UPDATE bookmarks SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, this.#clock.now(), input.bookmarkId);
    if (result.changes === 0) {
      throw new NotFoundError({ entity: "bookmark", id: input.bookmarkId });
    }

    return this.buildBranchView({ bookmarkId: input.bookmarkId });
  }

  deleteBookmark(input: { readonly bookmarkId: string }): void {
    const deleteBookmark = this.#database.transaction((bookmarkId: string) => {
      const bookmark = this.#requireBookmark(bookmarkId);
      this.#database
        .prepare("DELETE FROM bookmarks WHERE id = ?")
        .run(bookmarkId);
      this.#runtimeByBookmark.delete(bookmarkId);
      this.#pruneFromLeaf(bookmark.target_node_id);
    });

    deleteBookmark(input.bookmarkId);
  }

  appendUserMessage(input: {
    readonly bookmarkId: string;
    readonly messageId: string;
    readonly content: string;
  }): BranchViewModel {
    return this.#appendNodeAndAdvance({
      bookmarkId: input.bookmarkId,
      kind: "user_message",
      payload: { messageId: input.messageId, content: input.content },
      status: "complete",
    });
  }

  beginAssistantMessage(input: {
    readonly bookmarkId: string;
    readonly turnId: string;
    readonly messageId: string;
    readonly channel: AssistantOutputChannel;
  }): BranchViewModel {
    return this.#appendNodeAndAdvance({
      bookmarkId: input.bookmarkId,
      kind: "assistant_message",
      payload: {
        turnId: input.turnId,
        messageId: input.messageId,
        channel: input.channel,
        content: "",
        reason: null,
      } satisfies AssistantMessagePayload,
      status: "streaming",
    });
  }

  appendAssistantDelta(input: {
    readonly bookmarkId: string;
    readonly messageId: string;
    readonly delta: string;
  }): BranchViewModel {
    const node = this.#findAssistantMessageNode(
      input.bookmarkId,
      input.messageId,
    );
    if (node.status !== "streaming") {
      throw new InvalidStateError({
        code: "assistant_message_not_streaming",
        detail: `Assistant message node '${node.id}' is not streaming.`,
      });
    }

    const payload = this.#parsePayload<AssistantMessagePayload>(node);
    this.#database
      .prepare(
        "UPDATE context_nodes SET payload_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        JSON.stringify({
          ...payload,
          content: `${payload.content}${input.delta}`,
        }),
        this.#clock.now(),
        node.id,
      );
    this.#touchBookmark(input.bookmarkId);
    return this.buildBranchView({ bookmarkId: input.bookmarkId });
  }

  completeAssistantMessage(input: {
    readonly bookmarkId: string;
    readonly messageId: string;
    readonly reason: AssistantCompletionReason;
  }): BranchViewModel {
    const node = this.#findAssistantMessageNode(
      input.bookmarkId,
      input.messageId,
    );
    const payload = this.#parsePayload<AssistantMessagePayload>(node);
    this.#database
      .prepare(
        "UPDATE context_nodes SET payload_json = ?, status = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        JSON.stringify({ ...payload, reason: input.reason }),
        input.reason === "incomplete" ? "streaming" : "complete",
        this.#clock.now(),
        node.id,
      );
    this.#touchBookmark(input.bookmarkId);
    return this.buildBranchView({ bookmarkId: input.bookmarkId });
  }

  appendToolCall(input: {
    readonly bookmarkId: string;
    readonly turnId: string;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly title: string;
    readonly argsPreview: string | null;
    readonly input: unknown;
    readonly path: string | null;
    readonly url: string | null;
  }): BranchViewModel {
    return this.#appendNodeAndAdvance({
      bookmarkId: input.bookmarkId,
      kind: "tool_call",
      payload: {
        turnId: input.turnId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        title: input.title,
        argsPreview: input.argsPreview,
        input: input.input,
        path: input.path,
        url: input.url,
      } satisfies ToolCallPayload,
      status: "complete",
    });
  }

  appendToolResult(input: {
    readonly bookmarkId: string;
    readonly turnId: string;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly status: "completed" | "failed";
    readonly resultPreview: string | null;
    readonly modelOutput: string;
    readonly path: string | null;
    readonly url: string | null;
    readonly diff: ToolActivityView["diff"];
    readonly error: string | null;
  }): BranchViewModel {
    return this.#appendNodeAndAdvance({
      bookmarkId: input.bookmarkId,
      kind: "tool_result",
      payload: input satisfies ToolResultPayload,
      status: input.status === "failed" ? "failed" : "complete",
    });
  }

  setBookmarkRuntimeState(input: {
    readonly bookmarkId: string;
    readonly runtimeState: BranchRuntimeState;
    readonly activeTurnId: string | null;
    readonly lastError?: string | null;
  }): BranchViewModel {
    this.#requireBookmark(input.bookmarkId);
    this.#runtimeByBookmark.set(input.bookmarkId, {
      runtimeState: input.runtimeState,
      activeTurnId: input.activeTurnId,
      lastError: input.lastError ?? null,
    });
    return this.buildBranchView({ bookmarkId: input.bookmarkId });
  }

  buildBranchView(input: { readonly bookmarkId: string }): BranchViewModel {
    const bookmark = this.#requireBookmark(input.bookmarkId);
    const path = this.#walkBranch(bookmark.target_node_id);
    const messages: TranscriptMessage[] = [];
    const toolActivities = new Map<string, ToolActivityView>();

    for (const node of path) {
      if (node.kind === "user_message") {
        const payload = this.#parsePayload<UserMessagePayload>(node);
        messages.push({
          id: payload.messageId,
          role: "user",
          channel: null,
          content: payload.content,
          createdAt: node.created_at,
          status: "complete",
        });
      }

      if (node.kind === "assistant_message") {
        const payload = this.#parsePayload<AssistantMessagePayload>(node);
        messages.push({
          id: payload.messageId,
          role: "assistant",
          channel: payload.channel,
          content: payload.content,
          createdAt: node.created_at,
          status:
            node.status === "failed" || node.status === "interrupted"
              ? node.status
              : node.status === "streaming"
                ? "streaming"
                : "complete",
          reason: payload.reason,
        });
      }

      if (node.kind === "tool_call") {
        const payload = this.#parsePayload<ToolCallPayload>(node);
        toolActivities.set(payload.toolCallId, {
          turnId: payload.turnId,
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          title: payload.title,
          status: "requested",
          argsPreview: payload.argsPreview,
          resultPreview: null,
          path: payload.path,
          url: payload.url,
          diff: null,
          error: null,
          createdAt: node.created_at,
          updatedAt: node.updated_at,
        });
      }

      if (node.kind === "tool_result") {
        const payload = this.#parsePayload<ToolResultPayload>(node);
        const existing = toolActivities.get(payload.toolCallId);
        toolActivities.set(payload.toolCallId, {
          turnId: payload.turnId,
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          title: existing?.title ?? payload.toolName,
          status: payload.status,
          argsPreview: existing?.argsPreview ?? null,
          resultPreview: payload.resultPreview,
          path: payload.path ?? existing?.path ?? null,
          url: payload.url ?? existing?.url ?? null,
          diff: payload.diff,
          error: payload.error,
          createdAt: existing?.createdAt ?? node.created_at,
          updatedAt: node.updated_at,
        });
      }
    }

    const runtime = this.#readRuntime(input.bookmarkId);
    const latestActivityAt = path.at(-1)?.updated_at ?? bookmark.updated_at;
    const lastUserMessageAt =
      [...messages].reverse().find((message) => message.role === "user")
        ?.createdAt ?? null;
    const lastAssistantMessageAt =
      [...messages].reverse().find((message) => message.role === "assistant")
        ?.createdAt ?? null;

    return {
      bookmarkId: bookmark.id,
      headNodeId: bookmark.target_node_id,
      providerKey: bookmark.provider_key,
      title: bookmark.title,
      runtimeState: runtime.runtimeState,
      messages,
      toolActivities: [...toolActivities.values()],
      pendingToolApproval: null,
      activeTurnId: runtime.activeTurnId,
      lastError: runtime.lastError,
      lastUserMessageAt,
      lastAssistantMessageAt,
      latestActivityAt,
      updatedAt: bookmark.updated_at,
    };
  }

  buildProviderPayload(input: {
    readonly bookmarkId: string;
  }): ProviderPayload {
    const bookmark = this.#requireBookmark(input.bookmarkId);
    const path = this.#walkBranch(bookmark.target_node_id);
    const instructions = path
      .filter(
        (node) =>
          node.kind === "system_prompt" || node.kind === "global_prompt",
      )
      .map(
        (node) =>
          this.#parsePayload<{ readonly content?: string }>(node).content ?? "",
      )
      .filter(Boolean)
      .join("\n\n");
    const historyItems: ProviderPayloadItem[] = [];

    for (const node of path) {
      if (node.kind === "user_message") {
        const payload = this.#parsePayload<UserMessagePayload>(node);
        historyItems.push({
          type: "message",
          role: "user",
          channel: null,
          content: payload.content,
        });
      }
      if (node.kind === "assistant_message" && node.status !== "streaming") {
        const payload = this.#parsePayload<AssistantMessagePayload>(node);
        historyItems.push({
          type: "message",
          role: "assistant",
          channel: payload.channel,
          content: payload.content,
          ...(payload.reason ? { reason: payload.reason } : {}),
        });
      }
      if (node.kind === "tool_call") {
        const payload = this.#parsePayload<ToolCallPayload>(node);
        historyItems.push({
          type: "tool_call",
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          input: payload.input,
        });
      }
      if (node.kind === "tool_result") {
        const payload = this.#parsePayload<ToolResultPayload>(node);
        historyItems.push({
          type: "tool_result",
          toolCallId: payload.toolCallId,
          output: payload.modelOutput,
        });
      }
    }

    return { instructions, historyItems };
  }

  readonly #appendNodeAndAdvance = (input: {
    readonly bookmarkId: string;
    readonly kind: Exclude<
      ContextNodeKind,
      "root" | "system_prompt" | "global_prompt"
    >;
    readonly payload: unknown;
    readonly status: ContextNodeStatus;
  }): BranchViewModel => {
    const append = this.#database.transaction(() => {
      const bookmark = this.#requireBookmark(input.bookmarkId);
      const now = this.#clock.now();
      const nodeId = this.#idGenerator.next("node");
      this.#insertNode({
        id: nodeId,
        parentId: bookmark.target_node_id,
        kind: input.kind,
        providerKey: bookmark.provider_key,
        payload: input.payload,
        status: input.status,
        now,
      });
      this.#database
        .prepare(
          "UPDATE bookmarks SET target_node_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(nodeId, now, input.bookmarkId);
    });

    append();
    return this.buildBranchView({ bookmarkId: input.bookmarkId });
  };

  #insertNode(input: {
    readonly id: string;
    readonly parentId: string | null;
    readonly kind: ContextNodeKind;
    readonly providerKey: ProviderKey | null;
    readonly payload: unknown;
    readonly status: ContextNodeStatus;
    readonly now: string;
  }): void {
    const sequence = input.parentId
      ? this.#nextChildSequence(input.parentId)
      : 0;
    this.#database
      .prepare(
        `
          INSERT INTO context_nodes (
            id, parent_id, kind, sequence, provider_key, payload_json, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.id,
        input.parentId,
        input.kind,
        sequence,
        input.providerKey,
        JSON.stringify(input.payload),
        input.status,
        input.now,
        input.now,
      );
  }

  #nextChildSequence(parentId: string): number {
    const row = this.#database
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM context_nodes WHERE parent_id = ?",
      )
      .get(parentId) as { next_sequence: number } | undefined;
    return row?.next_sequence ?? 1;
  }

  #requireBookmark(bookmarkId: string): BookmarkRow {
    const row = this.#database
      .prepare(
        "SELECT id, provider_key, title, target_node_id, created_at, updated_at FROM bookmarks WHERE id = ?",
      )
      .get(bookmarkId) as BookmarkRow | undefined;
    if (!row) {
      throw new NotFoundError({ entity: "bookmark", id: bookmarkId });
    }
    return row;
  }

  #requireTrunkTail(): ContextNodeRow {
    const row = this.#database
      .prepare(
        `
          SELECT id, parent_id, kind, sequence, provider_key, payload_json, status, created_at, updated_at
          FROM context_nodes
          WHERE kind IN ('system_prompt', 'global_prompt')
          ORDER BY sequence DESC
          LIMIT 1
        `,
      )
      .get() as ContextNodeRow | undefined;
    if (!row) {
      throw new InvalidStateError({
        code: "context_trunk_missing",
        detail: "Context trunk has not been bootstrapped.",
      });
    }
    return row;
  }

  #findAssistantMessageNode(
    bookmarkId: string,
    messageId: string,
  ): ContextNodeRow {
    const path = this.#walkBranch(
      this.#requireBookmark(bookmarkId).target_node_id,
    );
    const node = path.find((candidate) => {
      if (candidate.kind !== "assistant_message") {
        return false;
      }
      return (
        this.#parsePayload<AssistantMessagePayload>(candidate).messageId ===
        messageId
      );
    });
    if (!node) {
      throw new NotFoundError({
        entity: "assistant_message_node",
        id: messageId,
      });
    }
    return node;
  }

  #walkBranch(targetNodeId: string): readonly ContextNodeRow[] {
    const path: ContextNodeRow[] = [];
    let cursor: string | null = targetNodeId;
    const seen = new Set<string>();

    while (cursor) {
      if (seen.has(cursor)) {
        throw new InvalidStateError({
          code: "context_tree_cycle",
          detail: `Context tree cycle detected at node '${cursor}'.`,
        });
      }
      seen.add(cursor);
      const node = this.#database
        .prepare(
          `
            SELECT id, parent_id, kind, sequence, provider_key, payload_json, status, created_at, updated_at
            FROM context_nodes
            WHERE id = ?
          `,
        )
        .get(cursor) as ContextNodeRow | undefined;
      if (!node) {
        throw new NotFoundError({ entity: "context_node", id: cursor });
      }
      path.push(node);
      cursor = node.parent_id;
    }

    return path.reverse();
  }

  #parsePayload<TPayload>(node: ContextNodeRow): TPayload {
    return JSON.parse(node.payload_json) as TPayload;
  }

  #touchBookmark(bookmarkId: string): void {
    this.#database
      .prepare("UPDATE bookmarks SET updated_at = ? WHERE id = ?")
      .run(this.#clock.now(), bookmarkId);
  }

  #readRuntime(bookmarkId: string): BookmarkRuntimeState {
    return (
      this.#runtimeByBookmark.get(bookmarkId) ?? {
        runtimeState: "idle",
        activeTurnId: null,
        lastError: null,
      }
    );
  }

  #pruneFromLeaf(targetNodeId: string): void {
    let cursor: string | null = targetNodeId;
    while (cursor) {
      const node = this.#database
        .prepare(
          `
            SELECT id, parent_id, kind, sequence, provider_key, payload_json, status, created_at, updated_at
            FROM context_nodes
            WHERE id = ?
          `,
        )
        .get(cursor) as ContextNodeRow | undefined;
      if (!node || this.#isTrunkNode(node)) {
        return;
      }

      const childCount = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM context_nodes WHERE parent_id = ?",
        )
        .get(node.id) as { count: number };
      const bookmarkCount = this.#database
        .prepare(
          "SELECT COUNT(*) AS count FROM bookmarks WHERE target_node_id = ?",
        )
        .get(node.id) as { count: number };
      if (childCount.count > 0 || bookmarkCount.count > 0) {
        return;
      }

      this.#database
        .prepare("DELETE FROM context_nodes WHERE id = ?")
        .run(node.id);
      cursor = node.parent_id;
    }
  }

  #isTrunkNode(node: ContextNodeRow): boolean {
    return (
      node.kind === "root" ||
      node.kind === "system_prompt" ||
      node.kind === "global_prompt"
    );
  }
}
