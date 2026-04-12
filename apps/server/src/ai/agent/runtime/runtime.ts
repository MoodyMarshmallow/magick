// Provides shared runtime services such as clock, id generation, publishing, and in-memory runtime state.

import type { DomainEvent } from "@magick/contracts/chat";
import { createId } from "@magick/shared/id";
import { nowIso } from "@magick/shared/time";
import type { ProviderSessionRuntime } from "../providers/providerTypes";

export interface ClockService {
  readonly now: () => string;
}

export const createClock = (): ClockService => ({
  now: nowIso,
});

export interface IdGeneratorService {
  readonly next: (prefix: string) => string;
}

export const createIdGenerator = (): IdGeneratorService => ({
  next: createId,
});

export interface EventPublisherService {
  readonly publish: (events: readonly DomainEvent[]) => Promise<void>;
}

export interface RuntimeStateService {
  readonly getSessionRuntime: (
    sessionId: string,
  ) => ProviderSessionRuntime | undefined;
  readonly setSessionRuntime: (
    sessionId: string,
    runtime: ProviderSessionRuntime,
  ) => void;
  readonly clearSessionRuntime: (sessionId: string) => void;
  readonly getActiveTurn: (threadId: string) =>
    | {
        readonly turnId: string;
        readonly sessionId: string;
      }
    | undefined;
  readonly setActiveTurn: (
    threadId: string,
    activeTurn: {
      readonly turnId: string;
      readonly sessionId: string;
    },
  ) => void;
  readonly clearActiveTurn: (threadId: string) => void;
}

class RuntimeStateClient implements RuntimeStateService {
  readonly #sessionRuntimes = new Map<string, ProviderSessionRuntime>();
  readonly #activeTurns = new Map<
    string,
    {
      readonly turnId: string;
      readonly sessionId: string;
    }
  >();

  getSessionRuntime(sessionId: string): ProviderSessionRuntime | undefined {
    return this.#sessionRuntimes.get(sessionId);
  }

  setSessionRuntime(sessionId: string, runtime: ProviderSessionRuntime): void {
    this.#sessionRuntimes.set(sessionId, runtime);
  }

  clearSessionRuntime(sessionId: string): void {
    this.#sessionRuntimes.delete(sessionId);
  }

  getActiveTurn(threadId: string):
    | {
        readonly turnId: string;
        readonly sessionId: string;
      }
    | undefined {
    return this.#activeTurns.get(threadId);
  }

  setActiveTurn(
    threadId: string,
    activeTurn: {
      readonly turnId: string;
      readonly sessionId: string;
    },
  ): void {
    this.#activeTurns.set(threadId, activeTurn);
  }

  clearActiveTurn(threadId: string): void {
    this.#activeTurns.delete(threadId);
  }
}

export const createRuntimeState = (): RuntimeStateService => {
  return new RuntimeStateClient();
};
