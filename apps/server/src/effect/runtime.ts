// Provides shared runtime services such as clock, id generation, publishing, and in-memory runtime state.

import { Context, Effect, Layer, Ref } from "effect";

import type { DomainEvent } from "@magick/contracts/chat";
import { createId } from "@magick/shared/id";
import { nowIso } from "@magick/shared/time";
import type { ProviderSessionRuntime } from "../providers/providerTypes";

export interface ClockService {
  readonly now: () => string;
}

export const Clock = Context.GenericTag<ClockService>("@magick/Clock");

export const ClockLive = Layer.succeed(Clock, {
  now: nowIso,
});

export interface IdGeneratorService {
  readonly next: (prefix: string) => string;
}

export const IdGenerator = Context.GenericTag<IdGeneratorService>(
  "@magick/IdGenerator",
);

export const IdGeneratorLive = Layer.succeed(IdGenerator, {
  next: createId,
});

export interface EventPublisherService {
  readonly publish: (events: readonly DomainEvent[]) => Effect.Effect<void>;
}

export const EventPublisher = Context.GenericTag<EventPublisherService>(
  "@magick/EventPublisher",
);

export interface RuntimeStateService {
  readonly getSessionRuntime: (
    sessionId: string,
  ) => Effect.Effect<ProviderSessionRuntime | undefined>;
  readonly setSessionRuntime: (
    sessionId: string,
    runtime: ProviderSessionRuntime,
  ) => Effect.Effect<void>;
  readonly getActiveTurn: (threadId: string) => Effect.Effect<
    | {
        readonly turnId: string;
        readonly sessionId: string;
      }
    | undefined
  >;
  readonly setActiveTurn: (
    threadId: string,
    activeTurn: {
      readonly turnId: string;
      readonly sessionId: string;
    },
  ) => Effect.Effect<void>;
  readonly clearActiveTurn: (threadId: string) => Effect.Effect<void>;
}

export const RuntimeState = Context.GenericTag<RuntimeStateService>(
  "@magick/RuntimeState",
);

export const RuntimeStateLive = Layer.effect(
  RuntimeState,
  Effect.gen(function* () {
    const sessionRuntimes = yield* Ref.make(
      new Map<string, ProviderSessionRuntime>(),
    );
    const activeTurns = yield* Ref.make(
      new Map<
        string,
        {
          readonly turnId: string;
          readonly sessionId: string;
        }
      >(),
    );

    return {
      getSessionRuntime: (sessionId: string) =>
        Ref.get(sessionRuntimes).pipe(
          Effect.map((runtimes) => runtimes.get(sessionId)),
        ),
      setSessionRuntime: (sessionId: string, runtime: ProviderSessionRuntime) =>
        Ref.update(sessionRuntimes, (runtimes) => {
          const next = new Map(runtimes);
          next.set(sessionId, runtime);
          return next;
        }),
      getActiveTurn: (threadId: string) =>
        Ref.get(activeTurns).pipe(Effect.map((turns) => turns.get(threadId))),
      setActiveTurn: (threadId: string, activeTurn) =>
        Ref.update(activeTurns, (turns) => {
          const next = new Map(turns);
          next.set(threadId, activeTurn);
          return next;
        }),
      clearActiveTurn: (threadId: string) =>
        Ref.update(activeTurns, (turns) => {
          const next = new Map(turns);
          next.delete(threadId);
          return next;
        }),
    } satisfies RuntimeStateService;
  }),
);
