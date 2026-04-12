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
  readonly #turnResponseStates = new Map<
    string,
    {
      commentaryIndex: number;
      activeMessageIdByItemKey: Map<string, string>;
    }
  >();

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
      readonly channel: "commentary" | "final" | null;
      readonly content: string;
    }[];
    readonly userMessage?: string;
  }) => {
    const historyMessages =
      args.historyItems.length > 0
        ? args.historyItems.map((item) => {
            switch (item.type) {
              case "message":
                return item.role === "assistant"
                  ? {
                      role: item.role,
                      channel: item.channel ?? "final",
                      content: item.content,
                    }
                  : {
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
        : args.contextMessages.map((message) =>
            message.role === "assistant"
              ? {
                  role: message.role,
                  channel: message.channel ?? "final",
                  content: message.content,
                }
              : {
                  role: message.role,
                  content: message.content,
                },
          );

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

  readonly #createResponseEventMapper = (args: {
    readonly turnId: string;
    readonly finalMessageId: string;
  }) => {
    const responseState = this.#turnResponseStates.get(args.turnId) ?? {
      commentaryIndex: 0,
      activeMessageIdByItemKey: new Map<string, string>(),
    };
    this.#turnResponseStates.set(args.turnId, responseState);

    const resolveMessageId = (message: {
      readonly itemKey: string;
      readonly channel: "commentary" | "final";
    }) => {
      const existing = responseState.activeMessageIdByItemKey.get(
        message.itemKey,
      );
      if (existing) {
        return existing;
      }

      const nextId =
        message.channel === "final"
          ? args.finalMessageId
          : `${args.turnId}:assistant:commentary:${responseState.commentaryIndex++}`;
      responseState.activeMessageIdByItemKey.set(message.itemKey, nextId);
      return nextId;
    };

    return (
      event:
        | {
            readonly type: "output.delta";
            readonly itemKey: string;
            readonly channel: "commentary" | "final";
            readonly delta: string;
          }
        | {
            readonly type: "output.message.completed";
            readonly itemKey: string;
            readonly channel: "commentary" | "final";
          }
        | { readonly type: "turn.completed" }
        | {
            readonly type: "tool.call.requested";
            readonly toolCallId: string;
            readonly toolName: string;
            readonly input: unknown;
          }
        | { readonly type: "turn.failed"; readonly error: string },
    ) => {
      switch (event.type) {
        case "output.delta": {
          const messageId = resolveMessageId({
            itemKey: event.itemKey,
            channel: event.channel,
          });
          return {
            type: "output.delta" as const,
            turnId: args.turnId,
            messageId,
            channel: event.channel,
            delta: event.delta,
          } satisfies ProviderEvent;
        }
        case "output.message.completed": {
          const messageId = resolveMessageId({
            itemKey: event.itemKey,
            channel: event.channel,
          });
          responseState.activeMessageIdByItemKey.delete(event.itemKey);
          return {
            type: "output.message.completed" as const,
            turnId: args.turnId,
            messageId,
            channel: event.channel,
          } satisfies ProviderEvent;
        }
        case "turn.completed":
          this.#turnResponseStates.delete(args.turnId);
          return {
            type: "turn.completed" as const,
            turnId: args.turnId,
          } satisfies ProviderEvent;
        case "tool.call.requested":
          return {
            type: "tool.call.requested" as const,
            turnId: args.turnId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: event.input,
          } satisfies ProviderEvent;
        case "turn.failed":
          this.#turnResponseStates.delete(args.turnId);
          return {
            type: "turn.failed" as const,
            turnId: args.turnId,
            error: event.error,
          } satisfies ProviderEvent;
      }
    };
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
          Stream.map(
            this.#createResponseEventMapper({
              turnId: input.turnId,
              finalMessageId: `${input.turnId}:assistant:final`,
            }),
          ),
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
          Stream.map(
            this.#createResponseEventMapper({
              turnId: input.turnId,
              finalMessageId: `${input.turnId}:assistant:final`,
            }),
          ),
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
      this.#turnResponseStates.delete(input.turnId);
    });

  readonly dispose = (): Effect.Effect<void> =>
    Effect.sync(() => {
      this.#activeAbortController?.abort();
      this.#activeAbortController = null;
      this.#activeTurnId = null;
      this.#turnResponseStates.clear();
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
