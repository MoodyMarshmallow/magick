import { Effect, Either, Stream } from "effect";

import type { ThreadRecord, ThreadViewModel } from "@magick/contracts/chat";
import type { DocumentService } from "../../../editor/documents/documentService";
import type { WorkspaceQueryService } from "../../../editor/workspace/workspaceQueryService";
import { DEFAULT_ASSISTANT_INSTRUCTIONS } from "../providers/providerPrompts";
import type {
  ProviderEvent,
  ProviderSessionRuntime,
  ProviderToolDefinition,
} from "../providers/providerTypes";
import {
  InvalidStateError,
  NotFoundError,
  backendErrorMessage,
} from "../runtime/errors";
import type {
  ClockService,
  IdGeneratorService,
  RuntimeStateService,
} from "../runtime/runtime";
import { buildToolExecutionContext } from "../tools/toolContextBuilder";
import type { ToolExecutor } from "../tools/toolExecutor";
import type { WebContentService } from "../tools/webContentService";
import type { ProviderSessionRuntimeService } from "./providerSessionRuntimeService";
import type { ThreadAutoTitleService } from "./threadAutoTitleService";
import type { ThreadCrudService } from "./threadCrudService";
import { fromPromise, fromSync } from "./threadEffect";
import type { ThreadEventPersistence } from "./threadEventPersistence";
import type { ThreadHistoryBuilder } from "./threadHistoryBuilder";

export class ThreadTurnRunner {
  readonly #runtimeState: RuntimeStateService;
  readonly #clock: ClockService;
  readonly #idGenerator: IdGeneratorService;
  readonly #toolExecutor: ToolExecutor;
  readonly #documents: DocumentService;
  readonly #workspaceQuery: WorkspaceQueryService;
  readonly #webContent: WebContentService;
  readonly #historyBuilder: ThreadHistoryBuilder;
  readonly #eventPersistence: ThreadEventPersistence;
  readonly #runtimeService: ProviderSessionRuntimeService;
  readonly #crudService: ThreadCrudService;
  readonly #autoTitleService: ThreadAutoTitleService;

  constructor(args: {
    runtimeState: RuntimeStateService;
    clock: ClockService;
    idGenerator: IdGeneratorService;
    toolExecutor: ToolExecutor;
    documents: DocumentService;
    workspaceQuery: WorkspaceQueryService;
    webContent: WebContentService;
    historyBuilder: ThreadHistoryBuilder;
    eventPersistence: ThreadEventPersistence;
    runtimeService: ProviderSessionRuntimeService;
    crudService: ThreadCrudService;
    autoTitleService: ThreadAutoTitleService;
  }) {
    this.#runtimeState = args.runtimeState;
    this.#clock = args.clock;
    this.#idGenerator = args.idGenerator;
    this.#toolExecutor = args.toolExecutor;
    this.#documents = args.documents;
    this.#workspaceQuery = args.workspaceQuery;
    this.#webContent = args.webContent;
    this.#historyBuilder = args.historyBuilder;
    this.#eventPersistence = args.eventPersistence;
    this.#runtimeService = args.runtimeService;
    this.#crudService = args.crudService;
    this.#autoTitleService = args.autoTitleService;
  }

  readonly #listProviderTools = (): readonly ProviderToolDefinition[] =>
    this.#toolExecutor.listTools().map((tool) => ({
      name: tool.id,
      description: tool.description,
      inputSchema: tool.inputSchemaJson,
    }));

  readonly #normalizeWorkspaceToolPath = (path: string): string =>
    this.#documents.toAgentPath(this.#documents.resolveFile(path));

  readonly #processProviderEvent = (
    thread: ThreadRecord,
    runtime: ProviderSessionRuntime,
    providerEvent: ProviderEvent,
    readFilesForTurn = new Set<string>(),
  ): Effect.Effect<void, import("../runtime/errors").BackendError> => {
    if (providerEvent.type !== "tool.call.requested") {
      const applied = this.#eventPersistence.applyProviderEvent(
        thread.id,
        thread.providerSessionId,
        providerEvent,
      );
      if (!applied) {
        return Effect.void;
      }

      return applied.pipe(Effect.asVoid);
    }

    return Effect.gen(
      function* (this: ThreadTurnRunner) {
        yield* this.#eventPersistence
          .applyToolRequestedEvent(
            thread.id,
            thread.providerSessionId,
            providerEvent,
          )
          .pipe(Effect.asVoid);
        yield* this.#eventPersistence
          .persistToolStarted(
            thread.id,
            thread.providerSessionId,
            providerEvent.turnId,
            providerEvent.toolCallId,
          )
          .pipe(Effect.asVoid);

        const toolContext = buildToolExecutionContext({
          workspaceId: thread.workspaceId,
          threadId: thread.id,
          turnId: providerEvent.turnId,
          documents: this.#documents,
          workspaceQuery: this.#workspaceQuery,
          web: this.#webContent,
          hasReadFile: (path) =>
            readFilesForTurn.has(this.#normalizeWorkspaceToolPath(path)),
          markFileRead: (path) => {
            readFilesForTurn.add(this.#normalizeWorkspaceToolPath(path));
          },
        });

        const toolResult = yield* Effect.either(
          fromPromise(() =>
            this.#toolExecutor.execute({
              toolName: providerEvent.toolName,
              input: providerEvent.input,
              context: toolContext,
            }),
          ),
        );

        const continuationOutput = Either.isRight(toolResult)
          ? toolResult.right.modelOutput
          : `Tool execution failed: ${backendErrorMessage(toolResult.left)}`;

        if (Either.isRight(toolResult)) {
          yield* this.#eventPersistence
            .persistToolCompleted(
              thread.id,
              thread.providerSessionId,
              providerEvent.turnId,
              providerEvent.toolCallId,
              toolResult.right,
            )
            .pipe(Effect.asVoid);
        } else {
          yield* this.#eventPersistence
            .persistToolFailed(
              thread.id,
              thread.providerSessionId,
              providerEvent.turnId,
              providerEvent.toolCallId,
              backendErrorMessage(toolResult.left),
              continuationOutput,
            )
            .pipe(Effect.asVoid);
        }

        const continuation = yield* runtime.session.submitToolResult({
          turnId: providerEvent.turnId,
          toolCallId: providerEvent.toolCallId,
          toolName: providerEvent.toolName,
          output: continuationOutput,
          instructions: DEFAULT_ASSISTANT_INSTRUCTIONS,
          historyItems: this.#historyBuilder.buildConversationHistory(
            thread.id,
          ),
          tools: this.#listProviderTools(),
        });

        yield* Stream.runForEach(continuation, (continuationEvent) =>
          this.#processProviderEvent(
            thread,
            runtime,
            continuationEvent,
            readFilesForTurn,
          ),
        );
      }.bind(this),
    );
  };

  readonly sendMessage = (threadId: string, content: string) =>
    Effect.gen(
      function* (this: ThreadTurnRunner) {
        const thread = yield* this.#crudService.requireThread(threadId);
        const snapshot = yield* this.#crudService.openThreadEffect(threadId);

        const activeTurn = this.#runtimeState.getActiveTurn(threadId);
        if (snapshot.activeTurnId || activeTurn) {
          return yield* Effect.fail(
            new InvalidStateError({
              code: "turn_already_running",
              detail: `Thread '${threadId}' already has an active turn.`,
            }),
          );
        }

        const runtime =
          yield* this.#runtimeService.getOrCreateSessionRuntime(thread);
        const turnId = this.#idGenerator.next("turn");
        const assistantMessageId = this.#idGenerator.next("message");
        const now = this.#clock.now();
        const historyItems =
          this.#historyBuilder.buildConversationHistory(threadId);
        const shouldAutoName = this.#autoTitleService.shouldAutoNameThread({
          thread,
          snapshot,
        });

        yield* this.#eventPersistence.persistAndProject(threadId, [
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId: thread.providerSessionId,
            occurredAt: now,
            type: "message.user.created",
            payload: {
              messageId: this.#idGenerator.next("message"),
              content,
            },
          },
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId: thread.providerSessionId,
            occurredAt: now,
            type: "turn.started",
            payload: {
              turnId,
              parentTurnId: snapshot.activeTurnId,
            },
          },
        ]);

        this.#runtimeState.setActiveTurn(threadId, {
          turnId,
          sessionId: runtime.recordId,
        });

        if (shouldAutoName) {
          yield* this.#autoTitleService.autoNameThreadFromFirstMessage({
            thread,
            content,
          });
        }

        const stream = yield* runtime.session.startTurn({
          threadId,
          turnId,
          messageId: assistantMessageId,
          userMessage: content,
          instructions: DEFAULT_ASSISTANT_INSTRUCTIONS,
          contextMessages: this.#historyBuilder.buildContextMessages(snapshot),
          historyItems,
          tools: this.#listProviderTools(),
        });

        yield* Stream.runForEach(stream, (providerEvent) =>
          this.#processProviderEvent(thread, runtime, providerEvent),
        ).pipe(
          Effect.catchAll((error) =>
            this.#eventPersistence
              .persistAndProject(threadId, [
                {
                  eventId: this.#idGenerator.next("event"),
                  threadId,
                  providerSessionId: thread.providerSessionId,
                  occurredAt: this.#clock.now(),
                  type: "turn.failed",
                  payload: {
                    turnId,
                    error: backendErrorMessage(error),
                  },
                },
              ])
              .pipe(Effect.asVoid),
          ),
          Effect.ensuring(
            Effect.sync(() => this.#runtimeState.clearActiveTurn(threadId)),
          ),
        );

        return yield* this.#crudService.openThreadEffect(threadId);
      }.bind(this),
    );

  readonly stopTurn = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadTurnRunner) {
        const activeTurn = this.#runtimeState.getActiveTurn(threadId);
        if (!activeTurn) {
          return yield* this.#crudService.openThreadEffect(threadId);
        }

        const runtime = this.#runtimeState.getSessionRuntime(
          activeTurn.sessionId,
        );
        if (!runtime) {
          return yield* Effect.fail(
            new NotFoundError({
              entity: "provider_session_runtime",
              id: activeTurn.sessionId,
            }),
          );
        }

        yield* runtime.session.interruptTurn({
          turnId: activeTurn.turnId,
          reason: "Interrupted by user",
        });
        yield* this.#eventPersistence.persistAndProject(threadId, [
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId: runtime.recordId,
            occurredAt: this.#clock.now(),
            type: "turn.interrupted",
            payload: {
              turnId: activeTurn.turnId,
              reason: "Interrupted by user",
            },
          },
        ]);
        this.#runtimeState.clearActiveTurn(threadId);
        return yield* this.#crudService.openThreadEffect(threadId);
      }.bind(this),
    );

  readonly retryTurn = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadTurnRunner) {
        const thread = yield* this.#crudService.openThreadEffect(threadId);
        const lastUserMessage = [...thread.messages]
          .reverse()
          .find((message) => message.role === "user");

        if (!lastUserMessage) {
          return yield* Effect.fail(
            new InvalidStateError({
              code: "retry_not_possible",
              detail: `Thread '${threadId}' has no user message to retry.`,
            }),
          );
        }

        return yield* this.sendMessage(threadId, lastUserMessage.content);
      }.bind(this),
    );
}
