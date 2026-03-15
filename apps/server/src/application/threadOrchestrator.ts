// Coordinates thread lifecycle, provider execution, persistence, and event projection.

import { Context, Effect, Layer, Stream } from "effect";

import type {
  DomainEvent,
  ThreadRecord,
  ThreadSummary,
  ThreadViewModel,
} from "../../../../packages/contracts/src/chat";
import type { ProviderSessionRecord } from "../../../../packages/contracts/src/provider";
import {
  type BackendError,
  InvalidStateError,
  NotFoundError,
  backendErrorMessage,
} from "../effect/errors";
import {
  Clock,
  EventPublisher,
  IdGenerator,
  RuntimeState,
} from "../effect/runtime";
import { EventStore } from "../persistence/eventStore";
import { ProviderSessionRepository } from "../persistence/providerSessionRepository";
import { ThreadRepository } from "../persistence/threadRepository";
import {
  projectThreadEvents,
  toThreadSummary,
} from "../projections/threadProjector";
import {
  type ConversationContextMessage,
  type ProviderEvent,
  ProviderRegistry,
  type ProviderSessionRuntime,
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

export const ThreadOrchestrator = Context.GenericTag<ThreadOrchestratorApi>(
  "@magick/ThreadOrchestrator",
);

export const ThreadOrchestratorLive = Layer.effect(
  ThreadOrchestrator,
  Effect.gen(function* () {
    const providerRegistry = yield* ProviderRegistry;
    const eventStore = yield* EventStore;
    const threadRepository = yield* ThreadRepository;
    const providerSessionRepository = yield* ProviderSessionRepository;
    const publisher = yield* EventPublisher;
    const runtimeState = yield* RuntimeState;
    const clock = yield* Clock;
    const idGenerator = yield* IdGenerator;

    const requireThread = (threadId: string) =>
      Effect.gen(function* () {
        const thread = yield* threadRepository.get(threadId);
        if (!thread) {
          return yield* Effect.fail(
            new NotFoundError({ entity: "thread", id: threadId }),
          );
        }

        return thread;
      });

    const openThread = (threadId: string) =>
      Effect.gen(function* () {
        const snapshot = yield* threadRepository.getSnapshot(threadId);
        if (!snapshot) {
          return yield* Effect.fail(
            new NotFoundError({ entity: "thread", id: threadId }),
          );
        }

        return snapshot;
      });

    const buildContextMessages = (
      thread: ThreadViewModel,
    ): readonly ConversationContextMessage[] => {
      return thread.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
    };

    const persistAndProject = (
      threadId: string,
      events: readonly Omit<DomainEvent, "sequence">[],
    ) =>
      Effect.gen(function* () {
        const persistedEvents = yield* eventStore.append(threadId, events);
        const projectedThread = projectThreadEvents(
          yield* threadRepository.getSnapshot(threadId),
          persistedEvents,
        );

        yield* threadRepository.saveSnapshot(
          threadId,
          toThreadSummary(projectedThread),
          projectedThread,
        );

        yield* publisher
          .publish(persistedEvents)
          .pipe(Effect.catchAllCause(() => Effect.void));

        return {
          events: persistedEvents,
          thread: projectedThread,
        } as const;
      });

    const applyProviderEvent = (
      threadId: string,
      providerSessionId: string,
      providerEvent: ProviderEvent,
    ) => {
      switch (providerEvent.type) {
        case "output.delta":
          return persistAndProject(threadId, [
            {
              eventId: idGenerator.next("event"),
              threadId,
              providerSessionId,
              occurredAt: clock.now(),
              type: "turn.delta",
              payload: {
                turnId: providerEvent.turnId,
                messageId: providerEvent.messageId,
                delta: providerEvent.delta,
              },
            },
          ]);
        case "output.completed":
          return persistAndProject(threadId, [
            {
              eventId: idGenerator.next("event"),
              threadId,
              providerSessionId,
              occurredAt: clock.now(),
              type: "turn.completed",
              payload: {
                turnId: providerEvent.turnId,
                messageId: providerEvent.messageId,
              },
            },
          ]);
        case "turn.failed":
          return persistAndProject(threadId, [
            {
              eventId: idGenerator.next("event"),
              threadId,
              providerSessionId,
              occurredAt: clock.now(),
              type: "turn.failed",
              payload: {
                turnId: providerEvent.turnId,
                error: providerEvent.error,
              },
            },
          ]);
        case "session.disconnected":
          return providerSessionRepository
            .updateStatus(providerSessionId, "disconnected", clock.now())
            .pipe(
              Effect.flatMap(() =>
                persistAndProject(threadId, [
                  {
                    eventId: idGenerator.next("event"),
                    threadId,
                    providerSessionId,
                    occurredAt: clock.now(),
                    type: "provider.session.disconnected",
                    payload: {
                      reason: providerEvent.reason,
                    },
                  },
                ]),
              ),
            );
        case "session.recovered":
          return providerSessionRepository
            .updateStatus(providerSessionId, "active", clock.now())
            .pipe(
              Effect.flatMap(() =>
                persistAndProject(threadId, [
                  {
                    eventId: idGenerator.next("event"),
                    threadId,
                    providerSessionId,
                    occurredAt: clock.now(),
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

    const getOrCreateSessionRuntime = (thread: ThreadRecord) =>
      Effect.gen(function* () {
        const cached = yield* runtimeState.getSessionRuntime(
          thread.providerSessionId,
        );
        if (cached) {
          return cached;
        }

        const adapter = yield* providerRegistry.get(thread.providerKey);
        const sessionRecord = yield* providerSessionRepository.get(
          thread.providerSessionId,
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
          yield* providerSessionRepository.updateRefs(sessionRecord.id, {
            providerSessionRef: session.providerSessionRef,
            providerThreadRef: session.providerThreadRef,
            updatedAt: clock.now(),
          });
        }

        yield* runtimeState.setSessionRuntime(sessionRecord.id, runtime);
        return runtime;
      });

    const createThread = (input: CreateThreadInput) =>
      Effect.gen(function* () {
        const adapter = yield* providerRegistry.get(input.providerKey);
        const now = clock.now();
        const providerSessionId = idGenerator.next("session");
        const threadId = idGenerator.next("thread");

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
        yield* providerSessionRepository.create(sessionRecord);

        const threadRecord: ThreadRecord = {
          id: threadId,
          workspaceId: input.workspaceId,
          providerKey: input.providerKey,
          providerSessionId,
          title: input.title ?? "New chat",
          createdAt: now,
          updatedAt: now,
        };
        yield* threadRepository.create(threadRecord);

        const created = yield* persistAndProject(threadId, [
          {
            eventId: idGenerator.next("event"),
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
            eventId: idGenerator.next("event"),
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
      });

    const sendMessage = (threadId: string, content: string) =>
      Effect.gen(function* () {
        const thread = yield* requireThread(threadId);
        const snapshot = yield* openThread(threadId);

        const activeTurn = yield* runtimeState.getActiveTurn(threadId);
        if (snapshot.activeTurnId || activeTurn) {
          return yield* Effect.fail(
            new InvalidStateError({
              code: "turn_already_running",
              detail: `Thread '${threadId}' already has an active turn.`,
            }),
          );
        }

        const runtime = yield* getOrCreateSessionRuntime(thread);
        const turnId = idGenerator.next("turn");
        const assistantMessageId = idGenerator.next("message");
        const now = clock.now();

        const prelude = yield* persistAndProject(threadId, [
          {
            eventId: idGenerator.next("event"),
            threadId,
            providerSessionId: thread.providerSessionId,
            occurredAt: now,
            type: "message.user.created",
            payload: {
              messageId: idGenerator.next("message"),
              content,
            },
          },
          {
            eventId: idGenerator.next("event"),
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

        yield* runtimeState.setActiveTurn(threadId, {
          turnId,
          sessionId: runtime.recordId,
        });

        const stream = yield* runtime.session.startTurn({
          threadId,
          turnId,
          messageId: assistantMessageId,
          userMessage: content,
          contextMessages: buildContextMessages(prelude.thread),
        });

        yield* Stream.runForEach(stream, (providerEvent) =>
          applyProviderEvent(
            threadId,
            thread.providerSessionId,
            providerEvent,
          ).pipe(Effect.asVoid),
        ).pipe(
          Effect.catchAll((error) =>
            persistAndProject(threadId, [
              {
                eventId: idGenerator.next("event"),
                threadId,
                providerSessionId: thread.providerSessionId,
                occurredAt: clock.now(),
                type: "turn.failed",
                payload: {
                  turnId,
                  error: backendErrorMessage(error),
                },
              },
            ]).pipe(Effect.asVoid),
          ),
          Effect.ensuring(runtimeState.clearActiveTurn(threadId)),
        );

        return yield* openThread(threadId);
      });

    const stopTurn = (threadId: string) =>
      Effect.gen(function* () {
        const activeTurn = yield* runtimeState.getActiveTurn(threadId);
        if (!activeTurn) {
          return yield* openThread(threadId);
        }

        const runtime = yield* runtimeState.getSessionRuntime(
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
        yield* persistAndProject(threadId, [
          {
            eventId: idGenerator.next("event"),
            threadId,
            providerSessionId: runtime.recordId,
            occurredAt: clock.now(),
            type: "turn.interrupted",
            payload: {
              turnId: activeTurn.turnId,
              reason: "Interrupted by user",
            },
          },
        ]);
        yield* runtimeState.clearActiveTurn(threadId);
        return yield* openThread(threadId);
      });

    const retryTurn = (threadId: string) =>
      Effect.gen(function* () {
        const thread = yield* openThread(threadId);
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

        return yield* sendMessage(threadId, lastUserMessage.content);
      });

    const ensureSession = (threadId: string) =>
      Effect.gen(function* () {
        const thread = yield* requireThread(threadId);
        yield* getOrCreateSessionRuntime(thread);
        return yield* openThread(threadId);
      });

    return {
      createThread,
      listThreads: (workspaceId: string) =>
        threadRepository.listByWorkspace(workspaceId),
      openThread,
      sendMessage,
      stopTurn,
      retryTurn,
      ensureSession,
    } satisfies ThreadOrchestratorApi;
  }),
);
