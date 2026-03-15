import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

import { Effect, Stream } from "effect";

import type {
  ProviderAuthAccount,
  ProviderAuthLoginStartResult,
} from "../../../../../packages/contracts/src/provider";
import { ProviderFailureError } from "../../effect/errors";

interface JsonRpcRequest {
  readonly id: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

type CodexProviderStreamEvent =
  | {
      readonly type: "output.delta";
      readonly turnId: string;
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: "output.completed";
      readonly turnId: string;
      readonly messageId: string;
    }
  | {
      readonly type: "turn.failed";
      readonly turnId: string;
      readonly error: string;
    }
  | {
      readonly type: "session.disconnected";
      readonly reason: string;
    };

interface JsonRpcResponse {
  readonly id: number;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

interface JsonRpcNotification {
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface CodexAppServerClientInfo {
  readonly name: string;
  readonly title: string;
  readonly version: string;
}

export interface CodexAppServerSpawnOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface SpawnedProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
}

export type CodexSpawn = (
  options: CodexAppServerSpawnOptions,
) => SpawnedProcess;

export interface CodexInitializeResult {
  readonly protocolVersion?: string;
  readonly platformFamily?: string;
  readonly platformOs?: string;
  readonly userAgent?: string;
}

export interface CodexAccountReadResult {
  readonly account: ProviderAuthAccount | null;
  readonly requiresOpenaiAuth: boolean;
}

export interface CodexLoginCompletedResult {
  readonly loginId: string | null;
  readonly success: boolean;
  readonly error: string | null;
}

const defaultSpawn: CodexSpawn = (options) => {
  return spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: options.env,
    stdio: "pipe",
  }) as ChildProcessWithoutNullStreams;
};

const toProviderError = (code: string, detail: string, retryable = false) =>
  new ProviderFailureError({
    providerKey: "codex",
    code,
    detail,
    retryable,
  });

const safeJsonParse = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

const isNotification = (message: unknown): message is JsonRpcNotification => {
  return (
    typeof message === "object" &&
    message !== null &&
    "method" in message &&
    typeof message.method === "string" &&
    !("id" in message)
  );
};

const isResponse = (message: unknown): message is JsonRpcResponse => {
  return (
    typeof message === "object" &&
    message !== null &&
    "id" in message &&
    typeof message.id === "number"
  );
};

class CodexAppServerTransport {
  readonly #process: SpawnedProcess;
  readonly #pending = new Map<
    number,
    {
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: ProviderFailureError) => void;
    }
  >();
  readonly #notifications = new EventEmitter();
  readonly #stderrLines: string[] = [];
  readonly #stdoutBuffer = { value: "" };
  readonly #stderrBuffer = { value: "" };
  #nextRequestId = 1;
  #closed = false;

  constructor(process: SpawnedProcess) {
    this.#process = process;
    this.#process.stdout.on("data", (chunk) => {
      this.#consumeBuffer(this.#stdoutBuffer, chunk.toString(), (line) => {
        const parsed = safeJsonParse(line);
        if (isResponse(parsed)) {
          const pending = this.#pending.get(parsed.id);
          if (!pending) {
            return;
          }

          this.#pending.delete(parsed.id);
          if (parsed.error) {
            pending.reject(
              toProviderError(
                `json_rpc_${parsed.error.code}`,
                parsed.error.message,
                parsed.error.code === -32001,
              ),
            );
            return;
          }

          pending.resolve(parsed.result ?? {});
          return;
        }

        if (isNotification(parsed)) {
          this.#notifications.emit(parsed.method, parsed.params ?? {});
        }
      });
    });
    this.#process.stderr.on("data", (chunk) => {
      this.#consumeBuffer(this.#stderrBuffer, chunk.toString(), (line) => {
        this.#stderrLines.push(line);
      });
    });
    this.#process.on("error", (error) => {
      this.#closeWithError(
        toProviderError("process_error", error.message, true),
      );
    });
    this.#process.on("exit", (code, signal) => {
      this.#closeWithError(
        toProviderError(
          "process_exit",
          `Codex app-server exited with code ${code ?? "null"} and signal ${signal ?? "null"}. ${this.stderrTail()}`,
          true,
        ),
      );
    });
  }

  stderrTail(): string {
    return this.#stderrLines.slice(-10).join("\n");
  }

  async dispose(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#process.kill();
    this.#pending.clear();
    this.#notifications.removeAllListeners();
  }

  onNotification(
    method: string,
    listener: (params: Record<string, unknown>) => void,
  ): () => void {
    this.#notifications.on(method, listener);
    return () => {
      this.#notifications.off(method, listener);
    };
  }

  request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.#closed) {
      return Promise.reject(
        toProviderError("transport_closed", "Transport already closed."),
      );
    }

    const id = this.#nextRequestId++;
    const payload: JsonRpcRequest = params
      ? { id, method, params }
      : { id, method };

    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });

      this.#process.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) {
          return;
        }

        this.#pending.delete(id);
        reject(toProviderError("stdin_write_failed", error.message, true));
      });
    });
  }

  notify(method: string, params?: Record<string, unknown>): Promise<void> {
    if (this.#closed) {
      return Promise.reject(
        toProviderError("transport_closed", "Transport already closed."),
      );
    }

    return new Promise<void>((resolve, reject) => {
      this.#process.stdin.write(
        `${JSON.stringify({ method, params })}\n`,
        (error) => {
          if (error) {
            reject(toProviderError("stdin_write_failed", error.message, true));
            return;
          }

          resolve();
        },
      );
    });
  }

  #consumeBuffer(
    buffer: { value: string },
    chunk: string,
    onLine: (line: string) => void,
  ): void {
    buffer.value += chunk;
    let newlineIndex = buffer.value.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.value.slice(0, newlineIndex).trim();
      buffer.value = buffer.value.slice(newlineIndex + 1);
      if (line.length > 0) {
        onLine(line);
      }
      newlineIndex = buffer.value.indexOf("\n");
    }
  }

  #closeWithError(error: ProviderFailureError): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
    this.#notifications.emit("transport/closed", {
      code: error.code,
      detail: error.detail,
    });
  }
}

export class CodexAppServerClient {
  readonly #transport: CodexAppServerTransport;

  constructor(transport: CodexAppServerTransport) {
    this.#transport = transport;
  }

  initialize(
    clientInfo: CodexAppServerClientInfo,
    capabilities?: Record<string, unknown>,
  ): Effect.Effect<CodexInitializeResult, ProviderFailureError> {
    return Effect.tryPromise({
      try: async () => {
        const result = await this.#transport.request<CodexInitializeResult>(
          "initialize",
          {
            clientInfo,
            capabilities,
          },
        );
        await this.#transport.notify("initialized");
        return result;
      },
      catch: (error) =>
        error instanceof ProviderFailureError
          ? error
          : toProviderError(
              "initialize_failed",
              error instanceof Error ? error.message : String(error),
              true,
            ),
    });
  }

  readAccount(
    refreshToken = false,
  ): Effect.Effect<CodexAccountReadResult, ProviderFailureError> {
    return Effect.tryPromise({
      try: async () => {
        const result = await this.#transport.request<{
          readonly account?:
            | { readonly type: "apiKey" }
            | {
                readonly type: "chatgpt";
                readonly email?: string | null;
                readonly planType?: string | null;
              }
            | null;
          readonly requiresOpenaiAuth?: boolean;
        }>("account/read", { refreshToken });

        const account =
          result.account?.type === "chatgpt"
            ? {
                type: "chatgpt" as const,
                email: result.account.email ?? null,
                planType: result.account.planType ?? null,
              }
            : result.account?.type === "apiKey"
              ? { type: "apiKey" as const }
              : null;

        return {
          account,
          requiresOpenaiAuth: Boolean(result.requiresOpenaiAuth),
        };
      },
      catch: (error) =>
        error instanceof ProviderFailureError
          ? error
          : toProviderError(
              "account_read_failed",
              error instanceof Error ? error.message : String(error),
              true,
            ),
    });
  }

  startChatGptLogin(): Effect.Effect<
    ProviderAuthLoginStartResult,
    ProviderFailureError
  > {
    return Effect.tryPromise({
      try: async () => {
        const result = await this.#transport.request<{
          readonly type?: string;
          readonly loginId?: string;
          readonly authUrl?: string;
        }>("account/login/start", { type: "chatgpt" });
        if (!result.loginId || !result.authUrl) {
          throw toProviderError(
            "account_login_start_failed",
            "Codex app-server did not return a loginId/authUrl for ChatGPT login.",
          );
        }

        return {
          providerKey: "codex",
          loginId: result.loginId,
          authUrl: result.authUrl,
        };
      },
      catch: (error) =>
        error instanceof ProviderFailureError
          ? error
          : toProviderError(
              "account_login_start_failed",
              error instanceof Error ? error.message : String(error),
              true,
            ),
    });
  }

  waitForLoginCompletion(
    loginId: string,
  ): Effect.Effect<CodexLoginCompletedResult, ProviderFailureError> {
    return Effect.async<CodexLoginCompletedResult, ProviderFailureError>(
      (resume) => {
        const unsubscribe = this.#transport.onNotification(
          "account/login/completed",
          (params) => {
            const completedLoginId =
              typeof params.loginId === "string" ? params.loginId : null;
            if (completedLoginId !== loginId) {
              return;
            }

            unsubscribe();
            resume(
              Effect.succeed({
                loginId: completedLoginId,
                success: Boolean(params.success),
                error: typeof params.error === "string" ? params.error : null,
              }),
            );
          },
        );

        return Effect.sync(unsubscribe);
      },
    );
  }

  cancelLogin(loginId: string): Effect.Effect<void, ProviderFailureError> {
    return Effect.tryPromise({
      try: async () => {
        await this.#transport.request("account/login/cancel", { loginId });
      },
      catch: (error) =>
        error instanceof ProviderFailureError
          ? error
          : toProviderError(
              "account_login_cancel_failed",
              error instanceof Error ? error.message : String(error),
              true,
            ),
    });
  }

  logout(): Effect.Effect<void, ProviderFailureError> {
    return Effect.tryPromise({
      try: async () => {
        await this.#transport.request("account/logout");
      },
      catch: (error) =>
        error instanceof ProviderFailureError
          ? error
          : toProviderError(
              "account_logout_failed",
              error instanceof Error ? error.message : String(error),
              true,
            ),
    });
  }

  startThread(
    params: Record<string, unknown>,
  ): Effect.Effect<string, ProviderFailureError> {
    return Effect.tryPromise({
      try: async () => {
        const result = await this.#transport.request<{
          readonly thread?: { readonly id?: string };
        }>("thread/start", params);
        const threadId = result.thread?.id;
        if (!threadId) {
          throw toProviderError(
            "thread_start_failed",
            "Codex app-server did not return a thread id.",
          );
        }

        return threadId;
      },
      catch: (error) =>
        error instanceof ProviderFailureError
          ? error
          : toProviderError(
              "thread_start_failed",
              error instanceof Error ? error.message : String(error),
              true,
            ),
    });
  }

  resumeThread(
    threadId: string,
    params?: Record<string, unknown>,
  ): Effect.Effect<string, ProviderFailureError> {
    return Effect.tryPromise({
      try: async () => {
        const result = await this.#transport.request<{
          readonly thread?: { readonly id?: string };
        }>("thread/resume", {
          threadId,
          ...params,
        });
        return result.thread?.id ?? threadId;
      },
      catch: (error) =>
        error instanceof ProviderFailureError
          ? error
          : toProviderError(
              "thread_resume_failed",
              error instanceof Error ? error.message : String(error),
              true,
            ),
    });
  }

  startTurn(
    threadId: string,
    input: readonly Record<string, unknown>[],
  ): Effect.Effect<{ readonly turnId: string }, ProviderFailureError> {
    return Effect.tryPromise({
      try: async () => {
        const result = await this.#transport.request<{
          readonly turn?: { readonly id?: string };
        }>("turn/start", {
          threadId,
          input,
        });
        const turnId = result.turn?.id;
        if (!turnId) {
          throw toProviderError(
            "turn_start_failed",
            "Codex app-server did not return a turn id.",
          );
        }

        return { turnId };
      },
      catch: (error) =>
        error instanceof ProviderFailureError
          ? error
          : toProviderError(
              "turn_start_failed",
              error instanceof Error ? error.message : String(error),
              true,
            ),
    });
  }

  interruptTurn(
    threadId: string,
    turnId: string,
  ): Effect.Effect<void, ProviderFailureError> {
    return Effect.tryPromise({
      try: async () => {
        await this.#transport.request("turn/interrupt", {
          threadId,
          turnId,
        });
      },
      catch: (error) =>
        error instanceof ProviderFailureError
          ? error
          : toProviderError(
              "turn_interrupt_failed",
              error instanceof Error ? error.message : String(error),
              true,
            ),
    });
  }

  streamTurn(
    turnId: string,
    messageId: string,
  ): Stream.Stream<CodexProviderStreamEvent, ProviderFailureError> {
    return Stream.async<CodexProviderStreamEvent, ProviderFailureError>(
      (emit) => {
        const unsubscribers = [
          this.#transport.onNotification(
            "item/agentMessage/delta",
            (params) => {
              const notificationTurnId = String(
                params.turnId ?? params.turn_id ?? params.id ?? "",
              );
              if (notificationTurnId !== turnId) {
                return;
              }

              const delta =
                params.delta ?? params.text ?? params.textDelta ?? "";
              if (typeof delta !== "string" || delta.length === 0) {
                return;
              }

              emit.single({
                type: "output.delta",
                turnId,
                messageId,
                delta,
              });
            },
          ),
          this.#transport.onNotification("turn/completed", (params) => {
            const completedTurnId = String(
              params.turnId ?? params.turn_id ?? params.id ?? "",
            );
            if (completedTurnId !== turnId) {
              return;
            }

            const status = String(params.status ?? "completed");
            if (status === "completed") {
              emit.single({
                type: "output.completed",
                turnId,
                messageId,
              });
              emit.end();
              return;
            }

            if (status === "interrupted") {
              emit.end();
              return;
            }

            emit.single({
              type: "turn.failed",
              turnId,
              error:
                typeof params.error === "string"
                  ? params.error
                  : `Turn completed with status '${status}'.`,
            });
            emit.end();
          }),
          this.#transport.onNotification("transport/closed", (params) => {
            emit.single({
              type: "session.disconnected",
              reason: String(
                params.detail ?? "Codex app-server connection closed.",
              ),
            });
            emit.end();
          }),
        ];

        return Effect.sync(() => {
          for (const unsubscribe of unsubscribers) {
            unsubscribe();
          }
        });
      },
    ).pipe(Stream.catchAll((error) => Stream.fail(error)));
  }

  dispose(): Effect.Effect<void> {
    return Effect.promise(() => this.#transport.dispose());
  }
}

export interface CodexClientFactoryOptions {
  readonly clientInfo?: CodexAppServerClientInfo;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly spawn?: CodexSpawn;
}

export const createCodexAppServerClient = (
  options: CodexClientFactoryOptions & { readonly cwd?: string },
): Effect.Effect<CodexAppServerClient, ProviderFailureError> => {
  const spawnProcess = options.spawn ?? defaultSpawn;
  return Effect.try({
    try: () => {
      const process = spawnProcess({
        command: options.command ?? globalThis.process.env.CODEX_BIN ?? "codex",
        args: options.args ?? ["app-server"],
        ...(options.cwd ? { cwd: options.cwd } : {}),
        env: {
          ...globalThis.process.env,
          ...options.env,
        },
      });
      return new CodexAppServerClient(new CodexAppServerTransport(process));
    },
    catch: (error) =>
      toProviderError(
        "spawn_failed",
        error instanceof Error ? error.message : String(error),
        true,
      ),
  }).pipe(
    Effect.flatMap((client) =>
      client
        .initialize(
          options.clientInfo ?? {
            name: "magick",
            title: "Magick",
            version: "0.1.0",
          },
        )
        .pipe(Effect.as(client)),
    ),
  );
};
