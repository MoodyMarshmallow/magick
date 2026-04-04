import type {
  CommentMessage,
  CommentThread,
  CommentThreadEvent,
} from "../state/threadProjector";

export interface DocumentBootstrap {
  readonly documentId: string;
  readonly title: string;
  readonly markdown: string;
}

interface MutableCommentMessage {
  id: string;
  author: CommentMessage["author"];
  body: string;
  createdAt: string;
  status: CommentMessage["status"];
}

interface MutableCommentThread {
  threadId: string;
  title: string;
  status: CommentThread["status"];
  runtimeState: CommentThread["runtimeState"];
  updatedAt: string;
  messages: MutableCommentMessage[];
}

interface MutableBootstrap {
  documentId: string;
  title: string;
  markdown: string;
}

interface DemoDocumentSeed {
  readonly documentId: string;
  readonly title: string;
  readonly markdown: string;
}

interface DemoMagickClientState {
  documents: MutableBootstrap[];
  threads: MutableCommentThread[];
}

export interface DemoMagickClientOptions {
  readonly documentId?: string;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly schedule?: (callback: () => void, delayMs: number) => unknown;
  readonly cancelSchedule?: (handle: unknown) => void;
}

export interface DemoMagickClient {
  getDocumentBootstrap: (
    requestedDocumentId: string,
  ) => Promise<DocumentBootstrap>;
  getThreads: () => Promise<readonly CommentThread[]>;
  subscribe: (listener: (event: CommentThreadEvent) => void) => () => void;
  updateDocumentMarkup: (documentId: string, markdown: string) => void;
  createCommentThread: (args: {
    title: string;
    initialMessage: string;
  }) => Promise<CommentThread>;
  sendReply: (args: { threadId: string; body: string }) => Promise<void>;
  toggleResolved: (threadId: string) => Promise<void>;
}

const defaultDocumentId = "doc_everforest_manifesto";

const repeatParagraph = (text: string, count: number): string =>
  Array.from({ length: count }, () => text).join("\n\n");

const demoDocumentSeeds: readonly DemoDocumentSeed[] = [
  {
    documentId: "doc_everforest_manifesto",
    title: "Evergreen Systems Memo",
    markdown:
      "Magick should feel like a calm studio for thinking with AI.\n\nThe best interfaces keep momentum without hiding system state.\n\nUse shared contracts to keep streaming and replay predictable.\n\nWe should treat comments like durable conversations, not disposable UI fragments.",
  },
  {
    documentId: "doc_systems_note",
    title: "Systems Garden Note",
    markdown:
      "Keep duplicate document views synchronized from one shared draft state.\n\nSplits should feel like moving paper around a desk, not launching a new mode.\n\nDrag targets should preview the resulting pane clearly before drop.",
  },
  {
    documentId: "doc_workspace_field_guide",
    title: "Workspace Field Guide",
    markdown: repeatParagraph(
      "A dense workspace only feels calm when panes, tabs, and drag previews all explain themselves immediately.",
      10,
    ),
  },
  {
    documentId: "doc_latency_notebook",
    title: "Latency Notebook",
    markdown: repeatParagraph(
      "Slow saves, reconnects, and replay should never cost the user their latest draft.",
      9,
    ),
  },
  {
    documentId: "doc_layout_observations",
    title: "Layout Observations",
    markdown: repeatParagraph(
      "We should evaluate split affordances by how confidently a user can predict the resulting layout before they release the pointer.",
      8,
    ),
  },
  {
    documentId: "doc_operator_checklist",
    title: "Operator Checklist",
    markdown: repeatParagraph(
      "Every workflow should leave visible clues about what is saved, streaming, selected, and replayable.",
      9,
    ),
  },
  {
    documentId: "doc_inbox_capture",
    title: "Inbox Capture Draft",
    markdown: repeatParagraph(
      "Quick notes become durable assets only when they can move into the same workspace as formal documents without friction.",
      7,
    ),
  },
  {
    documentId: "doc_provider_matrix",
    title: "Provider Matrix",
    markdown: repeatParagraph(
      "Provider-specific transport details belong behind orchestration boundaries so the interface can stay stable.",
      8,
    ),
  },
  {
    documentId: "doc_streaming_playbook",
    title: "Streaming Playbook",
    markdown: repeatParagraph(
      "Streaming UX must be honest about partial state, interruptions, and the exact point where persisted history catches up.",
      10,
    ),
  },
  {
    documentId: "doc_recovery_notes",
    title: "Recovery Notes",
    markdown: repeatParagraph(
      "A local-first client earns trust when restart and replay paths feel boring instead of magical.",
      8,
    ),
  },
  {
    documentId: "doc_scroll_test_alpha",
    title: "Scroll Test Alpha",
    markdown: repeatParagraph(
      "This document exists mostly to make the browser demo tall enough to test scrollbar visibility and hit targets.",
      12,
    ),
  },
  {
    documentId: "doc_scroll_test_beta",
    title: "Scroll Test Beta",
    markdown: repeatParagraph(
      "The demo workspace should contain enough varied content to exercise both tree scrolling and pane scrolling without setup.",
      12,
    ),
  },
] as const;

export const demoDocumentIds = demoDocumentSeeds.map(
  (document) => document.documentId,
);

const longThreadMessages: readonly Omit<MutableCommentMessage, "createdAt">[] =
  Array.from({ length: 28 }, (_, index) => {
    const author: CommentMessage["author"] = index % 2 === 0 ? "human" : "ai";
    return {
      id: `message_long_${index + 1}`,
      author,
      body: `${author === "human" ? "I want the demo thread to overflow so I can test scrolling" : "The chat panel should stay readable even when a thread becomes very long"}. ${repeatParagraph(
        "Keep the line length moderate, preserve rhythm between paragraphs, and make sure the scroller still feels easy to grab.",
        2,
      )}`,
      status: "complete" as const,
    };
  });

const createSeedThreads = (now: () => string): MutableCommentThread[] => {
  const createMessage = (args: {
    id: string;
    author: CommentMessage["author"];
    body: string;
  }): MutableCommentMessage => ({
    id: args.id,
    author: args.author,
    body: args.body,
    createdAt: now(),
    status: "complete",
  });

  return [
    {
      threadId: "thread_seed_1",
      title: "Chat 1",
      status: "open",
      runtimeState: "idle",
      updatedAt: now(),
      messages: [
        createMessage({
          id: "message_seed_1",
          author: "human",
          body: "We should preserve this sentence. It explains why the backend owns recovery semantics.",
        }),
        createMessage({
          id: "message_seed_2",
          author: "ai",
          body: "Agreed. It also clarifies why replay correctness matters more than optimistic transcript tricks.",
        }),
      ],
    },
    {
      threadId: "thread_seed_long",
      title: "Long Scroll Thread",
      status: "open",
      runtimeState: "idle",
      updatedAt: now(),
      messages: longThreadMessages.map((message) => ({
        ...message,
        createdAt: now(),
      })),
    },
    ...Array.from({ length: 14 }, (_, index) => ({
      threadId: `thread_seed_${index + 2}`,
      title: `Chat ${index + 2}`,
      status: index % 5 === 4 ? ("resolved" as const) : ("open" as const),
      runtimeState: "idle" as const,
      updatedAt: now(),
      messages: [
        createMessage({
          id: `message_seed_${index + 3}_a`,
          author: "human",
          body: `Seed note ${index + 2}: verify that the thread ledger scrolls with many conversations available at once.`,
        }),
        createMessage({
          id: `message_seed_${index + 3}_b`,
          author: "ai",
          body: `Acknowledged. Chat ${index + 2} exists mostly as scroll ballast, but it should still read like a plausible conversation.`,
        }),
      ],
    })),
  ];
};

const createInitialState = (
  documentId: string,
  now: () => string,
): DemoMagickClientState => ({
  documents: demoDocumentSeeds.map((document) => ({
    ...document,
    documentId:
      document.documentId === defaultDocumentId
        ? documentId
        : document.documentId,
  })),
  threads: createSeedThreads(now),
});

const clone = <T>(value: T): T => structuredClone(value);

const toPublicThread = (thread: MutableCommentThread): CommentThread => ({
  ...clone(thread),
  messages: thread.messages.map((message) => ({ ...message })),
});

export const createDemoMagickClient = (
  options: DemoMagickClientOptions = {},
): DemoMagickClient => {
  const documentId = options.documentId ?? defaultDocumentId;
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => crypto.randomUUID().slice(0, 8));
  const schedule =
    options.schedule ??
    ((callback: () => void, delayMs: number) =>
      globalThis.setInterval(callback, delayMs));
  const cancelSchedule =
    options.cancelSchedule ??
    ((handle: unknown) => globalThis.clearInterval(handle as number));

  const state = createInitialState(documentId, now);
  const listeners = new Set<(event: CommentThreadEvent) => void>();

  const toPublicBootstrap = (
    requestedDocumentId: string,
  ): DocumentBootstrap => {
    const document = state.documents.find(
      (candidate) => candidate.documentId === requestedDocumentId,
    );
    if (!document) {
      throw new Error(`Document '${requestedDocumentId}' was not found.`);
    }

    return {
      documentId: document.documentId,
      title: document.title,
      markdown: document.markdown,
    };
  };

  const getThreadsSnapshot = (): readonly CommentThread[] =>
    state.threads.map(toPublicThread);

  const emit = (event: CommentThreadEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const findThread = (threadId: string): MutableCommentThread => {
    const thread = state.threads.find(
      (candidate) => candidate.threadId === threadId,
    );
    if (!thread) {
      throw new Error(`Thread '${threadId}' was not found.`);
    }

    return thread;
  };

  const appendAssistantReply = (threadId: string, seed: string): void => {
    const thread = findThread(threadId);
    const messageId = `message_${createId()}`;
    const createdAt = now();
    const streamingMessage: MutableCommentMessage = {
      id: messageId,
      author: "ai",
      body: "",
      createdAt,
      status: "streaming",
    };

    thread.messages = [...thread.messages, streamingMessage];
    thread.updatedAt = createdAt;
    emit({
      type: "message.added",
      threadId,
      message: { ...streamingMessage },
      updatedAt: createdAt,
    });

    const chunks = seed.match(/.{1,32}/g) ?? [seed];
    let index = 0;
    const handle = schedule(() => {
      const nextChunk = chunks[index];
      if (!nextChunk) {
        cancelSchedule(handle);
        const completedAt = now();
        thread.messages = thread.messages.map((message) =>
          message.id === messageId
            ? { ...message, status: "complete" }
            : message,
        );
        thread.updatedAt = completedAt;
        emit({
          type: "message.completed",
          threadId,
          messageId,
          updatedAt: completedAt,
        });
        return;
      }

      thread.messages = thread.messages.map((message) =>
        message.id === messageId
          ? { ...message, body: `${message.body}${nextChunk}` }
          : message,
      );
      const updatedAt = now();
      thread.updatedAt = updatedAt;
      emit({
        type: "message.delta",
        threadId,
        messageId,
        delta: nextChunk,
        updatedAt,
      });
      index += 1;
    }, 140);
  };

  return {
    async getDocumentBootstrap(requestedDocumentId: string) {
      return clone(toPublicBootstrap(requestedDocumentId));
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    updateDocumentMarkup(documentId, markdown) {
      const document = state.documents.find(
        (candidate) => candidate.documentId === documentId,
      );
      if (!document) {
        throw new Error(`Document '${documentId}' was not found.`);
      }

      document.markdown = markdown;
    },

    async createCommentThread(args) {
      const timestamp = now();
      const thread: MutableCommentThread = {
        threadId: `thread_${createId()}`,
        title: args.title,
        status: "open",
        runtimeState: "idle",
        updatedAt: timestamp,
        messages: [
          {
            id: `message_${createId()}`,
            author: "human",
            body: args.initialMessage,
            createdAt: timestamp,
            status: "complete",
          },
        ],
      };

      state.threads = [thread, ...state.threads];
      emit({ type: "thread.created", thread: toPublicThread(thread) });
      appendAssistantReply(
        thread.threadId,
        "I'll treat this as its own chat, so every follow-up stays in the same conversation history.",
      );

      return clone(toPublicThread(thread));
    },

    async sendReply(args) {
      const thread = findThread(args.threadId);
      const message: MutableCommentMessage = {
        id: `message_${createId()}`,
        author: "human",
        body: args.body,
        createdAt: now(),
        status: "complete",
      };
      thread.messages = [...thread.messages, message];
      thread.updatedAt = message.createdAt;
      emit({
        type: "message.added",
        threadId: thread.threadId,
        message: { ...message },
        updatedAt: message.createdAt,
      });

      appendAssistantReply(
        thread.threadId,
        `This reply stays in ${thread.threadId}, which keeps the chat durable across streaming and replay.`,
      );
    },

    async toggleResolved(threadId) {
      const thread = findThread(threadId);
      thread.status = thread.status === "open" ? "resolved" : "open";
      thread.updatedAt = now();
      emit({
        type: "thread.statusChanged",
        threadId,
        status: thread.status,
        updatedAt: thread.updatedAt,
      });
    },
    async getThreads() {
      return clone(getThreadsSnapshot());
    },
  };
};

export const demoMagickClient = createDemoMagickClient();
export const demoDocumentId = defaultDocumentId;
