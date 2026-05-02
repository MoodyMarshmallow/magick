// Provides shared runtime services such as clock, id generation, publishing, and in-memory runtime state.

import { createId } from "@magick/shared/id";
import { nowIso } from "@magick/shared/time";
import type { ProviderSessionRuntime } from "../modules/provider-runtime/providerTypes";

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

interface RuntimeStateService {
  readonly getSessionRuntime: (
    sessionId: string,
  ) => ProviderSessionRuntime | undefined;
  readonly setSessionRuntime: (
    sessionId: string,
    runtime: ProviderSessionRuntime,
  ) => void;
  readonly clearSessionRuntime: (sessionId: string) => void;
  readonly getActiveTurn: (bookmarkId: string) =>
    | {
        readonly turnId: string;
        readonly sessionId: string;
      }
    | undefined;
  readonly setActiveTurn: (
    bookmarkId: string,
    activeTurn: {
      readonly turnId: string;
      readonly sessionId: string;
    },
  ) => void;
  readonly clearActiveTurn: (bookmarkId: string) => void;
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

  getActiveTurn(bookmarkId: string):
    | {
        readonly turnId: string;
        readonly sessionId: string;
      }
    | undefined {
    return this.#activeTurns.get(bookmarkId);
  }

  setActiveTurn(
    bookmarkId: string,
    activeTurn: {
      readonly turnId: string;
      readonly sessionId: string;
    },
  ): void {
    this.#activeTurns.set(bookmarkId, activeTurn);
  }

  clearActiveTurn(bookmarkId: string): void {
    this.#activeTurns.delete(bookmarkId);
  }
}

export const createRuntimeState = (): RuntimeStateService => {
  return new RuntimeStateClient();
};
