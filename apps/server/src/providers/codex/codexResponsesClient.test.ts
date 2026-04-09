// Verifies direct Codex response streaming and auth refresh behavior.

import { Cause, Effect, Exit, Option, Stream } from "effect";

import type { CodexAuthClient } from "./codexAuthClient";
import { CodexResponsesClient } from "./codexResponsesClient";

describe("CodexResponsesClient", () => {
  it("refreshes auth when needed and streams response deltas", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "expired",
        refreshToken: "refresh_1",
        expiresAt: Date.now() - 1,
        accountId: "acct_1",
        email: "user@example.com",
        planType: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'event: response.created\ndata: {"type":"response.created"}\n\n' +
            'event: response.output_item.added\ndata: {"type":"response.output_item.added"}\n\n' +
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\n' +
            'event: response.text.done\ndata: {"type":"response.text.done"}\n\n' +
            "data: [DONE]\n\n",
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const authClient = {
      refreshAccessToken: vi.fn().mockResolvedValue({
        accessToken: "fresh_access",
        refreshToken: "fresh_refresh",
        expiresAt: Date.now() + 60_000,
        accountId: "acct_1",
        email: "user@example.com",
      }),
    } as unknown as CodexAuthClient;

    const client = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient,
      fetch: fetchMock as never,
    });

    const events = await Effect.runPromise(
      Stream.runCollect(
        client.streamResponse({
          messages: [{ role: "user", content: "Hello" }],
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      { type: "output.delta", delta: "Hello" },
      { type: "output.completed" },
    ]);
    expect(authRepository.upsert).toHaveBeenCalled();
    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"),
    );
    expect(typeof request.instructions).toBe("string");
    expect(request.store).toBe(false);
    expect(request.input[0].content[0].type).toBe("input_text");
  });

  it("serializes assistant history as output_text when rebuilding context", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 120_000,
        accountId: "acct_1",
        email: "user@example.com",
        planType: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const client = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: { refreshAccessToken: vi.fn() } as unknown as CodexAuthClient,
      fetch: fetchMock as never,
    });

    await Effect.runPromise(
      Stream.runCollect(
        client.streamResponse({
          messages: [
            { role: "user", content: "First question" },
            { role: "assistant", content: "First answer" },
            { role: "user", content: "Second question" },
          ],
        }),
      ),
    );

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"),
    );
    expect(request.input[0].content[0].type).toBe("input_text");
    expect(request.input[1].content[0].type).toBe("output_text");
    expect(request.input[2].content[0].type).toBe("input_text");
  });

  it("generates a normalized thread title", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 120_000,
        accountId: "acct_1",
        email: "user@example.com",
        planType: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"type":"response.output_text.delta","delta":"\\"Release planning\\""}\n\n' +
            'data: {"type":"response.completed"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const client = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: { refreshAccessToken: vi.fn() } as unknown as CodexAuthClient,
      fetch: fetchMock as never,
    });

    await expect(
      Effect.runPromise(client.generateThreadTitle("Plan the release")),
    ).resolves.toBe("Release planning");

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"),
    );
    expect(typeof request.instructions).toBe("string");
  });

  it("fails when auth is missing", async () => {
    const client = new CodexResponsesClient({
      authRepository: {
        get: vi.fn().mockReturnValue(null),
        upsert: vi.fn(),
        delete: vi.fn(),
      } as never,
      authClient: {} as CodexAuthClient,
      fetch: vi.fn() as never,
    });

    const exit = await Effect.runPromiseExit(
      Stream.runCollect(
        client.streamResponse({
          messages: [{ role: "user", content: "Hello" }],
        }),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        code: "auth_required",
      });
    }
  });

  it("maps failed response events into turn failures", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 120_000,
        accountId: null,
        email: "user@example.com",
        planType: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response('data: {"type":"response.failed","message":"Boom"}\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const client = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi.fn(),
      } as unknown as CodexAuthClient,
      fetch: fetchMock as never,
    });

    const events = await Effect.runPromise(
      Stream.runCollect(
        client.streamResponse({
          messages: [{ role: "user", content: "Hello" }],
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      { type: "turn.failed", error: "Boom" },
    ]);
  });

  it("parses multiline sse frames and nested error payloads", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 120_000,
        accountId: null,
        email: "user@example.com",
        planType: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'event: response.content_part.delta\ndata: {"type":"response.content_part.delta","text":"Hi"}\n\n' +
            'event: error\ndata: {"type":"error","error":{"message":"nested boom"}}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const client = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: { refreshAccessToken: vi.fn() } as unknown as CodexAuthClient,
      fetch: fetchMock as never,
    });

    const events = await Effect.runPromise(
      Stream.runCollect(
        client.streamResponse({
          messages: [{ role: "user", content: "Hello" }],
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      { type: "output.delta", delta: "Hi" },
      { type: "turn.failed", error: "nested boom" },
    ]);
  });

  it("falls back to nested content part text when part is missing", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 120_000,
        accountId: null,
        email: "user@example.com",
        planType: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'event: response.content_part.delta\ndata: {"type":"response.content_part.delta","content_part":{"text":"Nested delta"}}\n\n' +
            "data: [DONE]\n\n",
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const client = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: { refreshAccessToken: vi.fn() } as unknown as CodexAuthClient,
      fetch: fetchMock as never,
    });

    const events = await Effect.runPromise(
      Stream.runCollect(
        client.streamResponse({
          messages: [{ role: "user", content: "Hello" }],
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      { type: "output.delta", delta: "Nested delta" },
      { type: "output.completed" },
    ]);
  });

  it("parses function-call output items into tool request events", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 120_000,
        accountId: null,
        email: "user@example.com",
        planType: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_1","name":"read","arguments":"{\\"path\\":\\"notes.md\\"}"}}\n\n' +
            'data: {"type":"response.completed"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const client = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: { refreshAccessToken: vi.fn() } as unknown as CodexAuthClient,
      fetch: fetchMock as never,
    });

    const events = await Effect.runPromise(
      Stream.runCollect(
        client.streamResponse({
          messages: [{ role: "user", content: "Hello" }],
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "tool.call.requested",
        toolCallId: "call_1",
        toolName: "read",
        input: { path: "notes.md" },
      },
      { type: "output.completed" },
    ]);
  });

  it("serializes tools and function_call_output continuation payloads", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 120_000,
        accountId: null,
        email: "user@example.com",
        planType: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const client = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: { refreshAccessToken: vi.fn() } as unknown as CodexAuthClient,
      fetch: fetchMock as never,
    });

    await Effect.runPromise(
      Stream.runCollect(
        client.streamResponse({
          messages: [
            {
              type: "function_call_output",
              callId: "call_1",
              output: "done",
            },
          ],
          tools: [
            {
              name: "read",
              description: "Read a file",
              inputSchema: { type: "object" },
            },
          ],
        }),
      ),
    );

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"),
    );
    expect(request.tools).toEqual([
      {
        type: "function",
        name: "read",
        description: "Read a file",
        parameters: { type: "object" },
      },
    ]);
    expect(request.input).toEqual([
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "done",
      },
    ]);
  });

  it("serializes prior tool calls and tool results in the rebuilt input chain", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 120_000,
        accountId: null,
        email: "user@example.com",
        planType: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const client = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: { refreshAccessToken: vi.fn() } as unknown as CodexAuthClient,
      fetch: fetchMock as never,
    });

    await Effect.runPromise(
      Stream.runCollect(
        client.streamResponse({
          messages: [
            { role: "user", content: "First" },
            {
              type: "function_call",
              callId: "call_1",
              name: "read",
              input: { path: "notes.md" },
            },
            {
              type: "function_call_output",
              callId: "call_1",
              output: "hello\nworld\n",
            },
            { role: "assistant", content: "Tool saw the note" },
            { role: "user", content: "Second" },
          ],
        }),
      ),
    );

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"),
    );
    expect(request.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: "First" }],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "read",
        arguments: '{"path":"notes.md"}',
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "hello\nworld\n",
      },
      {
        role: "assistant",
        content: [{ type: "output_text", text: "Tool saw the note" }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: "Second" }],
      },
    ]);
  });

  it("deletes auth when refresh fails", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue({
        providerKey: "codex",
        authMode: "chatgpt",
        accessToken: "expired",
        refreshToken: "refresh",
        expiresAt: Date.now() - 1,
        accountId: null,
        email: "user@example.com",
        planType: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    const client = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi
          .fn()
          .mockRejectedValue(new Error("refresh failed")),
      } as unknown as CodexAuthClient,
      fetch: vi.fn() as never,
    });

    const exit = await Effect.runPromiseExit(client.ensureAuthenticated());
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        code: "auth_required",
      });
    }
    expect(authRepository.delete).toHaveBeenCalledWith("codex");
  });

  it("maps HTTP failures and aborts into provider errors", async () => {
    const authRecord = {
      providerKey: "codex",
      authMode: "chatgpt",
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 120_000,
      accountId: null,
      email: "user@example.com",
      planType: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const authRepository = {
      get: vi.fn().mockReturnValue(authRecord),
      upsert: vi.fn(),
      delete: vi.fn(),
    };

    const failingClient = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: { refreshAccessToken: vi.fn() } as unknown as CodexAuthClient,
      fetch: vi
        .fn()
        .mockResolvedValue(new Response("nope", { status: 500 })) as never,
    });

    const failingExit = await Effect.runPromiseExit(
      Stream.runCollect(
        failingClient.streamResponse({
          messages: [{ role: "user", content: "Hello" }],
        }),
      ),
    );
    expect(Exit.isFailure(failingExit)).toBe(true);

    const abortingClient = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: { refreshAccessToken: vi.fn() } as unknown as CodexAuthClient,
      fetch: vi
        .fn()
        .mockRejectedValue(new DOMException("Aborted", "AbortError")) as never,
    });

    const abortExit = await Effect.runPromiseExit(
      Stream.runCollect(
        abortingClient.streamResponse({
          messages: [{ role: "user", content: "Hello" }],
        }),
      ),
    );
    expect(Exit.isFailure(abortExit)).toBe(true);
  });
});
