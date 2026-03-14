import type { DomainEvent } from "../../../../packages/contracts/src/chat";
import { MagickError } from "../../../../packages/shared/src/errors";
import type { EventStore } from "../persistence/eventStore";
import type { ThreadRepository } from "../persistence/threadRepository";

export class ReplayService {
  readonly #eventStore: EventStore;
  readonly #threadRepository: ThreadRepository;

  constructor(eventStore: EventStore, threadRepository: ThreadRepository) {
    this.#eventStore = eventStore;
    this.#threadRepository = threadRepository;
  }

  getThreadState(threadId: string) {
    const snapshot = this.#threadRepository.getSnapshot(threadId);
    if (!snapshot) {
      throw new MagickError(
        "thread_not_found",
        `Unknown thread '${threadId}'.`,
      );
    }

    return snapshot;
  }

  replayThread(threadId: string, afterSequence = 0): readonly DomainEvent[] {
    return this.#eventStore.listThreadEvents(threadId, afterSequence);
  }
}
