// Executes direct Codex HTTP requests, refreshes auth when needed, and parses streaming responses.

import { Effect, Stream } from "effect";

import type { AssistantOutputChannel } from "@magick/contracts/chat";
import type { ProviderAuthRecord } from "@magick/contracts/provider";
import { maxThreadTitleLength } from "@magick/shared/threadTitle";
import { nowIso } from "@magick/shared/time";
import type { CodexAuthClient } from "../../../auth/codex/codexAuthClient";
import type { ProviderAuthRepositoryClient } from "../../../auth/providerAuthRepository";
import { ProviderFailureError } from "../../runtime/errors";

const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const REFRESH_SAFETY_MARGIN_MS = 60_000;
export interface CodexResponsesClientOptions {
  readonly fetch?: typeof fetch;
  readonly endpoint?: string;
  readonly defaultModel?: string;
  readonly authRepository: ProviderAuthRepositoryClient;
  readonly authClient: CodexAuthClient;
}

type CodexStreamEvent =
  | {
      readonly type: "output.delta";
      readonly channel: AssistantOutputChannel;
      readonly itemKey: string;
      readonly delta: string;
    }
  | {
      readonly type: "output.message.completed";
      readonly channel: AssistantOutputChannel;
      readonly itemKey: string;
    }
  | { readonly type: "turn.completed" }
  | {
      readonly type: "tool.call.requested";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: unknown;
    }
  | { readonly type: "turn.failed"; readonly error: string };

interface CodexConversationMessage {
  readonly role: "user" | "assistant";
  readonly channel?: "commentary" | "final";
  readonly content: string;
}

type ResponsesAssistantPhase = "commentary" | "final_answer";

interface CodexToolCallMessage {
  readonly type: "function_call";
  readonly callId: string;
  readonly name: string;
  readonly input: unknown;
}

interface CodexToolResultMessage {
  readonly type: "function_call_output";
  readonly callId: string;
  readonly output: string;
}

interface CodexToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

type SseMessage = {
  readonly event: string | null;
  readonly data: string;
};

const toProviderFailure = (code: string, detail: string, retryable = true) =>
  new ProviderFailureError({
    providerKey: "codex",
    code,
    detail,
    retryable,
  });

const DEBUG_STREAM = process.env.MAGICK_CODEX_DEBUG === "1";

const logDebug = (label: string, payload: unknown): void => {
  if (!DEBUG_STREAM) {
    return;
  }

  console.debug(`[codex-stream] ${label}`, payload);
};

const summarizeRequestMessages = (
  messages: readonly (
    | CodexConversationMessage
    | CodexToolCallMessage
    | CodexToolResultMessage
  )[],
): readonly string[] =>
  messages.map((message) => {
    if ("type" in message) {
      return message.type === "function_call"
        ? `tool_call:${message.name}`
        : `tool_result:${message.callId}`;
    }

    return `${message.role}:${message.content.slice(0, 40)}`;
  });

const parseSseMessages = async function* (
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let frameEnd = buffer.indexOf("\n\n");
    while (frameEnd !== -1) {
      const frame = buffer.slice(0, frameEnd).trim();
      buffer = buffer.slice(frameEnd + 2);
      if (frame.length > 0) {
        const lines = frame.split("\n");
        let event: string | null = null;
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event:")) {
            event = line.slice(6).trim();
            continue;
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        if (dataLines.length > 0) {
          yield {
            event,
            data: dataLines.join("\n"),
          };
        }
      }
      frameEnd = buffer.indexOf("\n\n");
    }
  }

  const remainder = buffer.trim();
  if (remainder.length > 0) {
    const lines = remainder.split("\n");
    let event: string | null = null;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length > 0) {
      yield {
        event,
        data: dataLines.join("\n"),
      };
    }
  }
};

const parseResponseItemText = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return value.text.length > 0 ? value.text : null;
  }

  return null;
};

const extractString = (
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
};

const extractNumber = (
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
};

const extractDelta = (record: Record<string, unknown>): string => {
  return (
    extractString(record, ["delta", "text", "output_text"]) ??
    parseResponseItemText(record.part) ??
    parseResponseItemText(record.content_part) ??
    parseResponseItemText(record.item) ??
    ""
  );
};

const extractError = (record: Record<string, unknown>): string => {
  const directError = record.error;
  if (typeof directError === "string") {
    return directError;
  }
  if (
    typeof directError === "object" &&
    directError !== null &&
    "message" in directError &&
    typeof directError.message === "string"
  ) {
    return directError.message;
  }

  return (
    extractString(record, ["message", "detail"]) ?? "Codex response failed."
  );
};

const extractMessageText = (item: Record<string, unknown>): string => {
  const content = Array.isArray(item.content) ? item.content : [];
  const textParts: string[] = [];

  for (const part of content) {
    if (typeof part !== "object" || part === null) {
      continue;
    }

    const record = part as Record<string, unknown>;
    const text =
      extractString(record, ["text", "output_text"]) ??
      parseResponseItemText(record.text);
    if (text) {
      textParts.push(text);
    }
  }

  return textParts.join("");
};

const toAssistantChannel = (
  phase: string | null,
): AssistantOutputChannel | null => {
  switch (phase) {
    case "commentary":
      return "commentary";
    case "final_answer":
      return "final";
    default:
      return null;
  }
};

const toResponsesAssistantPhase = (
  channel: AssistantOutputChannel,
): ResponsesAssistantPhase => {
  return channel === "commentary" ? "commentary" : "final_answer";
};

type CodexRawStreamEvent =
  | {
      readonly type: "output.text.delta";
      readonly itemKey: string | null;
      readonly delta: string;
    }
  | {
      readonly type: "output.item.added";
      readonly itemKey: string;
      readonly channel: AssistantOutputChannel;
      readonly text: string;
    }
  | {
      readonly type: "output.item.completed";
      readonly itemKey: string;
      readonly channel: AssistantOutputChannel;
      readonly text: string;
    }
  | { readonly type: "response.completed" }
  | {
      readonly type: "tool.call.requested";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: unknown;
    }
  | { readonly type: "turn.failed"; readonly error: string };

const parseCodexStreamMessage = (
  message: SseMessage,
): readonly CodexRawStreamEvent[] => {
  if (message.data === "[DONE]") {
    return [{ type: "response.completed" }];
  }

  const parsed = JSON.parse(message.data) as Record<string, unknown>;
  const type = String(parsed.type ?? message.event ?? "");
  logDebug("event", { event: message.event, type, payload: parsed });

  switch (type) {
    case "response.created":
    case "response.in_progress":
    case "response.content_part.added":
    case "response.content_part.done":
      return [];
    case "response.output_item.added": {
      const item =
        typeof parsed.item === "object" && parsed.item !== null
          ? (parsed.item as Record<string, unknown>)
          : null;
      if (item?.type !== "message" || item.role !== "assistant") {
        return [];
      }

      const channel = toAssistantChannel(extractString(item, ["phase"]));
      if (!channel) {
        return [];
      }

      const itemKey =
        extractString(item, ["id", "item_id"]) ??
        (extractNumber(parsed, ["output_index", "item_index"]) ?? 0).toString();
      return [
        {
          type: "output.item.added",
          itemKey,
          channel,
          text: extractMessageText(item),
        },
      ];
    }
    case "response.output_text.delta":
    case "response.output_text.annotation.added":
    case "response.content_part.delta": {
      const delta = extractDelta(parsed);
      const outputIndex = extractNumber(parsed, ["output_index", "item_index"]);
      const itemKey =
        extractString(parsed, [
          "item_id",
          "output_item_id",
          "message_id",
          "id",
        ]) ?? (outputIndex === null ? null : String(outputIndex));
      return delta.length > 0
        ? [{ type: "output.text.delta", itemKey, delta }]
        : [];
    }
    case "response.completed":
      return [{ type: "response.completed" }];
    case "response.output_item.done": {
      const item =
        typeof parsed.item === "object" && parsed.item !== null
          ? (parsed.item as Record<string, unknown>)
          : null;
      if (item?.type === "message" && item.role === "assistant") {
        const channel = toAssistantChannel(extractString(item, ["phase"]));
        if (!channel) {
          return [];
        }

        const itemKey =
          extractString(item, ["id", "item_id"]) ??
          (
            extractNumber(parsed, ["output_index", "item_index"]) ?? 0
          ).toString();
        return [
          {
            type: "output.item.completed",
            itemKey,
            channel,
            text: extractMessageText(item),
          },
        ];
      }

      if (item?.type !== "function_call") {
        return [];
      }

      const rawArguments =
        typeof item.arguments === "string" ? item.arguments : "{}";
      let input: unknown = {};
      try {
        input = JSON.parse(rawArguments);
      } catch {
        input = { rawArguments };
      }

      return [
        {
          type: "tool.call.requested",
          toolCallId:
            extractString(item, ["call_id", "id"]) ?? crypto.randomUUID(),
          toolName: extractString(item, ["name"]) ?? "unknown",
          input,
        },
      ];
    }
    case "response.text.done":
      return [];
    case "response.failed":
    case "error":
      return [{ type: "turn.failed", error: extractError(parsed) }];
    default:
      logDebug("ignored", { event: message.event, type, payload: parsed });
      return [];
  }
};

const normalizeGeneratedThreadTitle = (value: string): string | null => {
  const normalized = value
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxThreadTitleLength);
};

interface ActiveAssistantOutputItem {
  readonly itemKey: string;
  readonly channel: AssistantOutputChannel;
  emittedText: string;
  completed: boolean;
}

const toStreamContractFailure = (detail: string): CodexStreamEvent => ({
  type: "turn.failed",
  error: `Invalid Codex Responses stream: ${detail}`,
});

export class CodexResponsesClient {
  readonly #fetch: typeof fetch;
  readonly #endpoint: string;
  readonly #defaultModel: string;
  readonly #authRepository: ProviderAuthRepositoryClient;
  readonly #authClient: CodexAuthClient;

  constructor(options: CodexResponsesClientOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#endpoint = options.endpoint ?? CODEX_API_ENDPOINT;
    this.#defaultModel = options.defaultModel ?? "gpt-5.4";
    this.#authRepository = options.authRepository;
    this.#authClient = options.authClient;
  }

  ensureAuthenticated(): Effect.Effect<
    ProviderAuthRecord,
    ProviderFailureError
  > {
    return Effect.try({
      try: () => this.#authRepository.get("codex"),
      catch: (error) =>
        error instanceof ProviderFailureError
          ? error
          : toProviderFailure(
              "auth_store_failed",
              error instanceof Error ? error.message : String(error),
              false,
            ),
    }).pipe(
      Effect.flatMap((record) => {
        if (!record) {
          return Effect.fail(
            toProviderFailure(
              "auth_required",
              "Codex requires a ChatGPT login before use.",
              false,
            ),
          );
        }

        if (record.expiresAt > Date.now() + REFRESH_SAFETY_MARGIN_MS) {
          return Effect.succeed(record);
        }

        return Effect.tryPromise({
          try: () => this.#authClient.refreshAccessToken(record.refreshToken),
          catch: (error) =>
            error instanceof ProviderFailureError
              ? error
              : toProviderFailure(
                  "auth_required",
                  error instanceof Error ? error.message : String(error),
                  false,
                ),
        }).pipe(
          Effect.flatMap((tokens) => {
            const nextRecord: ProviderAuthRecord = {
              providerKey: "codex",
              authMode: "chatgpt",
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
              expiresAt: tokens.expiresAt,
              accountId: tokens.accountId,
              email: tokens.email,
              planType: record.planType,
              createdAt: record.createdAt,
              updatedAt: nowIso(),
            };
            return Effect.try({
              try: () => this.#authRepository.upsert(nextRecord),
              catch: (error) =>
                error instanceof ProviderFailureError
                  ? error
                  : toProviderFailure(
                      "auth_store_failed",
                      error instanceof Error ? error.message : String(error),
                      false,
                    ),
            }).pipe(Effect.as(nextRecord));
          }),
          Effect.catchAll(() =>
            Effect.sync(() => {
              try {
                this.#authRepository.delete("codex");
              } catch {
                return;
              }
            }).pipe(
              Effect.zipRight(
                Effect.fail(
                  toProviderFailure(
                    "auth_required",
                    "Codex login expired and refresh failed.",
                    false,
                  ),
                ),
              ),
            ),
          ),
        );
      }),
    );
  }

  streamResponse(input: {
    readonly messages: readonly (
      | CodexConversationMessage
      | CodexToolCallMessage
      | CodexToolResultMessage
    )[];
    readonly tools?: readonly CodexToolDefinition[];
    readonly signal?: AbortSignal;
    readonly instructions: string;
  }): Stream.Stream<CodexStreamEvent, ProviderFailureError> {
    logDebug("request", {
      messageCount: input.messages.length,
      messages: summarizeRequestMessages(input.messages),
      toolNames: input.tools?.map((tool) => tool.name) ?? [],
      continuation:
        input.messages.length > 0 &&
        input.messages.every((message) => "type" in message),
    });

    const execute = this.ensureAuthenticated().pipe(
      Effect.flatMap((auth) =>
        Effect.tryPromise({
          try: async () => {
            const response = await this.#fetch(this.#endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${auth.accessToken}`,
                ...(auth.accountId
                  ? { "ChatGPT-Account-Id": auth.accountId }
                  : {}),
              },
              body: JSON.stringify({
                model: this.#defaultModel,
                stream: true,
                store: false,
                instructions: input.instructions,
                tools:
                  input.tools?.map((tool) => ({
                    type: "function",
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  })) ?? [],
                input: input.messages.map((message) => {
                  if ("type" in message) {
                    if (message.type === "function_call") {
                      return {
                        type: "function_call",
                        call_id: message.callId,
                        name: message.name,
                        arguments: JSON.stringify(message.input ?? {}),
                      };
                    }

                    return {
                      type: "function_call_output",
                      call_id: message.callId,
                      output: message.output,
                    };
                  }

                  return {
                    role: message.role,
                    ...(message.role === "assistant" && message.channel
                      ? { phase: toResponsesAssistantPhase(message.channel) }
                      : {}),
                    content: [
                      {
                        type:
                          message.role === "assistant"
                            ? "output_text"
                            : "input_text",
                        text: message.content,
                      },
                    ],
                  };
                }),
              }),
              ...(input.signal ? { signal: input.signal } : {}),
            });

            if (!response.ok) {
              const detail = await response.text().catch(() => "");
              throw toProviderFailure(
                response.status === 401 ? "auth_required" : "codex_http_failed",
                `Codex request failed with status ${response.status}.${detail ? ` ${detail}` : ""}`,
                response.status >= 500,
              );
            }

            if (!response.body) {
              throw toProviderFailure(
                "codex_stream_missing",
                "Codex response did not include a stream body.",
              );
            }

            return response.body;
          },
          catch: (error) =>
            error instanceof ProviderFailureError
              ? error
              : error instanceof DOMException && error.name === "AbortError"
                ? toProviderFailure(
                    "request_aborted",
                    "Codex request aborted.",
                    true,
                  )
                : toProviderFailure(
                    "codex_http_failed",
                    error instanceof Error ? error.message : String(error),
                    true,
                  ),
        }),
      ),
    );

    return Stream.unwrap(
      execute.pipe(
        Effect.map((body) =>
          Stream.fromAsyncIterable(parseSseMessages(body), (error) =>
            toProviderFailure(
              "codex_stream_parse_failed",
              error instanceof Error ? error.message : String(error),
            ),
          ).pipe(
            Stream.flatMap(
              (() => {
                const activeAssistantItems = new Map<
                  string,
                  ActiveAssistantOutputItem
                >();
                let sawToolCall = false;
                let responseCompleted = false;
                let terminalFailureSeen = false;
                let finalItemKey: string | null = null;

                const ensureAssistantItem = (args: {
                  readonly itemKey: string;
                  readonly channel: AssistantOutputChannel;
                }): ActiveAssistantOutputItem => {
                  const existing = activeAssistantItems.get(args.itemKey);
                  if (existing) {
                    return existing;
                  }

                  const nextItem: ActiveAssistantOutputItem = {
                    itemKey: args.itemKey,
                    channel: args.channel,
                    emittedText: "",
                    completed: false,
                  };
                  if (args.channel === "final") {
                    if (finalItemKey && finalItemKey !== args.itemKey) {
                      throw new Error(
                        "received more than one final_answer item in a single turn",
                      );
                    }
                    finalItemKey = args.itemKey;
                  }
                  activeAssistantItems.set(args.itemKey, nextItem);
                  return nextItem;
                };

                const resolveDeltaTarget = (
                  itemKey: string | null,
                ): ActiveAssistantOutputItem | null => {
                  if (itemKey) {
                    const keyedItem = activeAssistantItems.get(itemKey);
                    if (keyedItem && !keyedItem.completed) {
                      return keyedItem;
                    }

                    throw new Error(
                      `received delta for unknown or completed assistant item '${itemKey}'`,
                    );
                  }

                  const activeItems = Array.from(
                    activeAssistantItems.values(),
                  ).filter((item) => !item.completed);
                  if (activeItems.length === 1) {
                    return activeItems[0] ?? null;
                  }

                  throw new Error(
                    activeItems.length === 0
                      ? "received assistant text delta without an active assistant item"
                      : "received assistant text delta without item_id while multiple assistant items were active",
                  );
                };

                const emitCompletionForActiveItems = (
                  nextEvents: CodexStreamEvent[],
                ): void => {
                  for (const item of Array.from(
                    activeAssistantItems.values(),
                  )) {
                    emitCompletion(nextEvents, item, item.emittedText);
                  }
                };

                const emitCompletion = (
                  nextEvents: CodexStreamEvent[],
                  item: ActiveAssistantOutputItem,
                  fullText: string,
                ): void => {
                  if (item.completed) {
                    return;
                  }

                  const remainingText = fullText.slice(item.emittedText.length);
                  if (remainingText.length > 0) {
                    nextEvents.push({
                      type: "output.delta",
                      itemKey: item.itemKey,
                      channel: item.channel,
                      delta: remainingText,
                    });
                    item.emittedText = fullText;
                  }

                  nextEvents.push({
                    type: "output.message.completed",
                    itemKey: item.itemKey,
                    channel: item.channel,
                  });
                  item.completed = true;
                  activeAssistantItems.delete(item.itemKey);
                };

                return (message: SseMessage) => {
                  if (terminalFailureSeen) {
                    return Stream.empty;
                  }

                  const rawEvents = parseCodexStreamMessage(message);
                  const nextEvents: CodexStreamEvent[] = [];

                  try {
                    for (const rawEvent of rawEvents) {
                      switch (rawEvent.type) {
                        case "output.item.added": {
                          const item = ensureAssistantItem({
                            itemKey: rawEvent.itemKey,
                            channel: rawEvent.channel,
                          });
                          if (
                            rawEvent.text.length > 0 &&
                            item.emittedText.length === 0
                          ) {
                            nextEvents.push({
                              type: "output.delta",
                              itemKey: item.itemKey,
                              channel: item.channel,
                              delta: rawEvent.text,
                            });
                            item.emittedText = rawEvent.text;
                          }
                          break;
                        }
                        case "output.text.delta": {
                          const item = resolveDeltaTarget(rawEvent.itemKey);
                          if (!item) {
                            break;
                          }
                          nextEvents.push({
                            type: "output.delta",
                            itemKey: item.itemKey,
                            channel: item.channel,
                            delta: rawEvent.delta,
                          });
                          item.emittedText += rawEvent.delta;
                          break;
                        }
                        case "output.item.completed": {
                          const item = ensureAssistantItem({
                            itemKey: rawEvent.itemKey,
                            channel: rawEvent.channel,
                          });
                          emitCompletion(nextEvents, item, rawEvent.text);
                          break;
                        }
                        case "tool.call.requested":
                          sawToolCall = true;
                          nextEvents.push(rawEvent);
                          break;
                        case "response.completed":
                          if (!responseCompleted) {
                            responseCompleted = true;
                            emitCompletionForActiveItems(nextEvents);
                            if (!sawToolCall) {
                              nextEvents.push({ type: "turn.completed" });
                            }
                          }
                          break;
                        case "turn.failed":
                          terminalFailureSeen = true;
                          nextEvents.push(rawEvent);
                          break;
                      }
                    }
                  } catch (error) {
                    terminalFailureSeen = true;
                    nextEvents.length = 0;
                    nextEvents.push(
                      toStreamContractFailure(
                        error instanceof Error ? error.message : String(error),
                      ),
                    );
                  }

                  return Stream.fromIterable(nextEvents);
                };
              })(),
            ),
          ),
        ),
      ),
    );
  }

  generateThreadTitle(input: {
    readonly firstMessage: string;
    readonly instructions: string;
  }): Effect.Effect<string | null, ProviderFailureError> {
    return Stream.runFold(
      this.streamResponse({
        messages: [{ role: "user", content: input.firstMessage }],
        instructions: input.instructions,
      }),
      "",
      (current, event) => {
        if (event.type === "output.delta") {
          return `${current}${event.delta}`;
        }

        return current;
      },
    ).pipe(Effect.map(normalizeGeneratedThreadTitle));
  }
}
