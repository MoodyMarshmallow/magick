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
    expect(request.instructions).toContain("You are Codex, based on GPT-5");
    expect(request.instructions).toContain("always use dollar-delimited LaTeX");
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
