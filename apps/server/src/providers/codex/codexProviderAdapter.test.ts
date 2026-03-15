// Verifies the Codex provider adapter reports capabilities and builds runtime sessions.

import { Effect, Stream } from "effect";

import type { CodexAuthClient } from "./codexAuthClient";
import {
  CodexProviderAdapter,
  createCodexRuntimeFactory,
} from "./codexProviderAdapter";

describe("CodexProviderAdapter", () => {
  it("delegates session creation and reports rebuild-based capabilities", async () => {
    const createSession = vi.fn().mockResolvedValue({ sessionId: "session_1" });
    const resumeSession = vi.fn().mockResolvedValue({ sessionId: "session_1" });
    const adapter = new CodexProviderAdapter({
      createSession: (input) =>
        Effect.promise(() => createSession(input) as never),
      resumeSession: (input) =>
        Effect.promise(() => resumeSession(input) as never),
    });

    expect(adapter.getResumeStrategy()).toBe("rebuild");
    expect(adapter.listCapabilities().supportsNativeResume).toBe(false);

    await Effect.runPromise(
      adapter.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );
    expect(createSession).toHaveBeenCalled();
  });

  it("creates stateless direct-http sessions through the runtime factory", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue(
        Effect.succeed({
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
      ),
      upsert: vi.fn().mockReturnValue(Effect.void),
      delete: vi.fn().mockReturnValue(Effect.void),
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n' +
          'data: {"type":"response.completed"}\n\n',
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      ),
    );

    const factory = createCodexRuntimeFactory({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi.fn().mockReturnValue(
          Effect.succeed({
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: Date.now() + 120_000,
            accountId: "acct_1",
            email: "user@example.com",
          }),
        ),
      } as unknown as CodexAuthClient,
      fetch: fetchMock as unknown as typeof fetch,
      defaultModel: "gpt-5.3-codex",
    });

    const session = await Effect.runPromise(
      factory.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );

    expect(session.providerSessionRef).toBeNull();
    expect(session.providerThreadRef).toBeNull();
  });

  it("maps direct-http response streams into provider session events", async () => {
    const authRepository = {
      get: vi.fn().mockReturnValue(
        Effect.succeed({
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
      ),
      upsert: vi.fn().mockReturnValue(Effect.void),
      delete: vi.fn().mockReturnValue(Effect.void),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
            'data: {"type":"response.completed"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const factory = createCodexRuntimeFactory({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi.fn().mockReturnValue(
          Effect.succeed({
            accessToken: "access",
            refreshToken: "refresh",
            expiresAt: Date.now() + 120_000,
            accountId: "acct_1",
            email: "user@example.com",
          }),
        ),
      } as unknown as CodexAuthClient,
      fetch: fetchMock as unknown as typeof fetch,
      defaultModel: "gpt-5.3-codex",
    });

    const session = await Effect.runPromise(
      factory.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );

    const stream = await Effect.runPromise(
      session.startTurn({
        threadId: "thread_1",
        turnId: "turn_1",
        messageId: "message_1",
        userMessage: "Hello",
        contextMessages: [],
      }),
    );
    const events = await Effect.runPromise(Stream.runCollect(stream));

    expect(Array.from(events)).toEqual([
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "message_1",
        delta: "Hi",
      },
      {
        type: "output.completed",
        turnId: "turn_1",
        messageId: "message_1",
      },
    ]);

    await Effect.runPromise(
      session.interruptTurn({ turnId: "turn_1", reason: "stop" }),
    );
    await Effect.runPromise(session.dispose());
  });
});
