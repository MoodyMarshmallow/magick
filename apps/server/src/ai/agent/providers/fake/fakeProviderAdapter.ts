// Provides a deterministic in-memory provider used for orchestration and transport tests.

import type {
  AssistantCompletionReason,
  AssistantOutputChannel,
} from "@magick/contracts/chat";
import type { ProviderCapabilities } from "@magick/contracts/provider";
import { Effect, Option, Stream } from "effect";
import type { ProviderFailureError } from "../../runtime/errors";
import type {
  CreateProviderSessionInput,
  GenerateThreadTitleInput,
  InterruptTurnInput,
  ProviderAdapter,
  ProviderEvent,
  ProviderSessionHandle,
  ResumeProviderSessionInput,
  StartTurnInput,
  SubmitToolResultsInput,
} from "../providerTypes";

type FakeProviderMode = "stateful" | "stateless";

export type FakeProviderResponse =
  | string
  | {
      readonly channel: AssistantOutputChannel;
      readonly content: string;
    }
  | readonly FakeProviderResponseStep[]
  | FakeToolResponse;

type FakeProviderResponseStep =
  | string
  | {
      readonly channel: AssistantOutputChannel;
      readonly content: string;
    }
  | FakeToolResponse;

interface FakeToolResponse {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly onResult: (output: string) => FakeProviderResponse;
}

interface FakeProviderAdapterOptions {
  readonly key?: string;
  readonly mode: FakeProviderMode;
  readonly chunkDelayMs?: number;
  readonly responder?: (input: StartTurnInput) => FakeProviderResponse;
  readonly titleGenerator?: (input: GenerateThreadTitleInput) => string | null;
}

class FakeProviderSession implements ProviderSessionHandle {
  readonly sessionId: string;
  readonly providerSessionRef: string | null;
  readonly providerThreadRef: string | null;
  readonly #interruptedTurns = new Set<string>();
  readonly #pendingToolContinuations = new Map<
    string,
    Map<
      string,
      {
        readonly toolCallId: string;
        readonly toolName: string;
        readonly onResult: (output: string) => FakeProviderResponse;
      }
    >
  >();
  readonly #chunkDelayMs: number;
  readonly #responder: (input: StartTurnInput) => FakeProviderResponse;
  readonly #turnMessageState = new Map<
    string,
    {
      commentaryIndex: number;
    }
  >();
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
    response:
      | string
      | { readonly channel: AssistantOutputChannel; readonly content: string },
    reason: AssistantCompletionReason = "stop",
  ): Stream.Stream<ProviderEvent, ProviderFailureError> => {
    const turnMessageState = this.#turnMessageState.get(turnId) ?? {
      commentaryIndex: 0,
    };
    this.#turnMessageState.set(turnId, turnMessageState);

    const messages =
      typeof response === "string"
        ? [{ channel: "final" as const, content: response }]
        : [response];

    const events: ProviderEvent[] = [];

    for (const message of messages) {
      const messageId =
        message.channel === "final"
          ? `${turnId}:assistant:final`
          : `${turnId}:assistant:commentary:${turnMessageState.commentaryIndex++}`;
      const chunks = message.content.match(/.{1,8}/g) ?? [message.content];

      for (const chunk of chunks) {
        events.push({
          type: "output.delta",
          turnId,
          messageId,
          channel: message.channel,
          delta: chunk,
        });
      }

      events.push({
        type: "output.message.completed",
        turnId,
        messageId,
        channel: message.channel,
        reason,
      });
    }

    return Stream.fromIterable(events).pipe(
      Stream.mapEffect((event) =>
        Effect.sleep(`${this.#chunkDelayMs} millis`).pipe(
          Effect.zipRight(
            Effect.sync(() => {
              if (
                this.#interruptedTurns.has(turnId) &&
                event.type !== "turn.completed"
              ) {
                return null;
              }

              if (
                this.#interruptedTurns.has(turnId) &&
                event.type === "turn.completed"
              ) {
                return null;
              }

              return event;
            }),
          ),
        ),
      ),
      Stream.filterMap((event) =>
        event === null ? Option.none() : Option.some(event),
      ),
    );
  };

  readonly #streamResponse = (
    turnId: string,
    response: FakeProviderResponse,
  ): Stream.Stream<ProviderEvent, ProviderFailureError> => {
    const completedTurnEvent = () =>
      Stream.succeed(null).pipe(
        Stream.map(() => {
          if (this.#interruptedTurns.has(turnId)) {
            this.#turnMessageState.delete(turnId);
            return null;
          }

          this.#turnMessageState.delete(turnId);
          return {
            type: "turn.completed" as const,
            turnId,
          } satisfies ProviderEvent;
        }),
        Stream.filterMap((event) =>
          event === null ? Option.none() : Option.some(event),
        ),
      );

    if (typeof response === "string") {
      return Stream.concat(
        this.#streamTextResponse(turnId, response),
        completedTurnEvent(),
      );
    }

    if (Array.isArray(response)) {
      const streams = response.map((step, index) => {
        const nextStep = response[index + 1];
        const reason: AssistantCompletionReason =
          nextStep &&
          typeof nextStep === "object" &&
          nextStep !== null &&
          "toolName" in nextStep
            ? "tool_calls"
            : "stop";

        if (typeof step === "string" || "channel" in step) {
          return this.#streamTextResponse(turnId, step, reason);
        }

        return this.#streamResponse(turnId, step);
      });
      const [firstStream, ...remainingStreams] = streams;
      const combinedStream = remainingStreams.reduce(
        (combinedStream, nextStream) =>
          Stream.concat(combinedStream, nextStream),
        firstStream ?? Stream.empty,
      );

      const lastStep = response.at(-1);
      const shouldCompleteTurn =
        lastStep !== undefined &&
        !(
          typeof lastStep === "object" &&
          lastStep !== null &&
          "toolName" in lastStep
        );

      if (!shouldCompleteTurn) {
        return combinedStream;
      }

      return Stream.concat(combinedStream, completedTurnEvent());
    }

    if ("channel" in response) {
      return Stream.concat(
        this.#streamTextResponse(turnId, response),
        completedTurnEvent(),
      );
    }

    const toolResponse = response as FakeToolResponse;
    const toolCallId = `${turnId}:tool:${toolResponse.toolName}`;
    const pendingContinuations =
      this.#pendingToolContinuations.get(turnId) ?? new Map();
    pendingContinuations.set(toolCallId, {
      toolCallId,
      toolName: toolResponse.toolName,
      onResult: toolResponse.onResult,
    });
    this.#pendingToolContinuations.set(turnId, pendingContinuations);

    return Stream.succeed({
      type: "tool.call.requested" as const,
      turnId,
      toolCallId,
      toolName: toolResponse.toolName,
      input: toolResponse.input,
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
      return this.#streamResponse(input.turnId, this.#responder(input));
    });

  readonly submitToolResults = (
    input: SubmitToolResultsInput,
  ): Effect.Effect<
    Stream.Stream<ProviderEvent, ProviderFailureError>,
    ProviderFailureError
  > =>
    Effect.sync(() => {
      const pendingContinuations = this.#pendingToolContinuations.get(
        input.turnId,
      );
      if (!pendingContinuations || pendingContinuations.size === 0) {
        return Stream.succeed({
          type: "turn.failed" as const,
          turnId: input.turnId,
          error: `Missing pending tool continuations for '${input.turnId}'.`,
        } satisfies ProviderEvent);
      }

      this.#pendingToolContinuations.delete(input.turnId);
      const toolResultsById = new Map(
        input.toolResults.map((result) => [result.toolCallId, result]),
      );
      const pendingEntries = Array.from(pendingContinuations.values());
      if (
        pendingEntries.length !== input.toolResults.length ||
        pendingEntries.some((pending) => {
          const result = toolResultsById.get(pending.toolCallId);
          return !result || result.toolName !== pending.toolName;
        })
      ) {
        return Stream.succeed({
          type: "turn.failed" as const,
          turnId: input.turnId,
          error: `Missing pending tool continuation results for '${input.turnId}'.`,
        } satisfies ProviderEvent);
      }

      const nextResponses = pendingEntries.flatMap((pending) => {
        const toolResult = toolResultsById.get(pending.toolCallId);
        if (!toolResult) {
          return [];
        }
        const response = pending.onResult(toolResult.output);
        return Array.isArray(response) ? response : [response];
      });

      return this.#streamResponse(
        input.turnId,
        nextResponses.length === 1 ? (nextResponses[0] ?? []) : nextResponses,
      );
    });

  readonly interruptTurn = (
    input: InterruptTurnInput,
  ): Effect.Effect<void, ProviderFailureError> =>
    Effect.sync(() => {
      this.#interruptedTurns.add(input.turnId);
      this.#turnMessageState.delete(input.turnId);
    });

  readonly dispose = (): Effect.Effect<void> => Effect.void;
}

export class FakeProviderAdapter implements ProviderAdapter {
  readonly key: string;
  readonly #mode: FakeProviderMode;
  readonly #chunkDelayMs: number;
  readonly #responder: (input: StartTurnInput) => FakeProviderResponse;
  readonly #titleGenerator: (input: GenerateThreadTitleInput) => string | null;
  readonly sessions = new Map<string, FakeProviderSession>();

  constructor(options: FakeProviderAdapterOptions) {
    this.key = options.key ?? "fake";
    this.#mode = options.mode;
    this.#chunkDelayMs = options.chunkDelayMs ?? 0;
    this.#responder =
      options.responder ??
      ((input) =>
        `${this.#mode}:${input.contextMessages.map((message) => message.content).join(" | ")} => ${input.userMessage}`);
    this.#titleGenerator = options.titleGenerator ?? (() => null);
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

  readonly generateThreadTitle = (input: GenerateThreadTitleInput) =>
    Effect.sync(() => this.#titleGenerator(input));

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
