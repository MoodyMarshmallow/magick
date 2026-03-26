// Exposes replay-oriented reads for thread snapshots and event streams.

import type { DomainEvent, ThreadViewModel } from "@magick/contracts/chat";
import { NotFoundError } from "../core/errors";
import type { EventStore } from "../persistence/eventStore";
import type { ThreadRepository } from "../persistence/threadRepository";

export interface ReplayServiceApi {
  readonly getThreadState: (threadId: string) => ThreadViewModel;
  readonly replayThread: (
    threadId: string,
    afterSequence?: number,
  ) => readonly DomainEvent[];
}

export class ReplayService implements ReplayServiceApi {
  readonly #eventStore: EventStore;
  readonly #threadRepository: ThreadRepository;

  constructor(args: {
    eventStore: EventStore;
    threadRepository: ThreadRepository;
  }) {
    this.#eventStore = args.eventStore;
    this.#threadRepository = args.threadRepository;
  }

  getThreadState(threadId: string): ThreadViewModel {
    const snapshot = this.#threadRepository.getSnapshot(threadId);
    if (!snapshot) {
      throw new NotFoundError({ entity: "thread", id: threadId });
    }

    return snapshot;
  }

  replayThread(threadId: string, afterSequence = 0): readonly DomainEvent[] {
    return this.#eventStore.listThreadEvents(threadId, afterSequence);
  }
}
