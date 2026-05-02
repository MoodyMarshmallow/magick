import { Effect, Either, Stream } from "effect";

import type { ThreadRecord, ThreadViewModel } from "@magick/contracts/chat";
import type { DocumentService } from "../../../../editor/documents/documentService";
import type { WorkspaceQueryService } from "../../../../editor/workspace/workspaceQueryService";
import { DEFAULT_ASSISTANT_INSTRUCTIONS } from "../../providers/providerPrompts";
import type {
  ProviderEvent,
  ProviderSessionRuntime,
  ProviderToolDefinition,
  ProviderToolResult,
} from "../../providers/providerTypes";
import {
  InvalidStateError,
  NotFoundError,
  backendErrorMessage,
} from "../../runtime/errors";
import type {
  ClockService,
  IdGeneratorService,
  RuntimeStateService,
} from "../../runtime/runtime";
import { buildToolExecutionContext } from "../../tools/toolContextBuilder";
import type { ToolExecutor } from "../../tools/toolExecutor";
import type { WebContentService } from "../../tools/webContentService";
import { fromPromise, fromSync } from "../domain/threadEffect";
import type { ThreadHistoryBuilder } from "../domain/threadHistoryBuilder";
import type { ThreadCrudService } from "../lifecycle/threadCrudService";
import type { ProviderSessionRuntimeService } from "./providerSessionRuntimeService";
import type { ThreadAutoTitleService } from "./threadAutoTitleService";
import type { ThreadEventPersistence } from "./threadEventPersistence";

class ProviderStreamAbortError extends Error {
  constructor() {
    super("Abort provider stream processing");
    this.name = "ProviderStreamAbortError";
  }
}

type PendingToolCallEvent = Extract<
  ProviderEvent,
  { readonly type: "tool.call.requested" }
>;

type ProviderStreamDrainOutcome =
  | {
      readonly kind: "completed";
      readonly pendingToolCalls: readonly PendingToolCallEvent[];
    }
  | {
      readonly kind: "suppressed";
    };

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

  readonly #findLatestAssistantMessageForTurn = (
    snapshot: ThreadViewModel,
    turnId: string,
  ) => {
    for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
      const message = snapshot.messages[index];
      if (message?.id.startsWith(`${turnId}:assistant:`)) {
        return message;
      }
    }

    return null;
  };

  readonly #hasUnresolvedToolWorkForTurn = (
    snapshot: ThreadViewModel,
    turnId: string,
  ): boolean =>
    snapshot.toolActivities.some(
      (toolActivity) =>
        toolActivity.turnId === turnId &&
        (toolActivity.status === "requested" ||
          toolActivity.status === "running" ||
          toolActivity.status === "awaiting_approval"),
    );

  readonly #shouldContinueAfterToolResult = (
    snapshot: ThreadViewModel,
    turnId: string,
  ): boolean => {
    if (this.#hasUnresolvedToolWorkForTurn(snapshot, turnId)) {
      return true;
    }

    const latestAssistantMessage = this.#findLatestAssistantMessageForTurn(
      snapshot,
      turnId,
    );
    if (!latestAssistantMessage) {
      return true;
    }

    return latestAssistantMessage.reason !== "stop";
  };

  readonly #recordToolCallRequest = (
    thread: ThreadRecord,
    providerEvent: PendingToolCallEvent,
  ): Effect.Effect<
    void,
    import("../../runtime/errors").BackendError | ProviderStreamAbortError
  > => {
    return Effect.gen(
      function* (this: ThreadTurnRunner) {
        const snapshotBeforeToolRequest =
          yield* this.#crudService.openThreadEffect(thread.id);
        const latestAssistantMessage = this.#findLatestAssistantMessageForTurn(
          snapshotBeforeToolRequest,
          providerEvent.turnId,
        );
        if (latestAssistantMessage?.reason === "stop") {
          yield* this.#eventPersistence
            .persistAndProject(thread.id, [
              {
                eventId: this.#idGenerator.next("event"),
                threadId: thread.id,
                providerSessionId: thread.providerSessionId,
                occurredAt: this.#clock.now(),
                type: "turn.failed",
                payload: {
                  turnId: providerEvent.turnId,
                  error:
                    "Provider requested tool continuation after assistant completion reason 'stop'.",
                },
              },
            ])
            .pipe(Effect.asVoid);
          return yield* Effect.fail(new ProviderStreamAbortError());
        }

        yield* this.#eventPersistence
          .applyToolRequestedEvent(
            thread.id,
            thread.providerSessionId,
            providerEvent,
          )
          .pipe(Effect.asVoid);
      }.bind(this),
    );
  };

  readonly #applyNonToolProviderEvent = (
    thread: ThreadRecord,
    providerEvent: Exclude<
      ProviderEvent,
      { readonly type: "tool.call.requested" }
    >,
  ): Effect.Effect<void, import("../../runtime/errors").BackendError> => {
    const applied = this.#eventPersistence.applyProviderEvent(
      thread.id,
      thread.providerSessionId,
      providerEvent,
    );
    if (!applied) {
      return Effect.void;
    }

    return applied.pipe(Effect.asVoid);
  };

  readonly #executeToolBatch = (
    thread: ThreadRecord,
    runtime: ProviderSessionRuntime,
    toolCalls: readonly PendingToolCallEvent[],
    readFilesForTurn: Set<string>,
  ): Effect.Effect<void, import("../../runtime/errors").BackendError> =>
    Effect.gen(
      function* (this: ThreadTurnRunner) {
        if (toolCalls.length === 0) {
          return;
        }

        const batchTurnId = toolCalls[0]?.turnId;
        if (
          !batchTurnId ||
          toolCalls.some((toolCall) => toolCall.turnId !== batchTurnId)
        ) {
          return yield* Effect.fail(
            new InvalidStateError({
              code: "provider_protocol_invalid",
              detail:
                "Provider emitted tool calls from multiple turns in a single response step.",
            }),
          );
        }

        const toolContext = buildToolExecutionContext({
          workspaceId: thread.workspaceId,
          threadId: thread.id,
          turnId: batchTurnId,
          documents: this.#documents,
          workspaceQuery: this.#workspaceQuery,
          web: this.#webContent,
          hasReadFile: (path) =>
            readFilesForTurn.has(this.#normalizeWorkspaceToolPath(path)),
          markFileRead: (path) => {
            readFilesForTurn.add(this.#normalizeWorkspaceToolPath(path));
          },
        });

        const toolResults: ProviderToolResult[] = [];

        for (const toolCall of toolCalls) {
          yield* this.#eventPersistence
            .persistToolStarted(
              thread.id,
              thread.providerSessionId,
              toolCall.turnId,
              toolCall.toolCallId,
            )
            .pipe(Effect.asVoid);

          const toolResult = yield* Effect.either(
            fromPromise(() =>
              this.#toolExecutor.execute({
                toolName: toolCall.toolName,
                input: toolCall.input,
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
                toolCall.turnId,
                toolCall.toolCallId,
                toolResult.right,
              )
              .pipe(Effect.asVoid);
          } else {
            yield* this.#eventPersistence
              .persistToolFailed(
                thread.id,
                thread.providerSessionId,
                toolCall.turnId,
                toolCall.toolCallId,
                backendErrorMessage(toolResult.left),
                continuationOutput,
              )
              .pipe(Effect.asVoid);
          }

          toolResults.push({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            output: continuationOutput,
          });
        }

        const updatedSnapshot = yield* this.#crudService.openThreadEffect(
          thread.id,
        );
        if (
          !this.#shouldContinueAfterToolResult(updatedSnapshot, batchTurnId)
        ) {
          return;
        }

        const continuation = yield* runtime.session.submitToolResults({
          turnId: batchTurnId,
          toolResults,
          instructions: DEFAULT_ASSISTANT_INSTRUCTIONS,
          historyItems: this.#historyBuilder.buildConversationHistory(
            thread.id,
          ),
          tools: this.#listProviderTools(),
        });

        yield* this.#runProviderStream(
          thread,
          runtime,
          batchTurnId,
          continuation,
          readFilesForTurn,
        );
      }.bind(this),
    );

  readonly #drainProviderStream = (
    thread: ThreadRecord,
    turnId: string,
    stream: Stream.Stream<
      ProviderEvent,
      import("../../runtime/errors").BackendError
    >,
    readFilesForTurn = new Set<string>(),
  ): Effect.Effect<
    ProviderStreamDrainOutcome,
    import("../../runtime/errors").BackendError
  > =>
    Effect.gen(
      function* (this: ThreadTurnRunner) {
        const pendingToolCalls: PendingToolCallEvent[] = [];

        const drainResult = yield* Effect.either(
          Stream.runForEach(stream, (providerEvent) =>
            providerEvent.type === "tool.call.requested"
              ? this.#recordToolCallRequest(thread, providerEvent).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      pendingToolCalls.push(providerEvent);
                    }),
                  ),
                )
              : this.#applyNonToolProviderEvent(thread, providerEvent),
          ),
        );

        if (Either.isLeft(drainResult)) {
          const error = drainResult.left;
          if (error instanceof ProviderStreamAbortError) {
            return {
              kind: "suppressed",
            } satisfies ProviderStreamDrainOutcome;
          }

          yield* this.#eventPersistence
            .persistAndProject(thread.id, [
              {
                eventId: this.#idGenerator.next("event"),
                threadId: thread.id,
                providerSessionId: thread.providerSessionId,
                occurredAt: this.#clock.now(),
                type: "turn.failed",
                payload: {
                  turnId,
                  error: backendErrorMessage(error),
                },
              },
            ])
            .pipe(Effect.asVoid);

          return {
            kind: "suppressed",
          } satisfies ProviderStreamDrainOutcome;
        }

        return {
          kind: "completed",
          pendingToolCalls,
        } satisfies ProviderStreamDrainOutcome;
      }.bind(this),
    );

  readonly #continueAfterStream = (
    thread: ThreadRecord,
    runtime: ProviderSessionRuntime,
    outcome: ProviderStreamDrainOutcome,
    readFilesForTurn = new Set<string>(),
  ): Effect.Effect<void, import("../../runtime/errors").BackendError> =>
    Effect.gen(
      function* (this: ThreadTurnRunner) {
        if (
          outcome.kind !== "completed" ||
          outcome.pendingToolCalls.length === 0
        ) {
          return;
        }

        yield* this.#executeToolBatch(
          thread,
          runtime,
          outcome.pendingToolCalls,
          readFilesForTurn,
        );
      }.bind(this),
    );

  readonly #failStaleActiveTurn = (
    thread: ThreadRecord,
    turnId: string,
  ): Effect.Effect<
    ThreadViewModel,
    import("../../runtime/errors").BackendError
  > =>
    this.#eventPersistence
      .persistAndProject(thread.id, [
        {
          eventId: this.#idGenerator.next("event"),
          threadId: thread.id,
          providerSessionId: thread.providerSessionId,
          occurredAt: this.#clock.now(),
          type: "turn.failed",
          payload: {
            turnId,
            error:
              "Turn runtime was lost before completion. Start a new turn to continue.",
          },
        },
      ])
      .pipe(Effect.map((result) => result.thread));

  readonly #reconcileActiveTurnState = (
    thread: ThreadRecord,
    snapshot: ThreadViewModel,
  ): Effect.Effect<
    {
      readonly snapshot: ThreadViewModel;
      readonly activeTurn:
        | {
            readonly turnId: string;
            readonly sessionId: string;
          }
        | undefined;
    },
    import("../../runtime/errors").BackendError
  > =>
    Effect.gen(
      function* (this: ThreadTurnRunner) {
        const activeTurn = this.#runtimeState.getActiveTurn(thread.id);
        if (!snapshot.activeTurnId || activeTurn) {
          return { snapshot, activeTurn };
        }

        return {
          snapshot: yield* this.#failStaleActiveTurn(
            thread,
            snapshot.activeTurnId,
          ),
          activeTurn: undefined,
        };
      }.bind(this),
    );

  readonly #runProviderStream = (
    thread: ThreadRecord,
    runtime: ProviderSessionRuntime,
    turnId: string,
    stream: Stream.Stream<
      ProviderEvent,
      import("../../runtime/errors").BackendError
    >,
    readFilesForTurn = new Set<string>(),
  ): Effect.Effect<void, import("../../runtime/errors").BackendError> =>
    Effect.gen(
      function* (this: ThreadTurnRunner) {
        const drainOutcome = yield* this.#drainProviderStream(
          thread,
          turnId,
          stream,
          readFilesForTurn,
        );

        yield* this.#continueAfterStream(
          thread,
          runtime,
          drainOutcome,
          readFilesForTurn,
        );
      }.bind(this),
    );

  readonly sendMessage = (threadId: string, content: string) =>
    Effect.gen(
      function* (this: ThreadTurnRunner) {
        const thread = yield* this.#crudService.requireThread(threadId);
        const snapshot = yield* this.#crudService.openThreadEffect(threadId);
        const reconciled = yield* this.#reconcileActiveTurnState(
          thread,
          snapshot,
        );

        const activeTurn = reconciled.activeTurn;
        const currentSnapshot = reconciled.snapshot;
        if (currentSnapshot.activeTurnId || activeTurn) {
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
          snapshot: currentSnapshot,
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
              parentTurnId: currentSnapshot.activeTurnId,
            },
          },
        ]);

        this.#runtimeState.setActiveTurn(threadId, {
          turnId,
          sessionId: runtime.recordId,
        });

        yield* Effect.gen(
          function* (this: ThreadTurnRunner) {
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
              contextMessages:
                this.#historyBuilder.buildContextMessages(currentSnapshot),
              historyItems,
              tools: this.#listProviderTools(),
            });

            yield* this.#runProviderStream(thread, runtime, turnId, stream);
          }.bind(this),
        ).pipe(
          Effect.catchAll((error) =>
            error instanceof ProviderStreamAbortError
              ? Effect.void
              : this.#eventPersistence
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
        const thread = yield* this.#crudService.requireThread(threadId);
        const activeTurn = this.#runtimeState.getActiveTurn(threadId);
        if (!activeTurn) {
          const snapshot = yield* this.#crudService.openThreadEffect(threadId);
          if (!snapshot.activeTurnId) {
            return snapshot;
          }

          return yield* this.#failStaleActiveTurn(
            thread,
            snapshot.activeTurnId,
          );
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
