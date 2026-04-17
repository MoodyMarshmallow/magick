import type { DomainEvent, FileDiffPreview } from "@magick/contracts/chat";

import type { ProviderEvent } from "../../providers/providerTypes";
import type { EventPublisherService } from "../../runtime/runtime";
import { fromPromise, fromSync } from "../domain/threadEffect";
import {
  projectThreadEvents,
  toThreadSummary,
} from "../domain/threadProjector";
import type { EventStore } from "../persistence/eventStore";
import type { ProviderSessionRepository } from "../persistence/providerSessionRepository";
import type { ThreadRepository } from "../persistence/threadRepository";

export class ThreadEventPersistence {
  readonly #eventStore: EventStore;
  readonly #threadRepository: ThreadRepository;
  readonly #providerSessionRepository: ProviderSessionRepository;
  readonly #publisher: EventPublisherService;
  readonly #clock: { readonly now: () => string };
  readonly #idGenerator: { readonly next: (prefix: string) => string };

  constructor(args: {
    eventStore: EventStore;
    threadRepository: ThreadRepository;
    providerSessionRepository: ProviderSessionRepository;
    publisher: EventPublisherService;
    clock: { readonly now: () => string };
    idGenerator: { readonly next: (prefix: string) => string };
  }) {
    this.#eventStore = args.eventStore;
    this.#threadRepository = args.threadRepository;
    this.#providerSessionRepository = args.providerSessionRepository;
    this.#publisher = args.publisher;
    this.#clock = args.clock;
    this.#idGenerator = args.idGenerator;
  }

  readonly persistAndProject = (
    threadId: string,
    events: readonly Omit<DomainEvent, "sequence">[],
  ) =>
    Effect.gen(
      function* (this: ThreadEventPersistence) {
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

  readonly applyToolRequestedEvent = (
    threadId: string,
    providerSessionId: string,
    providerEvent: Extract<
      ProviderEvent,
      { readonly type: "tool.call.requested" }
    >,
  ) => {
    const metadata = this.#extractToolLocationMetadata(providerEvent.input);
    return this.persistAndProject(threadId, [
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

  readonly persistToolStarted = (
    threadId: string,
    providerSessionId: string,
    turnId: string,
    toolCallId: string,
  ) =>
    this.persistAndProject(threadId, [
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

  readonly persistToolCompleted = (
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
    this.persistAndProject(threadId, [
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

  readonly persistToolFailed = (
    threadId: string,
    providerSessionId: string,
    turnId: string,
    toolCallId: string,
    error: string,
    modelOutput: string,
  ) =>
    this.persistAndProject(threadId, [
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

  readonly applyProviderEvent = (
    threadId: string,
    providerSessionId: string,
    providerEvent: ProviderEvent,
  ) => {
    switch (providerEvent.type) {
      case "output.delta":
        return this.persistAndProject(threadId, [
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId,
            occurredAt: this.#clock.now(),
            type: "message.assistant.delta",
            payload: {
              turnId: providerEvent.turnId,
              messageId: providerEvent.messageId,
              channel: providerEvent.channel,
              delta: providerEvent.delta,
            },
          },
        ]);
      case "output.message.completed":
        return this.persistAndProject(threadId, [
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId,
            occurredAt: this.#clock.now(),
            type: "message.assistant.completed",
            payload: {
              turnId: providerEvent.turnId,
              messageId: providerEvent.messageId,
              channel: providerEvent.channel,
            },
          },
        ]);
      case "turn.completed":
        return this.persistAndProject(threadId, [
          {
            eventId: this.#idGenerator.next("event"),
            threadId,
            providerSessionId,
            occurredAt: this.#clock.now(),
            type: "turn.completed",
            payload: {
              turnId: providerEvent.turnId,
            },
          },
        ]);
      case "turn.failed":
        return this.persistAndProject(threadId, [
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
            this.persistAndProject(threadId, [
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
            this.persistAndProject(threadId, [
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
        return null;
    }
  };
}

import { Effect } from "effect";
