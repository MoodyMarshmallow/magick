// Verifies direct Codex response streaming and auth refresh behavior.

import { Cause, Effect, Exit, Option, Stream } from "effect";

import type { CodexAuthClient } from "./codexAuthClient";
import { CodexResponsesClient } from "./codexResponsesClient";

describe("CodexResponsesClient", () => {
  it("refreshes auth when needed and streams response deltas", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue(
        Effect.succeed({
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
      ),
      upsert: vi.fn().mockReturnValue(Effect.void),
      delete: vi.fn().mockReturnValue(Effect.void),
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n' +
            "data: [DONE]\n\n",
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const authClient = {
      refreshAccessToken: vi.fn().mockReturnValue(
        Effect.succeed({
          accessToken: "fresh_access",
          refreshToken: "fresh_refresh",
          expiresAt: Date.now() + 60_000,
          accountId: "acct_1",
          email: "user@example.com",
        }),
      ),
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
  });

  it("fails when auth is missing", async () => {
    const client = new CodexResponsesClient({
      authRepository: {
        get: vi.fn().mockReturnValue(Effect.succeed(null)),
        upsert: vi.fn().mockReturnValue(Effect.void),
        delete: vi.fn().mockReturnValue(Effect.void),
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
      get: vi.fn().mockReturnValue(
        Effect.succeed({
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
      ),
      upsert: vi.fn().mockReturnValue(Effect.void),
      delete: vi.fn().mockReturnValue(Effect.void),
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

  it("deletes auth when refresh fails", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue(
        Effect.succeed({
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
      ),
      upsert: vi.fn().mockReturnValue(Effect.void),
      delete: vi.fn().mockReturnValue(Effect.void),
    };

    const client = new CodexResponsesClient({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi
          .fn()
          .mockReturnValue(Effect.fail(new Error("refresh failed"))),
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
      get: vi.fn().mockReturnValue(Effect.succeed(authRecord)),
      upsert: vi.fn().mockReturnValue(Effect.void),
      delete: vi.fn().mockReturnValue(Effect.void),
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
