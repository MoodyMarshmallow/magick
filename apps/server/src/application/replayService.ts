// Exposes replay-oriented reads for thread snapshots and event streams.

import { Context, Effect, Layer } from "effect";

import type {
  DomainEvent,
  ThreadViewModel,
} from "../../../../packages/contracts/src/chat";
import type { BackendError } from "../effect/errors";
import { NotFoundError } from "../effect/errors";
import { EventStore } from "../persistence/eventStore";
import { ThreadRepository } from "../persistence/threadRepository";

export interface ReplayServiceApi {
  readonly getThreadState: (
    threadId: string,
  ) => Effect.Effect<ThreadViewModel, BackendError>;
  readonly replayThread: (
    threadId: string,
    afterSequence?: number,
  ) => Effect.Effect<readonly DomainEvent[], BackendError>;
}

export const ReplayService = Context.GenericTag<ReplayServiceApi>(
  "@magick/ReplayService",
);

export const ReplayServiceLive = Layer.effect(
  ReplayService,
  Effect.gen(function* () {
    const eventStore = yield* EventStore;
    const threadRepository = yield* ThreadRepository;

    return {
      getThreadState: (threadId: string) =>
        Effect.gen(function* () {
          const snapshot = yield* threadRepository.getSnapshot(threadId);
          if (!snapshot) {
            return yield* Effect.fail(
              new NotFoundError({ entity: "thread", id: threadId }),
            );
          }

          return snapshot;
        }),
      replayThread: (threadId: string, afterSequence = 0) =>
        eventStore.listThreadEvents(threadId, afterSequence),
    } satisfies ReplayServiceApi;
  }),
);
