// Provides a deterministic in-memory provider used for orchestration and transport tests.

import type { ProviderCapabilities } from "@magick/contracts/provider";
import { Effect, Option, Stream } from "effect";
import type { ProviderFailureError } from "../../core/errors";
import type {
  CreateProviderSessionInput,
  InterruptTurnInput,
  ProviderAdapter,
  ProviderEvent,
  ProviderSessionHandle,
  ResumeProviderSessionInput,
  StartTurnInput,
  SubmitToolResultInput,
} from "../providerTypes";

type FakeProviderMode = "stateful" | "stateless";

export type FakeProviderResponse =
  | string
  | {
      readonly toolName: string;
      readonly input: Record<string, unknown>;
      readonly onResult: (output: string) => FakeProviderResponse;
    };

export interface FakeProviderAdapterOptions {
  readonly key?: string;
  readonly mode: FakeProviderMode;
  readonly chunkDelayMs?: number;
  readonly responder?: (input: StartTurnInput) => FakeProviderResponse;
}

class FakeProviderSession implements ProviderSessionHandle {
  readonly sessionId: string;
  readonly providerSessionRef: string | null;
  readonly providerThreadRef: string | null;
  readonly #interruptedTurns = new Set<string>();
  readonly #pendingToolContinuations = new Map<
    string,
    {
      readonly toolCallId: string;
      readonly toolName: string;
      readonly onResult: (output: string) => FakeProviderResponse;
    }
  >();
  readonly #chunkDelayMs: number;
  readonly #responder: (input: StartTurnInput) => FakeProviderResponse;
  readonly observedInputs: StartTurnInput[] = [];

  constructor(
    sessionId: string,
    providerSessionRef: string | null,
    providerThreadRef: string | null,
    chunkDelayMs: number,
    responder: (input: StartTurnInput) => FakeProviderResponse,
  ) {
    this.sessionId = sessionId;
    this.providerSessionRef = providerSessionRef;
    this.providerThreadRef = providerThreadRef;
    this.#chunkDelayMs = chunkDelayMs;
    this.#responder = responder;
  }

  readonly #streamTextResponse = (
    turnId: string,
    messageId: string,
    content: string,
  ): Stream.Stream<ProviderEvent, ProviderFailureError> => {
    const chunks = content.match(/.{1,8}/g) ?? [content];

    const deltas = Stream.fromIterable(chunks).pipe(
      Stream.mapEffect((chunk) =>
        Effect.sleep(`${this.#chunkDelayMs} millis`).pipe(
          Effect.zipRight(
            Effect.sync(() => {
              if (this.#interruptedTurns.has(turnId)) {
                return null;
              }

              return {
                type: "output.delta" as const,
                turnId,
                messageId,
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
        if (this.#interruptedTurns.has(turnId)) {
          return Stream.empty;
        }

        return Stream.succeed({
          type: "output.completed" as const,
          turnId,
          messageId,
        } satisfies ProviderEvent);
      }),
    );

    return Stream.concat(deltas, completed);
  };

  readonly #streamResponse = (
    turnId: string,
    messageId: string,
    response: FakeProviderResponse,
  ): Stream.Stream<ProviderEvent, ProviderFailureError> => {
    if (typeof response === "string") {
      return this.#streamTextResponse(turnId, messageId, response);
    }

    const toolCallId = `${turnId}:tool:${response.toolName}`;
    this.#pendingToolContinuations.set(turnId, {
      toolCallId,
      toolName: response.toolName,
      onResult: response.onResult,
    });

    return Stream.succeed({
      type: "tool.call.requested" as const,
      turnId,
      toolCallId,
      toolName: response.toolName,
      input: response.input,
    } satisfies ProviderEvent);
  };

  readonly startTurn = (
    input: StartTurnInput,
  ): Effect.Effect<
    Stream.Stream<ProviderEvent, ProviderFailureError>,
    ProviderFailureError
  > =>
    Effect.sync(() => {
      this.observedInputs.push(input);
      return this.#streamResponse(
        input.turnId,
        input.messageId,
        this.#responder(input),
      );
    });

  readonly submitToolResult = (
    input: SubmitToolResultInput,
  ): Effect.Effect<
    Stream.Stream<ProviderEvent, ProviderFailureError>,
    ProviderFailureError
  > =>
    Effect.sync(() => {
      const pendingContinuation = this.#pendingToolContinuations.get(
        input.turnId,
      );
      if (
        !pendingContinuation ||
        pendingContinuation.toolCallId !== input.toolCallId ||
        pendingContinuation.toolName !== input.toolName
      ) {
        return Stream.succeed({
          type: "turn.failed" as const,
          turnId: input.turnId,
          error: `Missing pending tool continuation for '${input.toolCallId}'.`,
        } satisfies ProviderEvent);
      }

      this.#pendingToolContinuations.delete(input.turnId);
      return this.#streamResponse(
        input.turnId,
        `${input.turnId}:assistant`,
        pendingContinuation.onResult(input.output),
      );
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
  readonly #responder: (input: StartTurnInput) => FakeProviderResponse;
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
    supportsToolCalls: true,
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
