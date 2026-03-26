// Coordinates thread lifecycle, provider execution, persistence, and event projection.

import { Effect, Stream } from "effect";

import type {
  DomainEvent,
  ThreadRecord,
  ThreadSummary,
  ThreadViewModel,
} from "@magick/contracts/chat";
import type { ProviderSessionRecord } from "@magick/contracts/provider";
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
  ProviderEvent,
  ProviderRegistryService,
  ProviderSessionRuntime,
} from "../providers/providerTypes";

export interface CreateThreadInput {
  readonly workspaceId: string;
  readonly providerKey: string;
  readonly title?: string;
}

export interface ThreadOrchestratorApi {
  readonly createThread: (
    input: CreateThreadInput,
  ) => Effect.Effect<ThreadViewModel, BackendError>;
  readonly listThreads: (
    workspaceId: string,
  ) => Effect.Effect<readonly ThreadSummary[], BackendError>;
  readonly openThread: (
    threadId: string,
  ) => Effect.Effect<ThreadViewModel, BackendError>;
  readonly sendMessage: (
    threadId: string,
    content: string,
  ) => Effect.Effect<ThreadViewModel, BackendError>;
  readonly stopTurn: (
    threadId: string,
  ) => Effect.Effect<ThreadViewModel, BackendError>;
  readonly retryTurn: (
    threadId: string,
  ) => Effect.Effect<ThreadViewModel, BackendError>;
  readonly ensureSession: (
    threadId: string,
  ) => Effect.Effect<ThreadViewModel, BackendError>;
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

  constructor(args: {
    providerRegistry: ProviderRegistryService;
    eventStore: EventStore;
    threadRepository: ThreadRepository;
    providerSessionRepository: ProviderSessionRepository;
    publisher: EventPublisherService;
    runtimeState: RuntimeStateService;
    clock: ClockService;
    idGenerator: IdGeneratorService;
  }) {
    this.#providerRegistry = args.providerRegistry;
    this.#eventStore = args.eventStore;
    this.#threadRepository = args.threadRepository;
    this.#providerSessionRepository = args.providerSessionRepository;
    this.#publisher = args.publisher;
    this.#runtimeState = args.runtimeState;
    this.#clock = args.clock;
    this.#idGenerator = args.idGenerator;
  }

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

  readonly openThread = (threadId: string) =>
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

  readonly #buildContextMessages = (
    thread: ThreadViewModel,
  ): readonly ConversationContextMessage[] => {
    return thread.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  };

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
    }
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

  readonly createThread = (input: CreateThreadInput) =>
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
          title: input.title ?? "New chat",
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

  readonly sendMessage = (threadId: string, content: string) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const thread = yield* this.#requireThread(threadId);
        const snapshot = yield* this.openThread(threadId);

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

        const stream = yield* runtime.session.startTurn({
          threadId,
          turnId,
          messageId: assistantMessageId,
          userMessage: content,
          contextMessages: this.#buildContextMessages(prelude.thread),
        });

        yield* Stream.runForEach(stream, (providerEvent) =>
          this.#applyProviderEvent(
            threadId,
            thread.providerSessionId,
            providerEvent,
          ).pipe(Effect.asVoid),
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

        return yield* this.openThread(threadId);
      }.bind(this),
    );

  readonly stopTurn = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const activeTurn = this.#runtimeState.getActiveTurn(threadId);
        if (!activeTurn) {
          return yield* this.openThread(threadId);
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
        return yield* this.openThread(threadId);
      }.bind(this),
    );

  readonly retryTurn = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const thread = yield* this.openThread(threadId);
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

  readonly ensureSession = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadOrchestrator) {
        const thread = yield* this.#requireThread(threadId);
        yield* this.#getOrCreateSessionRuntime(thread);
        return yield* this.openThread(threadId);
      }.bind(this),
    );

  readonly listThreads = (workspaceId: string) =>
    fromSync(() => this.#threadRepository.listByWorkspace(workspaceId));
}
