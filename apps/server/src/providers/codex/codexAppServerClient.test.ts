import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { Effect, Stream } from "effect";

import {
  type CodexAppServerSpawnOptions,
  type SpawnedProcess,
  createCodexAppServerClient,
} from "./codexAppServerClient";

class MockCodexProcess extends EventEmitter implements SpawnedProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly written: string[] = [];
  readonly #handlers = new Map<
    string,
    (message: {
      readonly id?: number;
      readonly params?: Record<string, unknown>;
    }) => void
  >();
  #buffer = "";

  constructor() {
    super();
    this.stdin.on("data", (chunk) => {
      this.#buffer += chunk.toString();
      let newlineIndex = this.#buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = this.#buffer.slice(0, newlineIndex).trim();
        this.#buffer = this.#buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          this.written.push(line);
          const message = JSON.parse(line) as {
            readonly id?: number;
            readonly method: string;
            readonly params?: Record<string, unknown>;
          };
          this.#handlers.get(message.method)?.(message);
        }
        newlineIndex = this.#buffer.indexOf("\n");
      }
    });
  }

  onRequest(
    method: string,
    handler: (message: {
      readonly id?: number;
      readonly params?: Record<string, unknown>;
    }) => void,
  ): void {
    this.#handlers.set(method, handler);
  }

  respond(id: number, result: unknown): void {
    this.stdout.write(`${JSON.stringify({ id, result })}\n`);
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify({ method, params })}\n`);
  }

  kill(): boolean {
    this.emit("exit", 0, null);
    return true;
  }
}

describe("createCodexAppServerClient", () => {
  it("initializes, sends requests, and streams turn events", async () => {
    const mock = new MockCodexProcess();
    mock.onRequest("initialize", ({ id }) => {
      mock.respond(id ?? 0, { protocolVersion: "1.0" });
    });
    mock.onRequest("thread/start", ({ id }) => {
      mock.respond(id ?? 0, { thread: { id: "thr_1" } });
    });
    mock.onRequest("account/read", ({ id }) => {
      mock.respond(id ?? 0, {
        account: {
          type: "chatgpt",
          email: "user@example.com",
          planType: "plus",
        },
        requiresOpenaiAuth: true,
      });
    });
    mock.onRequest("account/login/start", ({ id }) => {
      mock.respond(id ?? 0, {
        type: "chatgpt",
        loginId: "login_1",
        authUrl: "https://chatgpt.com/login",
      });
      setTimeout(() => {
        mock.notify("account/login/completed", {
          loginId: "login_1",
          success: true,
          error: null,
        });
      }, 0);
    });
    mock.onRequest("account/logout", ({ id }) => {
      mock.respond(id ?? 0, {});
    });
    mock.onRequest("turn/start", ({ id }) => {
      mock.respond(id ?? 0, { turn: { id: "turn_1" } });
      setTimeout(() => {
        mock.notify("item/agentMessage/delta", {
          turnId: "turn_1",
          delta: "Hello",
        });
        mock.notify("turn/completed", {
          turnId: "turn_1",
          status: "completed",
        });
      }, 0);
    });
    mock.onRequest("turn/interrupt", ({ id }) => {
      mock.respond(id ?? 0, {});
    });

    const client = await Effect.runPromise(
      createCodexAppServerClient({
        spawn: (_options: CodexAppServerSpawnOptions) => mock,
      }),
    );

    const threadId = await Effect.runPromise(
      client.startThread({ cwd: "/tmp/workspace" }),
    );
    expect(threadId).toBe("thr_1");

    await expect(Effect.runPromise(client.readAccount())).resolves.toEqual({
      account: {
        type: "chatgpt",
        email: "user@example.com",
        planType: "plus",
      },
      requiresOpenaiAuth: true,
    });

    const login = await Effect.runPromise(client.startChatGptLogin());
    expect(login).toEqual({
      providerKey: "codex",
      loginId: "login_1",
      authUrl: "https://chatgpt.com/login",
    });
    await expect(
      Effect.runPromise(client.waitForLoginCompletion(login.loginId)),
    ).resolves.toEqual({
      loginId: "login_1",
      success: true,
      error: null,
    });

    const startedTurn = await Effect.runPromise(
      client.startTurn("thr_1", [{ type: "text", text: "Hello" }]),
    );
    const events = await Effect.runPromise(
      Stream.runCollect(client.streamTurn(startedTurn.turnId, "message_1")),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "message_1",
        delta: "Hello",
      },
      {
        type: "output.completed",
        turnId: "turn_1",
        messageId: "message_1",
      },
    ]);

    await Effect.runPromise(client.interruptTurn("thr_1", "turn_1"));
    await Effect.runPromise(client.logout());
    expect(mock.written.some((line) => line.includes("turn/interrupt"))).toBe(
      true,
    );
    await Effect.runPromise(client.dispose());
  });
});
