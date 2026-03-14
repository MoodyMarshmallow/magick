import type {
  DomainEvent,
  ThreadRecord,
  ThreadSummary,
  ThreadViewModel,
} from "../../../../packages/contracts/src/chat";
import type { ProviderSessionRecord } from "../../../../packages/contracts/src/provider";
import {
  MagickError,
  toErrorMessage,
} from "../../../../packages/shared/src/errors";
import { createId } from "../../../../packages/shared/src/id";
import { nowIso } from "../../../../packages/shared/src/time";
import type { EventStore } from "../persistence/eventStore";
import type { ProviderSessionRepository } from "../persistence/providerSessionRepository";
import type { ThreadRepository } from "../persistence/threadRepository";
import {
  projectThreadEvents,
  toThreadSummary,
} from "../projections/threadProjector";
import type {
  ConversationContextMessage,
  EventPublisher,
  ProviderEvent,
  ProviderSessionRuntime,
} from "../providers/providerTypes";
import type { ProviderRegistry } from "./providerRegistry";

export interface CreateThreadInput {
  readonly workspaceId: string;
  readonly providerKey: string;
  readonly title?: string;
}

export class ThreadOrchestrator {
  readonly #providerRegistry: ProviderRegistry;
  readonly #eventStore: EventStore;
  readonly #threadRepository: ThreadRepository;
  readonly #providerSessionRepository: ProviderSessionRepository;
  readonly #publisher: EventPublisher;
  readonly #sessionRuntimeCache = new Map<string, ProviderSessionRuntime>();
  readonly #activeTurns = new Map<
    string,
    {
      turnId: string;
      sessionId: string;
    }
  >();

  constructor(args: {
    providerRegistry: ProviderRegistry;
    eventStore: EventStore;
    threadRepository: ThreadRepository;
    providerSessionRepository: ProviderSessionRepository;
    publisher: EventPublisher;
  }) {
    this.#providerRegistry = args.providerRegistry;
    this.#eventStore = args.eventStore;
    this.#threadRepository = args.threadRepository;
    this.#providerSessionRepository = args.providerSessionRepository;
    this.#publisher = args.publisher;
  }

  async createThread(input: CreateThreadInput): Promise<ThreadViewModel> {
    const adapter = this.#providerRegistry.get(input.providerKey);
    const now = nowIso();
    const providerSessionId = createId("session");
    const threadId = createId("thread");

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
    this.#providerSessionRepository.create(sessionRecord);

    const threadRecord: ThreadRecord = {
      id: threadId,
      workspaceId: input.workspaceId,
      providerKey: input.providerKey,
      providerSessionId,
      title: input.title ?? "New chat",
      createdAt: now,
      updatedAt: now,
    };
    this.#threadRepository.create(threadRecord);

    const events = this.#persistAndProject(threadId, [
      {
        eventId: createId("event"),
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
        eventId: createId("event"),
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

    return events.thread;
  }

  listThreads(workspaceId: string): readonly ThreadSummary[] {
    return this.#threadRepository.listByWorkspace(workspaceId);
  }

  openThread(threadId: string): ThreadViewModel {
    const snapshot = this.#threadRepository.getSnapshot(threadId);
    if (!snapshot) {
      throw new MagickError(
        "thread_not_found",
        `Unknown thread '${threadId}'.`,
      );
    }

    return snapshot;
  }

  async sendMessage(
    threadId: string,
    content: string,
  ): Promise<ThreadViewModel> {
    const thread = this.#requireThread(threadId);
    const snapshot = this.#threadRepository.getSnapshot(threadId);
    if (!snapshot) {
      throw new MagickError(
        "thread_state_missing",
        `Thread '${threadId}' has no snapshot.`,
      );
    }

    if (snapshot.activeTurnId || this.#activeTurns.has(threadId)) {
      throw new MagickError(
        "turn_already_running",
        `Thread '${threadId}' already has an active turn.`,
      );
    }

    const runtime = await this.#getOrCreateSessionRuntime(thread);
    const userEventId = createId("event");
    const turnId = createId("turn");
    const assistantMessageId = createId("message");
    const now = nowIso();

    const prelude = this.#persistAndProject(threadId, [
      {
        eventId: userEventId,
        threadId,
        providerSessionId: thread.providerSessionId,
        occurredAt: now,
        type: "message.user.created",
        payload: {
          messageId: createId("message"),
          content,
        },
      },
      {
        eventId: createId("event"),
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

    this.#activeTurns.set(threadId, {
      turnId,
      sessionId: runtime.recordId,
    });

    try {
      const turnHandle = await runtime.session.startTurn({
        threadId,
        turnId,
        messageId: assistantMessageId,
        userMessage: content,
        contextMessages: this.#buildContextMessages(prelude.thread),
      });

      for await (const providerEvent of turnHandle.events()) {
        const projection = this.#applyProviderEvent(
          threadId,
          thread.providerSessionId,
          providerEvent,
        );

        if (projection.thread.status !== "running") {
          this.#activeTurns.delete(threadId);
        }
      }
    } catch (error) {
      const providerError = runtime.adapter.normalizeError(error);
      this.#persistAndProject(threadId, [
        {
          eventId: createId("event"),
          threadId,
          providerSessionId: thread.providerSessionId,
          occurredAt: nowIso(),
          type: "turn.failed",
          payload: {
            turnId,
            error: providerError.message,
          },
        },
      ]);
      this.#activeTurns.delete(threadId);
    }

    return this.openThread(threadId);
  }

  async stopTurn(threadId: string): Promise<ThreadViewModel> {
    const activeTurn = this.#activeTurns.get(threadId);
    if (!activeTurn) {
      return this.openThread(threadId);
    }

    const runtime = this.#sessionRuntimeCache.get(activeTurn.sessionId);
    if (!runtime) {
      throw new MagickError(
        "provider_session_missing",
        `No runtime found for session '${activeTurn.sessionId}'.`,
      );
    }

    await runtime.session.interruptTurn({
      turnId: activeTurn.turnId,
      reason: "Interrupted by user",
    });

    this.#persistAndProject(threadId, [
      {
        eventId: createId("event"),
        threadId,
        providerSessionId: runtime.recordId,
        occurredAt: nowIso(),
        type: "turn.interrupted",
        payload: {
          turnId: activeTurn.turnId,
          reason: "Interrupted by user",
        },
      },
    ]);
    this.#activeTurns.delete(threadId);

    return this.openThread(threadId);
  }

  async retryTurn(threadId: string): Promise<ThreadViewModel> {
    const thread = this.openThread(threadId);
    const lastUserMessage = [...thread.messages]
      .reverse()
      .find((message) => message.role === "user");

    if (!lastUserMessage) {
      throw new MagickError(
        "retry_not_possible",
        `Thread '${threadId}' has no user message to retry.`,
      );
    }

    return this.sendMessage(threadId, lastUserMessage.content);
  }

  async ensureSession(threadId: string): Promise<ThreadViewModel> {
    const thread = this.#requireThread(threadId);
    await this.#getOrCreateSessionRuntime(thread);
    return this.openThread(threadId);
  }

  async replayThread(
    threadId: string,
    afterSequence = 0,
  ): Promise<readonly DomainEvent[]> {
    return this.#eventStore.listThreadEvents(threadId, afterSequence);
  }

  async #getOrCreateSessionRuntime(
    thread: ThreadRecord,
  ): Promise<ProviderSessionRuntime> {
    const cached = this.#sessionRuntimeCache.get(thread.providerSessionId);
    if (cached) {
      return cached;
    }

    const adapter = this.#providerRegistry.get(thread.providerKey);
    const sessionRecord = this.#providerSessionRepository.get(
      thread.providerSessionId,
    );
    if (!sessionRecord) {
      throw new MagickError(
        "provider_session_missing",
        `Unknown provider session '${thread.providerSessionId}'.`,
      );
    }

    const session = sessionRecord.providerSessionRef
      ? await adapter.resumeSession({
          workspaceId: thread.workspaceId,
          sessionId: sessionRecord.id,
          providerSessionRef: sessionRecord.providerSessionRef,
          providerThreadRef: sessionRecord.providerThreadRef,
        })
      : await adapter.createSession({
          workspaceId: thread.workspaceId,
          sessionId: sessionRecord.id,
        });

    const runtime = {
      recordId: sessionRecord.id,
      session,
      adapter,
    };
    this.#sessionRuntimeCache.set(sessionRecord.id, runtime);
    return runtime;
  }

  #buildContextMessages(
    thread: ThreadViewModel,
  ): readonly ConversationContextMessage[] {
    return thread.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  #applyProviderEvent(
    threadId: string,
    providerSessionId: string,
    providerEvent: ProviderEvent,
  ) {
    switch (providerEvent.type) {
      case "output.delta":
        return this.#persistAndProject(threadId, [
          {
            eventId: createId("event"),
            threadId,
            providerSessionId,
            occurredAt: nowIso(),
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
            eventId: createId("event"),
            threadId,
            providerSessionId,
            occurredAt: nowIso(),
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
            eventId: createId("event"),
            threadId,
            providerSessionId,
            occurredAt: nowIso(),
            type: "turn.failed",
            payload: {
              turnId: providerEvent.turnId,
              error: providerEvent.error,
            },
          },
        ]);
      case "session.disconnected":
        this.#providerSessionRepository.updateStatus(
          providerSessionId,
          "disconnected",
          nowIso(),
        );
        return this.#persistAndProject(threadId, [
          {
            eventId: createId("event"),
            threadId,
            providerSessionId,
            occurredAt: nowIso(),
            type: "provider.session.disconnected",
            payload: {
              reason: providerEvent.reason,
            },
          },
        ]);
      case "session.recovered":
        this.#providerSessionRepository.updateStatus(
          providerSessionId,
          "active",
          nowIso(),
        );
        return this.#persistAndProject(threadId, [
          {
            eventId: createId("event"),
            threadId,
            providerSessionId,
            occurredAt: nowIso(),
            type: "provider.session.recovered",
            payload: {
              reason: providerEvent.reason,
            },
          },
        ]);
    }
  }

  #persistAndProject(
    threadId: string,
    events: readonly Omit<DomainEvent, "sequence">[],
  ): {
    readonly events: readonly DomainEvent[];
    readonly thread: ThreadViewModel;
  } {
    const persistedEvents = this.#eventStore.append(threadId, events);
    const projectedThread = projectThreadEvents(
      this.#threadRepository.getSnapshot(threadId),
      persistedEvents,
    );
    this.#threadRepository.saveSnapshot(
      threadId,
      toThreadSummary(projectedThread),
      projectedThread,
    );

    void this.#publisher.publish(persistedEvents).catch((error) => {
      console.error("event_publish_failed", {
        threadId,
        error: toErrorMessage(error),
      });
    });

    return {
      events: persistedEvents,
      thread: projectedThread,
    };
  }

  #requireThread(threadId: string): ThreadRecord {
    const thread = this.#threadRepository.get(threadId);
    if (!thread) {
      throw new MagickError(
        "thread_not_found",
        `Unknown thread '${threadId}'.`,
      );
    }

    return thread;
  }
}
