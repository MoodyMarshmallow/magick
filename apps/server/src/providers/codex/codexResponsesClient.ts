// Executes direct Codex HTTP requests, refreshes auth when needed, and parses streaming responses.

import { Effect, Stream } from "effect";

import type { ProviderAuthRecord } from "../../../../../packages/contracts/src/provider";
import { nowIso } from "../../../../../packages/shared/src/time";
import { ProviderFailureError } from "../../effect/errors";
import type { ProviderAuthRepositoryClient } from "../../persistence/providerAuthRepository";
import type { CodexAuthClient } from "./codexAuthClient";

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
  | { readonly type: "output.delta"; readonly delta: string }
  | { readonly type: "output.completed" }
  | { readonly type: "turn.failed"; readonly error: string };

const toProviderFailure = (code: string, detail: string, retryable = true) =>
  new ProviderFailureError({
    providerKey: "codex",
    code,
    detail,
    retryable,
  });

const parseSseFrames = async function* (
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
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
      if (frame.startsWith("data:")) {
        yield frame.slice(5).trim();
      }
      frameEnd = buffer.indexOf("\n\n");
    }
  }

  const remainder = buffer.trim();
  if (remainder.startsWith("data:")) {
    yield remainder.slice(5).trim();
  }
};

const parseResponseItemText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return value.text;
  }

  return "";
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
    return this.#authRepository.get("codex").pipe(
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

        return this.#authClient.refreshAccessToken(record.refreshToken).pipe(
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
            return this.#authRepository
              .upsert(nextRecord)
              .pipe(Effect.as(nextRecord));
          }),
          Effect.catchAll(() =>
            this.#authRepository
              .delete("codex")
              .pipe(
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
      Effect.mapError((error) =>
        error instanceof ProviderFailureError
          ? error
          : toProviderFailure("auth_store_failed", error.detail, false),
      ),
    );
  }

  streamResponse(input: {
    readonly messages: readonly {
      readonly role: string;
      readonly content: string;
    }[];
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
                input: input.messages.map((message) => ({
                  role: message.role,
                  content: [
                    {
                      type: "input_text",
                      text: message.content,
                    },
                  ],
                })),
              }),
              ...(input.signal ? { signal: input.signal } : {}),
            });

            if (!response.ok) {
              throw toProviderFailure(
                response.status === 401 ? "auth_required" : "codex_http_failed",
                `Codex request failed with status ${response.status}.`,
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
          Stream.fromAsyncIterable(parseSseFrames(body), (error) =>
            toProviderFailure(
              "codex_stream_parse_failed",
              error instanceof Error ? error.message : String(error),
            ),
          ).pipe(
            Stream.map((frame) => {
              if (frame === "[DONE]") {
                return { type: "output.completed" } as const;
              }

              const parsed = JSON.parse(frame) as Record<string, unknown>;
              const type = String(parsed.type ?? "");

              if (
                type === "response.output_text.delta" ||
                type === "response.output_text.annotation.delta"
              ) {
                return {
                  type: "output.delta" as const,
                  delta:
                    typeof parsed.delta === "string"
                      ? parsed.delta
                      : parseResponseItemText(parsed.text),
                };
              }

              if (type === "response.completed") {
                return { type: "output.completed" } as const;
              }

              if (type === "response.failed" || type === "error") {
                return {
                  type: "turn.failed" as const,
                  error:
                    typeof parsed.error === "string"
                      ? parsed.error
                      : typeof parsed.message === "string"
                        ? parsed.message
                        : "Codex response failed.",
                };
              }

              return null;
            }),
            Stream.filter(
              (event): event is CodexStreamEvent =>
                event !== null &&
                !(event.type === "output.delta" && event.delta.length === 0),
            ),
          ),
        ),
      ),
    );
  }
}
