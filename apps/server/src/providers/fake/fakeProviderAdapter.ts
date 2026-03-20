// Provides a deterministic in-memory provider used for orchestration and transport tests.

import type { ProviderCapabilities } from "@magick/contracts/provider";
import { Effect, Option, Stream } from "effect";
import type { ProviderFailureError } from "../../effect/errors";
import type {
  CreateProviderSessionInput,
  InterruptTurnInput,
  ProviderAdapter,
  ProviderEvent,
  ProviderSessionHandle,
  ResumeProviderSessionInput,
  StartTurnInput,
} from "../providerTypes";

type FakeProviderMode = "stateful" | "stateless";

export interface FakeProviderAdapterOptions {
  readonly key?: string;
  readonly mode: FakeProviderMode;
  readonly chunkDelayMs?: number;
  readonly responder?: (input: StartTurnInput) => string;
}

class FakeProviderSession implements ProviderSessionHandle {
  readonly sessionId: string;
  readonly providerSessionRef: string | null;
  readonly providerThreadRef: string | null;
  readonly #interruptedTurns = new Set<string>();
  readonly #chunkDelayMs: number;
  readonly #responder: (input: StartTurnInput) => string;
  readonly observedInputs: StartTurnInput[] = [];

  constructor(
    sessionId: string,
    providerSessionRef: string | null,
    providerThreadRef: string | null,
    chunkDelayMs: number,
    responder: (input: StartTurnInput) => string,
  ) {
    this.sessionId = sessionId;
    this.providerSessionRef = providerSessionRef;
    this.providerThreadRef = providerThreadRef;
    this.#chunkDelayMs = chunkDelayMs;
    this.#responder = responder;
  }

  readonly startTurn = (
    input: StartTurnInput,
  ): Effect.Effect<
    Stream.Stream<ProviderEvent, ProviderFailureError>,
    ProviderFailureError
  > =>
    Effect.sync(() => {
      this.observedInputs.push(input);
      const content = this.#responder(input);
      const chunks = content.match(/.{1,8}/g) ?? [content];

      const deltas = Stream.fromIterable(chunks).pipe(
        Stream.mapEffect((chunk) =>
          Effect.sleep(`${this.#chunkDelayMs} millis`).pipe(
            Effect.zipRight(
              Effect.sync(() => {
                if (this.#interruptedTurns.has(input.turnId)) {
                  return null;
                }

                return {
                  type: "output.delta" as const,
                  turnId: input.turnId,
                  messageId: input.messageId,
                  delta: chunk,
                } satisfies ProviderEvent;
              }),
            ),
          ),
        ),
        Stream.filterMap((event) =>
          event === null ? Option.none() : Option.some(event),
        ),
      );

      const completed = Stream.unwrap(
        Effect.sync(() => {
          if (this.#interruptedTurns.has(input.turnId)) {
            return Stream.empty;
          }

          return Stream.succeed({
            type: "output.completed" as const,
            turnId: input.turnId,
            messageId: input.messageId,
          } satisfies ProviderEvent);
        }),
      );

      return Stream.concat(deltas, completed);
    });

  readonly interruptTurn = (
    input: InterruptTurnInput,
  ): Effect.Effect<void, ProviderFailureError> =>
    Effect.sync(() => {
      this.#interruptedTurns.add(input.turnId);
    });

  readonly dispose = (): Effect.Effect<void> => Effect.void;
}

export class FakeProviderAdapter implements ProviderAdapter {
  readonly key: string;
  readonly #mode: FakeProviderMode;
  readonly #chunkDelayMs: number;
  readonly #responder: (input: StartTurnInput) => string;
  readonly sessions = new Map<string, FakeProviderSession>();

  constructor(options: FakeProviderAdapterOptions) {
    this.key = options.key ?? "fake";
    this.#mode = options.mode;
    this.#chunkDelayMs = options.chunkDelayMs ?? 0;
    this.#responder =
      options.responder ??
      ((input) =>
        `${this.#mode}:${input.contextMessages.map((message) => message.content).join(" | ")} => ${input.userMessage}`);
  }

  readonly listCapabilities = (): ProviderCapabilities => ({
    supportsNativeResume: this.#mode === "stateful",
    supportsInterrupt: true,
    supportsAttachments: false,
    supportsToolCalls: false,
    supportsApprovals: false,
    supportsServerSideSessions: this.#mode === "stateful",
  });

  readonly getResumeStrategy = () =>
    (this.#mode === "stateful" ? "native" : "rebuild") as "native" | "rebuild";

  readonly createSession = (input: CreateProviderSessionInput) =>
    Effect.sync(() => {
      const session = new FakeProviderSession(
        input.sessionId,
        this.#mode === "stateful" ? `${input.sessionId}:provider` : null,
        this.#mode === "stateful" ? `${input.workspaceId}:thread` : null,
        this.#chunkDelayMs,
        this.#responder,
      );
      this.sessions.set(input.sessionId, session);
      return session;
    });

  readonly resumeSession = (input: ResumeProviderSessionInput) =>
    Effect.sync(() => {
      const existing = this.sessions.get(input.sessionId);
      if (existing) {
        return existing;
      }

      const session = new FakeProviderSession(
        input.sessionId,
        input.providerSessionRef,
        input.providerThreadRef,
        this.#chunkDelayMs,
        this.#responder,
      );
      this.sessions.set(input.sessionId, session);
      return session;
    });
}
