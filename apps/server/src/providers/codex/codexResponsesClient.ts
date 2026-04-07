// Executes direct Codex HTTP requests, refreshes auth when needed, and parses streaming responses.

import { Effect, Stream } from "effect";

import type { ProviderAuthRecord } from "@magick/contracts/provider";
import { nowIso } from "@magick/shared/time";
import { ProviderFailureError } from "../../core/errors";
import type { ProviderAuthRepositoryClient } from "../../persistence/providerAuthRepository";
import type { CodexAuthClient } from "./codexAuthClient";

const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const REFRESH_SAFETY_MARGIN_MS = 60_000;
const CODEX_SYSTEM_PROMPT =
  "You are Magick's assistant for research, learning, and document work inside the user's workspace. Use tools sparingly, keep file paths relative to the workspace root, and present concise, provenance-aware results. When writing math in markdown, always use dollar-delimited LaTeX: `$...$` for inline math and `$$...$$` for display math. Do not use `\\(...\\)` or `\\[...\\]` delimiters.";

export interface CodexResponsesClientOptions {
  readonly fetch?: typeof fetch;
  readonly endpoint?: string;
  readonly defaultModel?: string;
  readonly authRepository: ProviderAuthRepositoryClient;
  readonly authClient: CodexAuthClient;
}

type CodexStreamEvent =
  | { readonly type: "output.delta"; readonly delta: string }
  | { readonly type: "output.completed" }
  | {
      readonly type: "tool.call.requested";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: unknown;
    }
  | { readonly type: "turn.failed"; readonly error: string };

interface CodexConversationMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
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

const parseCodexStreamMessage = (
  message: SseMessage,
): readonly CodexStreamEvent[] => {
  if (message.data === "[DONE]") {
    return [{ type: "output.completed" }];
  }

  const parsed = JSON.parse(message.data) as Record<string, unknown>;
  const type = String(parsed.type ?? message.event ?? "");
  logDebug("event", { event: message.event, type, payload: parsed });

  switch (type) {
    case "response.created":
    case "response.in_progress":
    case "response.output_item.added":
    case "response.content_part.added":
    case "response.content_part.done":
      return [];
    case "response.output_text.delta":
    case "response.output_text.annotation.added":
    case "response.content_part.delta": {
      const delta = extractDelta(parsed);
      return delta.length > 0 ? [{ type: "output.delta", delta }] : [];
    }
    case "response.completed":
      return [{ type: "output.completed" }];
    case "response.output_item.done": {
      const item =
        typeof parsed.item === "object" && parsed.item !== null
          ? (parsed.item as Record<string, unknown>)
          : null;
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

export class CodexResponsesClient {
  readonly #fetch: typeof fetch;
  readonly #endpoint: string;
  readonly #defaultModel: string;
  readonly #authRepository: ProviderAuthRepositoryClient;
  readonly #authClient: CodexAuthClient;

  constructor(options: CodexResponsesClientOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#endpoint = options.endpoint ?? CODEX_API_ENDPOINT;
    this.#defaultModel = options.defaultModel ?? "gpt-5.3-codex";
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
      | CodexToolResultMessage
    )[];
    readonly tools?: readonly CodexToolDefinition[];
    readonly signal?: AbortSignal;
  }): Stream.Stream<CodexStreamEvent, ProviderFailureError> {
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
                instructions: CODEX_SYSTEM_PROMPT,
                tools:
                  input.tools?.map((tool) => ({
                    type: "function",
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  })) ?? [],
                input: input.messages.map((message) => {
                  if ("type" in message) {
                    return {
                      type: "function_call_output",
                      call_id: message.callId,
                      output: message.output,
                    };
                  }

                  return {
                    role: message.role,
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
            Stream.flatMap((message) =>
              Stream.fromIterable(parseCodexStreamMessage(message)),
            ),
          ),
        ),
      ),
    );
  }
}
