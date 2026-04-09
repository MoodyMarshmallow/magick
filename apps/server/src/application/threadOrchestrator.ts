// Coordinates thread lifecycle, provider execution, persistence, and event projection.

import { Cause, Effect, Either, Exit, Option, Stream } from "effect";

import type {
  DomainEvent,
  FileDiffPreview,
  ThreadRecord,
  ThreadResolutionState,
  ThreadSummary,
  ThreadViewModel,
} from "@magick/contracts/chat";
import type { ProviderSessionRecord } from "@magick/contracts/provider";
import { maxThreadTitleLength } from "@magick/shared/threadTitle";
import {
  type BackendError,
  InvalidStateError,
  NotFoundError,
  PersistenceError,
  ProviderFailureError,
  ProviderUnavailableError,
  ReplayError,
  backendErrorMessage,
} from "../core/errors";
import type {
  ClockService,
  EventPublisherService,
  IdGeneratorService,
  RuntimeStateService,
} from "../core/runtime";
import type { EventStore } from "../persistence/eventStore";
import type { ProviderSessionRepository } from "../persistence/providerSessionRepository";
import type { ThreadRepository } from "../persistence/threadRepository";
import {
  projectThreadEvents,
  toThreadSummary,
} from "../projections/threadProjector";
import type {
  ConversationContextMessage,
  ConversationHistoryItem,
  ProviderEvent,
  ProviderRegistryService,
  ProviderSessionRuntime,
  ProviderToolDefinition,
} from "../providers/providerTypes";
import { buildToolExecutionContext } from "../tools/toolContextBuilder";
import type { ToolExecutor } from "../tools/toolExecutor";
import type { WebContentService } from "../tools/webContentService";
import type { WorkspaceAccessService } from "../tools/workspaceAccessService";

export interface CreateThreadInput {
  readonly workspaceId: string;
  readonly providerKey: string;
  readonly title?: string;
}

export interface ThreadOrchestratorApi {
  readonly createThread: (input: CreateThreadInput) => Promise<ThreadViewModel>;
  readonly listThreads: (
    workspaceId: string,
  ) => Promise<readonly ThreadSummary[]>;
  readonly openThread: (threadId: string) => Promise<ThreadViewModel>;
  readonly renameThread: (
    threadId: string,
    title: string,
  ) => Promise<ThreadViewModel>;
  readonly deleteThread: (
    threadId: string,
  ) => Promise<{ readonly threadId: string; readonly workspaceId: string }>;
  readonly sendMessage: (
    threadId: string,
    content: string,
  ) => Effect.Effect<ThreadViewModel, BackendError>;
  readonly stopTurn: (
    threadId: string,
  ) => Effect.Effect<ThreadViewModel, BackendError>;
  readonly resolveThread: (threadId: string) => Promise<ThreadViewModel>;
  readonly reopenThread: (threadId: string) => Promise<ThreadViewModel>;
  readonly retryTurn: (
    threadId: string,
  ) => Effect.Effect<ThreadViewModel, BackendError>;
  readonly ensureSession: (threadId: string) => Promise<ThreadViewModel>;
}

const toBackendError = (error: unknown): BackendError => {
  if (
    error instanceof NotFoundError ||
    error instanceof InvalidStateError ||
    error instanceof ProviderUnavailableError ||
    error instanceof ProviderFailureError ||
    error instanceof PersistenceError ||
    error instanceof ReplayError
  ) {
    return error;
  }

  return new InvalidStateError({
    code: "backend_unexpected_error",
    detail: error instanceof Error ? error.message : String(error),
  });
};

const fromSync = <A>(thunk: () => A): Effect.Effect<A, BackendError> =>
  Effect.try({
    try: thunk,
    catch: toBackendError,
  });

const fromPromise = <A>(
  thunk: () => Promise<A>,
): Effect.Effect<A, BackendError> =>
  Effect.tryPromise({
    try: thunk,
    catch: toBackendError,
  });

export class ThreadOrchestrator implements ThreadOrchestratorApi {
  readonly #providerRegistry: ProviderRegistryService;
  readonly #eventStore: EventStore;
  readonly #threadRepository: ThreadRepository;
  readonly #providerSessionRepository: ProviderSessionRepository;
  readonly #publisher: EventPublisherService;
  readonly #runtimeState: RuntimeStateService;
  readonly #clock: ClockService;
  readonly #idGenerator: IdGeneratorService;
  readonly #toolExecutor: ToolExecutor;
  readonly #workspaceAccess: WorkspaceAccessService;
  readonly #webContent: WebContentService;

  constructor(args: {
    providerRegistry: ProviderRegistryService;
    eventStore: EventStore;
    threadRepository: ThreadRepository;
    providerSessionRepository: ProviderSessionRepository;
    publisher: EventPublisherService;
    runtimeState: RuntimeStateService;
    clock: ClockService;
    idGenerator: IdGeneratorService;
    toolExecutor: ToolExecutor;
    workspaceAccess: WorkspaceAccessService;
    webContent: WebContentService;
  }) {
    this.#providerRegistry = args.providerRegistry;
    this.#eventStore = args.eventStore;
    this.#threadRepository = args.threadRepository;
    this.#providerSessionRepository = args.providerSessionRepository;
    this.#publisher = args.publisher;
    this.#runtimeState = args.runtimeState;
    this.#clock = args.clock;
    this.#idGenerator = args.idGenerator;
    this.#toolExecutor = args.toolExecutor;
    this.#workspaceAccess = args.workspaceAccess;
    this.#webContent = args.webContent;
  }

  readonly #run = <A>(effect: Effect.Effect<A, BackendError>): Promise<A> =>
    Effect.runPromiseExit(effect).then((exit) => {
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }

      const failure = Cause.failureOption(exit.cause);
      if (Option.isSome(failure)) {
        throw failure.value;
      }

      throw new Error("Unhandled backend effect failure");
    });

  readonly #normalizeThreadTitle = (title: string, fallback?: string) => {
    const normalized = title.trim();
    if (normalized.length === 0) {
      if (fallback) {
        return fallback;
      }

      throw new InvalidStateError({
        code: "thread_title_invalid",
        detail: "Thread title must not be empty.",
      });
    }

    if (normalized.length > maxThreadTitleLength) {
      throw new InvalidStateError({
        code: "thread_title_too_long",
        detail: `Thread title must be ${maxThreadTitleLength} characters or fewer.`,
      });
    }

    return normalized;
  };

  readonly #requireThread = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const thread = yield* fromSync(() =>
          this.#threadRepository.get(threadId),
        );
        if (!thread) {
          return yield* Effect.fail(
            new NotFoundError({ entity: "thread", id: threadId }),
          );
        }

        return thread;
      }.bind(this),
    );

  readonly #openThreadEffect = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const snapshot = yield* fromSync(() =>
          this.#threadRepository.getSnapshot(threadId),
        );
        if (!snapshot) {
          return yield* Effect.fail(
            new NotFoundError({ entity: "thread", id: threadId }),
          );
        }

        return snapshot;
      }.bind(this),
    );

  readonly openThread = (threadId: string) =>
    this.#run(this.#openThreadEffect(threadId));

  readonly #buildContextMessages = (
    thread: ThreadViewModel,
  ): readonly ConversationContextMessage[] => {
    return thread.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  };

  readonly #parseToolInput = (
    value: string | null,
    fallback: unknown,
  ): unknown => {
    if (fallback !== undefined) {
      return fallback;
    }
    if (!value) {
      return {};
    }

    try {
      return JSON.parse(value);
    } catch {
      return { rawInput: value };
    }
  };

  readonly #buildConversationHistory = (
    threadId: string,
  ): readonly ConversationHistoryItem[] => {
    const events = this.#eventStore.listThreadEvents(threadId);
    const history: ConversationHistoryItem[] = [];
    type MutableAssistantHistoryMessage = {
      type: "message";
      role: "assistant";
      content: string;
    };
    const assistantMessages = new Map<string, MutableAssistantHistoryMessage>();

    for (const event of events) {
      switch (event.type) {
        case "message.user.created":
          history.push({
            type: "message",
            role: "user",
            content: event.payload.content,
          });
          break;
        case "turn.delta": {
          const assistantMessage = assistantMessages.get(
            event.payload.messageId,
          );
          if (assistantMessage) {
            assistantMessage.content += event.payload.delta;
            break;
          }

          const nextMessage: MutableAssistantHistoryMessage = {
            type: "message",
            role: "assistant",
            content: event.payload.delta,
          };
          assistantMessages.set(event.payload.messageId, nextMessage);
          history.push(nextMessage);
          break;
        }
        case "tool.requested":
          history.push({
            type: "tool_call",
            toolCallId: event.payload.toolCallId,
            toolName: event.payload.toolName,
            input: this.#parseToolInput(
              event.payload.argsPreview,
              event.payload.input,
            ),
          });
          break;
        case "tool.completed":
          history.push({
            type: "tool_result",
            toolCallId: event.payload.toolCallId,
            output:
              event.payload.modelOutput ?? event.payload.resultPreview ?? "",
          });
          break;
        case "tool.failed":
          history.push({
            type: "tool_result",
            toolCallId: event.payload.toolCallId,
            output:
              event.payload.modelOutput ??
              `Tool execution failed: ${event.payload.error}`,
          });
          break;
      }
    }

    return history;
  };

  readonly #shouldAutoNameThread = (args: {
    readonly thread: ThreadRecord;
    readonly snapshot: ThreadViewModel;
  }): boolean => {
    if (args.thread.title !== "New chat") {
      return false;
    }

    return !args.snapshot.messages.some((message) => message.role === "user");
  };

  readonly #autoNameThreadFromFirstMessage = (args: {
    readonly thread: ThreadRecord;
    readonly content: string;
  }): Effect.Effect<void, never> =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const adapter = yield* fromSync(() =>
          this.#providerRegistry.get(args.thread.providerKey),
        ).pipe(
          Effect.catchAll((error) => {
            console.warn("Failed to load provider for thread auto-naming.", {
              threadId: args.thread.id,
              providerKey: args.thread.providerKey,
              error: backendErrorMessage(error),
            });
            return Effect.succeed(null);
          }),
        );
        if (!adapter) {
          return;
        }

        const generatedTitle = yield* adapter
          .generateThreadTitle(args.content)
          .pipe(
            Effect.catchAll((error) => {
              console.warn("Provider thread auto-naming failed.", {
                threadId: args.thread.id,
                providerKey: args.thread.providerKey,
                error: backendErrorMessage(error),
              });
              return Effect.succeed(null);
            }),
          );
        if (!generatedTitle?.trim()) {
          return;
        }

        yield* fromPromise(() =>
          this.renameThread(args.thread.id, generatedTitle),
        ).pipe(
          Effect.catchAll((error) => {
            console.warn("Failed to persist auto-generated thread title.", {
              threadId: args.thread.id,
              providerKey: args.thread.providerKey,
              error: backendErrorMessage(error),
            });
            return Effect.void;
          }),
        );
      }.bind(this),
    ).pipe(Effect.asVoid);

  readonly #persistAndProject = (
    threadId: string,
    events: readonly Omit<DomainEvent, "sequence">[],
  ) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const persistedEvents = yield* fromSync(() =>
          this.#eventStore.append(threadId, events),
        );
        const seed = yield* fromSync(() =>
          this.#threadRepository.getSnapshot(threadId),
        );
        const projectedThread = projectThreadEvents(seed, persistedEvents);

        yield* fromSync(() =>
          this.#threadRepository.saveSnapshot(
            threadId,
            toThreadSummary(projectedThread),
            projectedThread,
          ),
        );

        yield* fromPromise(() => this.#publisher.publish(persistedEvents)).pipe(
          Effect.catchAllCause(() => Effect.void),
        );

        return {
          events: persistedEvents,
          thread: projectedThread,
        } as const;
      }.bind(this),
    );

  readonly #listProviderTools = (): readonly ProviderToolDefinition[] =>
    this.#toolExecutor.listTools().map((tool) => ({
      name: tool.id,
      description: tool.description,
      inputSchema: tool.inputSchemaJson,
    }));

  readonly #extractToolLocationMetadata = (input: unknown) => {
    if (typeof input !== "object" || input === null) {
      return { path: null, url: null } as const;
    }

    const record = input as Record<string, unknown>;
    return {
      path: typeof record.path === "string" ? record.path : null,
      url: typeof record.url === "string" ? record.url : null,
    } as const;
  };

  readonly #stringifyToolInput = (input: unknown): string | null => {
    try {
      return JSON.stringify(input);
    } catch {
      return null;
    }
  };

  readonly #applyToolRequestedEvent = (
    threadId: string,
    providerSessionId: string,
    providerEvent: Extract<
      ProviderEvent,
      { readonly type: "tool.call.requested" }
    >,
  ) => {
    const metadata = this.#extractToolLocationMetadata(providerEvent.input);
    return this.#persistAndProject(threadId, [
      {
        eventId: this.#idGenerator.next("event"),
        threadId,
        providerSessionId,
        occurredAt: this.#clock.now(),
        type: "tool.requested",
        payload: {
          turnId: providerEvent.turnId,
          toolCallId: providerEvent.toolCallId,
          toolName: providerEvent.toolName,
          title: providerEvent.toolName,
          argsPreview: this.#stringifyToolInput(providerEvent.input),
          input: providerEvent.input,
          path: metadata.path,
          url: metadata.url,
        },
      },
    ]);
  };

  readonly #persistToolStarted = (
    threadId: string,
    providerSessionId: string,
    turnId: string,
    toolCallId: string,
  ) =>
    this.#persistAndProject(threadId, [
      {
        eventId: this.#idGenerator.next("event"),
        threadId,
        providerSessionId,
        occurredAt: this.#clock.now(),
        type: "tool.started",
        payload: {
          turnId,
          toolCallId,
        },
      },
    ]);

  readonly #persistToolCompleted = (
    threadId: string,
    providerSessionId: string,
    turnId: string,
    toolCallId: string,
    result: {
      readonly resultPreview: string | null;
      readonly modelOutput: string;
      readonly path: string | null;
      readonly url: string | null;
      readonly diff: FileDiffPreview | null;
    },
  ) =>
    this.#persistAndProject(threadId, [
      {
        eventId: this.#idGenerator.next("event"),
        threadId,
        providerSessionId,
        occurredAt: this.#clock.now(),
        type: "tool.completed",
        payload: {
          turnId,
          toolCallId,
          resultPreview: result.resultPreview,
          modelOutput: result.modelOutput,
          path: result.path,
          url: result.url,
          diff: result.diff,
        },
      },
    ]);

  readonly #persistToolFailed = (
    threadId: string,
    providerSessionId: string,
    turnId: string,
    toolCallId: string,
    error: string,
    modelOutput: string,
  ) =>
    this.#persistAndProject(threadId, [
      {
        eventId: this.#idGenerator.next("event"),
        threadId,
        providerSessionId,
        occurredAt: this.#clock.now(),
        type: "tool.failed",
        payload: {
          turnId,
          toolCallId,
          error,
          modelOutput,
        },
      },
    ]);

  readonly #applyProviderEvent = (
    threadId: string,
    providerSessionId: string,
    providerEvent: ProviderEvent,
  ) => {
    switch (providerEvent.type) {
      case "output.delta":
        return this.#persistAndProject(threadId, [
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId,
            occurredAt: this.#clock.now(),
            type: "turn.delta",
            payload: {
              turnId: providerEvent.turnId,
              messageId: providerEvent.messageId,
              delta: providerEvent.delta,
            },
          },
        ]);
      case "output.completed":
        return this.#persistAndProject(threadId, [
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId,
            occurredAt: this.#clock.now(),
            type: "turn.completed",
            payload: {
              turnId: providerEvent.turnId,
              messageId: providerEvent.messageId,
            },
          },
        ]);
      case "turn.failed":
        return this.#persistAndProject(threadId, [
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId,
            occurredAt: this.#clock.now(),
            type: "turn.failed",
            payload: {
              turnId: providerEvent.turnId,
              error: providerEvent.error,
            },
          },
        ]);
      case "session.disconnected":
        return fromSync(() =>
          this.#providerSessionRepository.updateStatus(
            providerSessionId,
            "disconnected",
            this.#clock.now(),
          ),
        ).pipe(
          Effect.flatMap(() =>
            this.#persistAndProject(threadId, [
              {
                eventId: this.#idGenerator.next("event"),
                threadId,
                providerSessionId,
                occurredAt: this.#clock.now(),
                type: "provider.session.disconnected",
                payload: {
                  reason: providerEvent.reason,
                },
              },
            ]),
          ),
        );
      case "session.recovered":
        return fromSync(() =>
          this.#providerSessionRepository.updateStatus(
            providerSessionId,
            "active",
            this.#clock.now(),
          ),
        ).pipe(
          Effect.flatMap(() =>
            this.#persistAndProject(threadId, [
              {
                eventId: this.#idGenerator.next("event"),
                threadId,
                providerSessionId,
                occurredAt: this.#clock.now(),
                type: "provider.session.recovered",
                payload: {
                  reason: providerEvent.reason,
                },
              },
            ]),
          ),
        );
      case "tool.call.requested":
        return this.#applyToolRequestedEvent(
          threadId,
          providerSessionId,
          providerEvent,
        );
    }
  };

  readonly #processProviderEvent = (
    thread: ThreadRecord,
    runtime: ProviderSessionRuntime,
    providerEvent: ProviderEvent,
  ): Effect.Effect<void, BackendError> => {
    if (providerEvent.type !== "tool.call.requested") {
      return this.#applyProviderEvent(
        thread.id,
        thread.providerSessionId,
        providerEvent,
      ).pipe(Effect.asVoid);
    }

    return Effect.gen(
      function* (this: ThreadOrchestrator) {
        yield* this.#applyToolRequestedEvent(
          thread.id,
          thread.providerSessionId,
          providerEvent,
        ).pipe(Effect.asVoid);
        yield* this.#persistToolStarted(
          thread.id,
          thread.providerSessionId,
          providerEvent.turnId,
          providerEvent.toolCallId,
        ).pipe(Effect.asVoid);

        const toolContext = buildToolExecutionContext({
          workspaceId: thread.workspaceId,
          threadId: thread.id,
          turnId: providerEvent.turnId,
          workspace: this.#workspaceAccess,
          web: this.#webContent,
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

        if (Either.isRight(toolResult)) {
          yield* this.#persistToolCompleted(
            thread.id,
            thread.providerSessionId,
            providerEvent.turnId,
            providerEvent.toolCallId,
            toolResult.right,
          ).pipe(Effect.asVoid);

          const continuation = yield* runtime.session.submitToolResult({
            turnId: providerEvent.turnId,
            toolCallId: providerEvent.toolCallId,
            toolName: providerEvent.toolName,
            output: toolResult.right.modelOutput,
            historyItems: this.#buildConversationHistory(thread.id),
            tools: this.#listProviderTools(),
          });

          yield* Stream.runForEach(continuation, (continuationEvent) =>
            this.#processProviderEvent(thread, runtime, continuationEvent),
          );
          return;
        }

        const errorMessage = backendErrorMessage(toolResult.left);
        const toolFailureOutput = `Tool execution failed: ${errorMessage}`;
        yield* this.#persistToolFailed(
          thread.id,
          thread.providerSessionId,
          providerEvent.turnId,
          providerEvent.toolCallId,
          errorMessage,
          toolFailureOutput,
        ).pipe(Effect.asVoid);

        const continuation = yield* runtime.session.submitToolResult({
          turnId: providerEvent.turnId,
          toolCallId: providerEvent.toolCallId,
          toolName: providerEvent.toolName,
          output: toolFailureOutput,
          historyItems: this.#buildConversationHistory(thread.id),
          tools: this.#listProviderTools(),
        });

        yield* Stream.runForEach(continuation, (continuationEvent) =>
          this.#processProviderEvent(thread, runtime, continuationEvent),
        );
      }.bind(this),
    );
  };

  readonly #getOrCreateSessionRuntime = (thread: ThreadRecord) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const cached = this.#runtimeState.getSessionRuntime(
          thread.providerSessionId,
        );
        if (cached) {
          return cached;
        }

        const adapter = yield* fromSync(() =>
          this.#providerRegistry.get(thread.providerKey),
        );
        const sessionRecord = yield* fromSync(() =>
          this.#providerSessionRepository.get(thread.providerSessionId),
        );
        if (!sessionRecord) {
          return yield* Effect.fail(
            new NotFoundError({
              entity: "provider_session",
              id: thread.providerSessionId,
            }),
          );
        }

        const session = sessionRecord.providerSessionRef
          ? yield* adapter.resumeSession({
              workspaceId: thread.workspaceId,
              sessionId: sessionRecord.id,
              providerSessionRef: sessionRecord.providerSessionRef,
              providerThreadRef: sessionRecord.providerThreadRef,
            })
          : yield* adapter.createSession({
              workspaceId: thread.workspaceId,
              sessionId: sessionRecord.id,
            });

        const runtime: ProviderSessionRuntime = {
          recordId: sessionRecord.id,
          session,
          adapter,
        };

        if (
          session.providerSessionRef !== sessionRecord.providerSessionRef ||
          session.providerThreadRef !== sessionRecord.providerThreadRef
        ) {
          yield* fromSync(() =>
            this.#providerSessionRepository.updateRefs(sessionRecord.id, {
              providerSessionRef: session.providerSessionRef,
              providerThreadRef: session.providerThreadRef,
              updatedAt: this.#clock.now(),
            }),
          );
        }

        this.#runtimeState.setSessionRuntime(sessionRecord.id, runtime);
        return runtime;
      }.bind(this),
    );

  readonly #createThreadEffect = (input: CreateThreadInput) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const adapter = yield* fromSync(() =>
          this.#providerRegistry.get(input.providerKey),
        );
        const now = this.#clock.now();
        const providerSessionId = this.#idGenerator.next("session");
        const threadId = this.#idGenerator.next("thread");

        const sessionRecord: ProviderSessionRecord = {
          id: providerSessionId,
          providerKey: input.providerKey,
          workspaceId: input.workspaceId,
          status: "active",
          providerSessionRef: null,
          providerThreadRef: null,
          capabilities: adapter.listCapabilities(),
          createdAt: now,
          updatedAt: now,
        };
        yield* fromSync(() =>
          this.#providerSessionRepository.create(sessionRecord),
        );

        const threadRecord: ThreadRecord = {
          id: threadId,
          workspaceId: input.workspaceId,
          providerKey: input.providerKey,
          providerSessionId,
          title: this.#normalizeThreadTitle(input.title ?? "", "New chat"),
          resolutionState: "open",
          createdAt: now,
          updatedAt: now,
        };
        yield* fromSync(() => this.#threadRepository.create(threadRecord));

        const created = yield* this.#persistAndProject(threadId, [
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId,
            occurredAt: now,
            type: "thread.created",
            payload: {
              workspaceId: input.workspaceId,
              providerKey: input.providerKey,
              title: threadRecord.title,
            },
          },
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId,
            occurredAt: now,
            type: "provider.session.started",
            payload: {
              providerKey: input.providerKey,
              resumeStrategy: adapter.getResumeStrategy(),
            },
          },
        ]);

        return created.thread;
      }.bind(this),
    );

  readonly createThread = (input: CreateThreadInput) =>
    this.#run(this.#createThreadEffect(input));

  readonly renameThread = (threadId: string, title: string) =>
    this.#run(
      Effect.gen(
        function* (this: ThreadOrchestrator) {
          const thread = yield* this.#requireThread(threadId);
          const normalizedTitle = this.#normalizeThreadTitle(title);
          if (thread.title === normalizedTitle) {
            return yield* fromPromise(() => this.openThread(threadId));
          }

          const occurredAt = this.#clock.now();
          yield* fromSync(() =>
            this.#threadRepository.updateTitle(
              threadId,
              normalizedTitle,
              occurredAt,
            ),
          );

          const projected = yield* this.#persistAndProject(threadId, [
            {
              eventId: this.#idGenerator.next("event"),
              threadId,
              providerSessionId: thread.providerSessionId,
              occurredAt,
              type: "thread.renamed",
              payload: {
                title: normalizedTitle,
              },
            },
          ]);

          return projected.thread;
        }.bind(this),
      ),
    );

  readonly deleteThread = (threadId: string) =>
    this.#run(
      Effect.gen(
        function* (this: ThreadOrchestrator) {
          const thread = yield* this.#requireThread(threadId);
          const activeTurn = this.#runtimeState.getActiveTurn(threadId);
          if (activeTurn) {
            return yield* Effect.fail(
              new InvalidStateError({
                code: "thread_delete_while_running",
                detail: `Thread '${threadId}' cannot be deleted while a turn is running.`,
              }),
            );
          }

          const sessionRuntime = this.#runtimeState.getSessionRuntime(
            thread.providerSessionId,
          );
          if (sessionRuntime) {
            yield* sessionRuntime.session.dispose();
            yield* Effect.sync(() =>
              this.#runtimeState.clearSessionRuntime(thread.providerSessionId),
            );
          }

          yield* fromSync(() => this.#eventStore.deleteThreadEvents(threadId));
          yield* fromSync(() => this.#threadRepository.delete(threadId));
          yield* fromSync(() =>
            this.#providerSessionRepository.delete(thread.providerSessionId),
          );

          return {
            threadId,
            workspaceId: thread.workspaceId,
          } as const;
        }.bind(this),
      ),
    );

  readonly sendMessage = (threadId: string, content: string) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const thread = yield* this.#requireThread(threadId);
        const snapshot = yield* fromPromise(() => this.openThread(threadId));

        const activeTurn = this.#runtimeState.getActiveTurn(threadId);
        if (snapshot.activeTurnId || activeTurn) {
          return yield* Effect.fail(
            new InvalidStateError({
              code: "turn_already_running",
              detail: `Thread '${threadId}' already has an active turn.`,
            }),
          );
        }

        const runtime = yield* this.#getOrCreateSessionRuntime(thread);
        const turnId = this.#idGenerator.next("turn");
        const assistantMessageId = this.#idGenerator.next("message");
        const now = this.#clock.now();
        const historyItems = this.#buildConversationHistory(threadId);
        const shouldAutoName = this.#shouldAutoNameThread({ thread, snapshot });

        const prelude = yield* this.#persistAndProject(threadId, [
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
          yield* this.#autoNameThreadFromFirstMessage({ thread, content });
        }

        const stream = yield* runtime.session.startTurn({
          threadId,
          turnId,
          messageId: assistantMessageId,
          userMessage: content,
          contextMessages: this.#buildContextMessages(snapshot),
          historyItems,
          tools: this.#listProviderTools(),
        });

        yield* Stream.runForEach(stream, (providerEvent) =>
          this.#processProviderEvent(thread, runtime, providerEvent),
        ).pipe(
          Effect.catchAll((error) =>
            this.#persistAndProject(threadId, [
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
            ]).pipe(Effect.asVoid),
          ),
          Effect.ensuring(
            Effect.sync(() => this.#runtimeState.clearActiveTurn(threadId)),
          ),
        );

        return yield* fromPromise(() => this.openThread(threadId));
      }.bind(this),
    );

  readonly stopTurn = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const activeTurn = this.#runtimeState.getActiveTurn(threadId);
        if (!activeTurn) {
          return yield* fromPromise(() => this.openThread(threadId));
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
        yield* this.#persistAndProject(threadId, [
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
        return yield* fromPromise(() => this.openThread(threadId));
      }.bind(this),
    );

  readonly #setThreadResolutionState = (
    threadId: string,
    resolutionState: ThreadResolutionState,
  ) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const thread = yield* fromPromise(() => this.openThread(threadId));
        if (thread.resolutionState === resolutionState) {
          return thread;
        }

        const occurredAt = this.#clock.now();
        const record = yield* this.#requireThread(threadId);
        yield* fromSync(() =>
          this.#threadRepository.updateResolutionState(
            threadId,
            resolutionState,
            occurredAt,
          ),
        );

        const projected = yield* this.#persistAndProject(threadId, [
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId: record.providerSessionId,
            occurredAt,
            type:
              resolutionState === "resolved"
                ? "thread.resolved"
                : "thread.reopened",
            payload: {},
          },
        ]);

        return projected.thread;
      }.bind(this),
    );

  readonly resolveThread = (threadId: string) =>
    this.#run(this.#setThreadResolutionState(threadId, "resolved"));

  readonly reopenThread = (threadId: string) =>
    this.#run(this.#setThreadResolutionState(threadId, "open"));

  readonly retryTurn = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const thread = yield* fromPromise(() => this.openThread(threadId));
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

  readonly #ensureSessionEffect = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const thread = yield* this.#requireThread(threadId);
        yield* this.#getOrCreateSessionRuntime(thread);
        return yield* fromPromise(() => this.openThread(threadId));
      }.bind(this),
    );

  readonly ensureSession = (threadId: string) =>
    this.#run(this.#ensureSessionEffect(threadId));

  readonly listThreads = async (workspaceId: string) =>
    this.#threadRepository.listByWorkspace(workspaceId);
}
