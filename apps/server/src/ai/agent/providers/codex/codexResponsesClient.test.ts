// Verifies direct Codex response streaming and auth refresh behavior.

import { Cause, Effect, Exit, Option, Stream } from "effect";

import type { CodexAuthClient } from "../../../auth/codex/codexAuthClient";
import {
  CodexResponsesClient,
  setCodexTransportDebugEnabled,
} from "./codexResponsesClient";

const assistantInstructions = "Assistant instructions";
const titleInstructions = "Title instructions";

describe("CodexResponsesClient", () => {
  afterEach(() => {
    setCodexTransportDebugEnabled(false);
  });

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
            'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer"}}\n\n' +
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\n' +
            'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Hello"}]}}\n\n' +
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "output.delta",
        itemKey: "msg_1",
        channel: "final",
        delta: "Hello",
      },
      {
        type: "output.message.completed",
        itemKey: "msg_1",
        channel: "final",
        reason: "stop",
      },
      { type: "turn.completed" },
    ]);
    expect(authRepository.upsert).toHaveBeenCalled();
    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"),
    );
    expect(typeof request.instructions).toBe("string");
    expect(request.store).toBe(false);
    expect(request.input[0].content[0].type).toBe("input_text");
  });

  it("emits truncated structured debug logs when transport debugging is enabled", async () => {
    setCodexTransportDebugEnabled(true);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    try {
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

      const longPrompt = "A".repeat(180);
      const longDelta = "B".repeat(180);
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          new Response(
            `event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer"}}\n\nevent: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: longDelta })}\n\nevent: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", item: { type: "message", id: "msg_1", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: longDelta }] } })}\n\nevent: response.completed\ndata: {"type":"response.completed"}\n\n`,
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
        );

      const client = new CodexResponsesClient({
        authRepository: authRepository as never,
        authClient: {
          refreshAccessToken: vi.fn(),
        } as unknown as CodexAuthClient,
        fetch: fetchMock as never,
      });

      await Effect.runPromise(
        Stream.runCollect(
          client.streamResponse({
            messages: [{ role: "user", content: longPrompt }],
            instructions: assistantInstructions,
          }),
        ),
      );

      const requestLog = String(debugSpy.mock.calls[0]?.[0] ?? "");
      const responseLog = String(debugSpy.mock.calls[1]?.[0] ?? "");

      expect(requestLog).toContain("[codex-stream] request");
      expect(requestLog).toContain("kind: 'user_message'");
      expect(requestLog).toContain("contentLength: 180");
      expect(requestLog).toContain(
        `contentTailPreview: '...${"A".repeat(120)}'`,
      );
      expect(requestLog).toContain("instruction:");
      expect(requestLog).toContain("tailPreview:");

      expect(responseLog).toContain("[codex-stream] response.message");
      expect(responseLog).toContain("kind: 'assistant_message'");
      expect(responseLog).toContain("channel: 'final'");
      expect(responseLog).toContain("contentLength: 180");
      expect(responseLog).toContain(
        `contentTailPreview: '...${"B".repeat(120)}'`,
      );
      expect(debugSpy).toHaveBeenCalledTimes(2);
    } finally {
      debugSpy.mockRestore();
    }
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
            { role: "assistant", channel: "final", content: "First answer" },
            { role: "user", content: "Second question" },
          ],
          instructions: assistantInstructions,
        }),
      ),
    );

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"),
    );
    expect(request.input[0].content[0].type).toBe("input_text");
    expect(request.input[1].content[0].type).toBe("output_text");
    expect(request.input[1].phase).toBe("final_answer");
    expect(request.input[1].content[0].text).toBe("First answer");
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
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"title_1","role":"assistant","phase":"final_answer"}}\n\n' +
            'data: {"type":"response.output_text.delta","delta":"\\"Release planning\\""}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"message","id":"title_1","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"\\"Release planning\\""}]}}\n\n' +
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
      Effect.runPromise(
        client.generateThreadTitle({
          firstMessage: "Plan the release",
          instructions: titleInstructions,
        }),
      ),
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
          instructions: assistantInstructions,
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      { type: "turn.failed", error: "Boom" },
    ]);
  });

  it("does not emit buffered tool requests when the response fails", async () => {
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
      new Response(
        'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_1","name":"read","arguments":"{\\"path\\":\\"notes.md\\"}"}}\n\n' +
          'data: {"type":"response.failed","message":"Boom"}\n\n',
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      { type: "turn.failed", error: "Boom" },
    ]);
  });

  it("fails truncated streams after preserving incomplete assistant output", async () => {
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
      new Response(
        'data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer"}}\n\n' +
          'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n' +
          'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Hello"}]}}\n\n',
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "output.delta",
        itemKey: "msg_1",
        channel: "final",
        delta: "Hello",
      },
      {
        type: "output.message.completed",
        itemKey: "msg_1",
        channel: "final",
        reason: "incomplete",
      },
      {
        type: "turn.failed",
        error: "Codex stream ended before response.completed.",
      },
    ]);
  });

  it("ignores later completion frames after an upstream failure", async () => {
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
          'data: {"type":"response.failed","message":"Boom"}\n\n' +
            'data: {"type":"response.completed"}\n\n' +
            "data: [DONE]\n\n",
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
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
          instructions: assistantInstructions,
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
          'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer"}}\n\n' +
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      { type: "output.delta", itemKey: "msg_1", channel: "final", delta: "Hi" },
      {
        type: "output.message.completed",
        itemKey: "msg_1",
        channel: "final",
        reason: "incomplete",
      },
      { type: "turn.failed", error: "nested boom" },
    ]);
  });

  it("emits completion only once when both response.completed and [DONE] arrive", async () => {
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
          'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer"}}\n\n' +
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Done"}\n\n' +
            'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Done"}]}}\n\n' +
            'event: response.completed\ndata: {"type":"response.completed"}\n\n' +
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "output.delta",
        itemKey: "msg_1",
        channel: "final",
        delta: "Done",
      },
      {
        type: "output.message.completed",
        itemKey: "msg_1",
        channel: "final",
        reason: "stop",
      },
      { type: "turn.completed" },
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
          'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer"}}\n\n' +
            'event: response.content_part.delta\ndata: {"type":"response.content_part.delta","content_part":{"text":"Nested delta"}}\n\n' +
            'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Nested delta"}]}}\n\n' +
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "output.delta",
        itemKey: "msg_1",
        channel: "final",
        delta: "Nested delta",
      },
      {
        type: "output.message.completed",
        itemKey: "msg_1",
        channel: "final",
        reason: "stop",
      },
      { type: "turn.completed" },
    ]);
  });

  it("routes interleaved assistant deltas by upstream item identity", async () => {
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
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"commentary_1","role":"assistant","phase":"commentary"}}\n\n' +
            'data: {"type":"response.output_item.added","item":{"type":"message","id":"final_1","role":"assistant","phase":"final_answer"}}\n\n' +
            'data: {"type":"response.output_text.delta","item_id":"commentary_1","delta":"Inspecting notes. "}\n\n' +
            'data: {"type":"response.output_text.delta","item_id":"final_1","delta":"Summary ready."}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"message","id":"commentary_1","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"Inspecting notes. "}]}}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"message","id":"final_1","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Summary ready."}]}}\n\n' +
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "output.delta",
        itemKey: "commentary_1",
        channel: "commentary",
        delta: "Inspecting notes. ",
      },
      {
        type: "output.delta",
        itemKey: "final_1",
        channel: "final",
        delta: "Summary ready.",
      },
      {
        type: "output.message.completed",
        itemKey: "commentary_1",
        channel: "commentary",
        reason: "stop",
      },
      {
        type: "output.message.completed",
        itemKey: "final_1",
        channel: "final",
        reason: "stop",
      },
      { type: "turn.completed" },
    ]);
  });

  it("fails the turn if a second final_answer item appears", async () => {
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
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"final_1","role":"assistant","phase":"final_answer"}}\n\n' +
            'data: {"type":"response.output_item.added","item":{"type":"message","id":"final_2","role":"assistant","phase":"final_answer"}}\n\n',
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "turn.failed",
        error:
          "Invalid Codex Responses stream: received more than one final_answer item in a single turn",
      },
    ]);
  });

  it("fails the turn when a delta omits item_id while multiple assistant items are active", async () => {
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
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"commentary_1","role":"assistant","phase":"commentary"}}\n\n' +
            'data: {"type":"response.output_item.added","item":{"type":"message","id":"final_1","role":"assistant","phase":"final_answer"}}\n\n' +
            'data: {"type":"response.output_text.delta","delta":"Ambiguous delta"}\n\n',
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "turn.failed",
        error:
          "Invalid Codex Responses stream: received assistant text delta without item_id while multiple assistant items were active",
      },
    ]);
  });

  it("ignores later completion frames after a contract failure", async () => {
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
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"commentary_1","role":"assistant","phase":"commentary"}}\n\n' +
            'data: {"type":"response.output_item.added","item":{"type":"message","id":"final_1","role":"assistant","phase":"final_answer"}}\n\n' +
            'data: {"type":"response.output_text.delta","delta":"Ambiguous delta"}\n\n' +
            'data: {"type":"response.completed"}\n\n' +
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "turn.failed",
        error:
          "Invalid Codex Responses stream: received assistant text delta without item_id while multiple assistant items were active",
      },
    ]);
  });

  it("completes active assistant items when the response ends without output_item.done", async () => {
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
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer"}}\n\n' +
            'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"Complete me"}\n\n' +
            'data: {"type":"response.completed"}\n\n' +
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "output.delta",
        itemKey: "msg_1",
        channel: "final",
        delta: "Complete me",
      },
      {
        type: "output.message.completed",
        itemKey: "msg_1",
        channel: "final",
        reason: "stop",
      },
      { type: "turn.completed" },
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
          instructions: assistantInstructions,
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
    ]);
  });

  it("emits assistant completion before tool requests in the same response step", async () => {
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
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","phase":"commentary"}}\n\n' +
            'data: {"type":"response.output_text.delta","delta":"Reviewing"}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"Reviewing"}]}}\n\n' +
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
          instructions: assistantInstructions,
        }),
      ),
    );

    expect(Array.from(events)).toEqual([
      {
        type: "output.delta",
        itemKey: "msg_1",
        channel: "commentary",
        delta: "Reviewing",
      },
      {
        type: "output.message.completed",
        itemKey: "msg_1",
        channel: "commentary",
        reason: "tool_calls",
      },
      {
        type: "tool.call.requested",
        toolCallId: "call_1",
        toolName: "read",
        input: { path: "notes.md" },
      },
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
          instructions: assistantInstructions,
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
            {
              role: "assistant",
              channel: "final",
              content: "Tool saw the note",
            },
            { role: "user", content: "Second" },
          ],
          instructions: assistantInstructions,
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
        phase: "final_answer",
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
          instructions: assistantInstructions,
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
          instructions: assistantInstructions,
        }),
      ),
    );
    expect(Exit.isFailure(abortExit)).toBe(true);
  });
});
