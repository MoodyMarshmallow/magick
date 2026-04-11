// Bridges Magick provider interfaces to the direct Codex auth and HTTP runtime.

import { Effect, Stream } from "effect";

import type { ProviderCapabilities } from "@magick/contracts/provider";
import type { ProviderFailureError } from "../../core/errors";
import type { ProviderAuthRepositoryClient } from "../../persistence/providerAuthRepository";
import type {
  ConversationHistoryItem,
  CreateProviderSessionInput,
  GenerateThreadTitleInput,
  InterruptTurnInput,
  ProviderAdapter,
  ProviderEvent,
  ProviderSessionHandle,
  ResumeProviderSessionInput,
  StartTurnInput,
  SubmitToolResultInput,
} from "../providerTypes";
import {
  CodexAuthClient,
  type CodexAuthClientOptions,
} from "./codexAuthClient";
import {
  CodexResponsesClient,
  type CodexResponsesClientOptions,
} from "./codexResponsesClient";

interface CodexRuntimeFactory {
  readonly createSession: (
    input: CreateProviderSessionInput,
  ) => Effect.Effect<ProviderSessionHandle, ProviderFailureError>;
  readonly generateThreadTitle: (
    input: GenerateThreadTitleInput,
  ) => Effect.Effect<string | null, ProviderFailureError>;
  readonly resumeSession: (
    input: ResumeProviderSessionInput,
  ) => Effect.Effect<ProviderSessionHandle, ProviderFailureError>;
}

interface CodexProviderOptions
  extends Omit<CodexResponsesClientOptions, "authClient" | "authRepository">,
    CodexAuthClientOptions {
  readonly authRepository: ProviderAuthRepositoryClient;
  readonly authClient?: CodexAuthClient;
}

class CodexSessionHandle implements ProviderSessionHandle {
  readonly sessionId: string;
  readonly providerSessionRef: string | null = null;
  readonly providerThreadRef: string | null = null;
  readonly #responsesClient: CodexResponsesClient;
  #activeAbortController: AbortController | null = null;
  #activeTurnId: string | null = null;

  constructor(args: {
    sessionId: string;
    responsesClient: CodexResponsesClient;
  }) {
    this.sessionId = args.sessionId;
    this.#responsesClient = args.responsesClient;
  }

  readonly #toCodexMessages = (args: {
    readonly historyItems: readonly ConversationHistoryItem[];
    readonly contextMessages: readonly {
      readonly role: "user" | "assistant";
      readonly content: string;
    }[];
    readonly userMessage?: string;
  }) => {
    const historyMessages =
      args.historyItems.length > 0
        ? args.historyItems.map((item) => {
            switch (item.type) {
              case "message":
                return {
                  role: item.role,
                  content: item.content,
                };
              case "tool_call":
                return {
                  type: "function_call" as const,
                  callId: item.toolCallId,
                  name: item.toolName,
                  input: item.input,
                };
              case "tool_result":
                return {
                  type: "function_call_output" as const,
                  callId: item.toolCallId,
                  output: item.output,
                };
            }
          })
        : args.contextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          }));

    return args.userMessage
      ? [
          ...historyMessages,
          {
            role: "user" as const,
            content: args.userMessage,
          },
        ]
      : historyMessages;
  };

  readonly startTurn = (
    input: StartTurnInput,
  ): Effect.Effect<
    Stream.Stream<ProviderEvent, ProviderFailureError>,
    ProviderFailureError
  > =>
    Effect.sync(() => {
      this.#activeAbortController = new AbortController();
      this.#activeTurnId = input.turnId;

      return this.#responsesClient
        .streamResponse({
          messages: this.#toCodexMessages({
            historyItems: input.historyItems,
            contextMessages: input.contextMessages,
            userMessage: input.userMessage,
          }),
          instructions: input.instructions,
          tools: input.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
          signal: this.#activeAbortController.signal,
        })
        .pipe(
          Stream.map((event) => {
            switch (event.type) {
              case "output.delta":
                return {
                  type: "output.delta" as const,
                  turnId: input.turnId,
                  messageId: input.messageId,
                  delta: event.delta,
                } satisfies ProviderEvent;
              case "output.completed":
                return {
                  type: "output.completed" as const,
                  turnId: input.turnId,
                  messageId: input.messageId,
                } satisfies ProviderEvent;
              case "tool.call.requested":
                return {
                  type: "tool.call.requested" as const,
                  turnId: input.turnId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  input: event.input,
                } satisfies ProviderEvent;
              case "turn.failed":
                return {
                  type: "turn.failed" as const,
                  turnId: input.turnId,
                  error: event.error,
                } satisfies ProviderEvent;
            }
          }),
          Stream.ensuring(
            Effect.sync(() => {
              this.#activeAbortController = null;
              this.#activeTurnId = null;
            }),
          ),
        );
    });

  readonly submitToolResult = (
    input: SubmitToolResultInput,
  ): Effect.Effect<
    Stream.Stream<ProviderEvent, ProviderFailureError>,
    ProviderFailureError
  > =>
    Effect.sync(() =>
      this.#responsesClient
        .streamResponse({
          messages: this.#toCodexMessages({
            historyItems: input.historyItems,
            contextMessages: [],
          }),
          instructions: input.instructions,
          tools: input.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        })
        .pipe(
          Stream.map((event) => {
            switch (event.type) {
              case "output.delta":
                return {
                  type: "output.delta" as const,
                  turnId: input.turnId,
                  messageId: `${input.turnId}:assistant`,
                  delta: event.delta,
                } satisfies ProviderEvent;
              case "output.completed":
                return {
                  type: "output.completed" as const,
                  turnId: input.turnId,
                  messageId: `${input.turnId}:assistant`,
                } satisfies ProviderEvent;
              case "tool.call.requested":
                return {
                  type: "tool.call.requested" as const,
                  turnId: input.turnId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  input: event.input,
                } satisfies ProviderEvent;
              case "turn.failed":
                return {
                  type: "turn.failed" as const,
                  turnId: input.turnId,
                  error: event.error,
                } satisfies ProviderEvent;
            }
          }),
        ),
    );

  readonly interruptTurn = (
    input: InterruptTurnInput,
  ): Effect.Effect<void, ProviderFailureError> =>
    Effect.sync(() => {
      if (this.#activeTurnId === input.turnId && this.#activeAbortController) {
        this.#activeAbortController.abort();
        this.#activeAbortController = null;
        this.#activeTurnId = null;
      }
    });

  readonly dispose = (): Effect.Effect<void> =>
    Effect.sync(() => {
      this.#activeAbortController?.abort();
      this.#activeAbortController = null;
      this.#activeTurnId = null;
    });
}

export const createCodexRuntimeFactory = (
  options: CodexProviderOptions,
): CodexRuntimeFactory => {
  const authClient = options.authClient ?? new CodexAuthClient(options);
  const responsesClient = new CodexResponsesClient({
    ...options,
    authRepository: options.authRepository,
    authClient,
  });

  return {
    createSession: (input) =>
      Effect.succeed(
        new CodexSessionHandle({
          sessionId: input.sessionId,
          responsesClient,
        }),
      ),
    generateThreadTitle: (input) => responsesClient.generateThreadTitle(input),
    resumeSession: (input) =>
      Effect.succeed(
        new CodexSessionHandle({
          sessionId: input.sessionId,
          responsesClient,
        }),
      ),
  };
};

export class CodexProviderAdapter implements ProviderAdapter {
  readonly key = "codex";
  readonly #runtimeFactory: CodexRuntimeFactory;

  constructor(runtimeFactory: CodexRuntimeFactory) {
    this.#runtimeFactory = runtimeFactory;
  }

  readonly listCapabilities = (): ProviderCapabilities => ({
    supportsNativeResume: false,
    supportsInterrupt: true,
    supportsAttachments: false,
    supportsToolCalls: true,
    supportsApprovals: false,
    supportsServerSideSessions: false,
  });

  readonly getResumeStrategy = () => "rebuild" as const;

  readonly createSession = (input: CreateProviderSessionInput) =>
    this.#runtimeFactory.createSession(input);

  readonly generateThreadTitle = (input: GenerateThreadTitleInput) =>
    this.#runtimeFactory.generateThreadTitle(input);

  readonly resumeSession = (input: ResumeProviderSessionInput) =>
    this.#runtimeFactory.resumeSession(input);
}
