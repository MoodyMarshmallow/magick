// Verifies the Codex provider adapter reports capabilities and builds runtime sessions.

import { Effect, Stream } from "effect";

import type { CodexAuthClient } from "../../../../auth/codex/codexAuthClient";
import {
  CodexProviderAdapter,
  createCodexRuntimeFactory,
} from "./codexProviderAdapter";

const assistantInstructions = "Assistant instructions";
const titleInstructions = "Title instructions";

describe("CodexProviderAdapter", () => {
  it("delegates session creation and reports rebuild-based capabilities", async () => {
    const createSession = vi.fn().mockResolvedValue({ sessionId: "session_1" });
    const generateBookmarkTitle = vi.fn().mockResolvedValue("Generated title");
    const resumeSession = vi.fn().mockResolvedValue({ sessionId: "session_1" });
    const adapter = new CodexProviderAdapter({
      createSession: (input) =>
        Effect.promise(() => createSession(input) as never),
      generateBookmarkTitle: (input) =>
        Effect.promise(() => generateBookmarkTitle(input) as never),
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
    await expect(
      Effect.runPromise(
        adapter.generateBookmarkTitle({
          firstMessage: "Hello",
          instructions: titleInstructions,
        }),
      ),
    ).resolves.toBe("Generated title");
    expect(createSession).toHaveBeenCalled();
    expect(generateBookmarkTitle).toHaveBeenCalledWith({
      firstMessage: "Hello",
      instructions: titleInstructions,
    });
  });

  it("creates stateless direct-http sessions through the runtime factory", async () => {
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
      new Response(
        'data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer"}}\n\n' +
          'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n' +
          'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Hello"}]}}\n\n' +
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
        refreshAccessToken: vi.fn().mockResolvedValue({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 120_000,
          accountId: "acct_1",
          email: "user@example.com",
        }),
      } as unknown as CodexAuthClient,
      fetch: fetchMock as unknown as typeof fetch,
      defaultModel: "gpt-5.4",
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
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer"}}\n\n' +
            'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Hi"}]}}\n\n' +
            'data: {"type":"response.completed"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const factory = createCodexRuntimeFactory({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi.fn().mockResolvedValue({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 120_000,
          accountId: "acct_1",
          email: "user@example.com",
        }),
      } as unknown as CodexAuthClient,
      fetch: fetchMock as unknown as typeof fetch,
      defaultModel: "gpt-5.4",
    });

    const session = await Effect.runPromise(
      factory.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );

    const stream = await Effect.runPromise(
      session.startTurn({
        bookmarkId: "bookmark_1",
        turnId: "turn_1",
        messageId: "message_1",
        userMessage: "Hello",
        instructions: assistantInstructions,
        contextMessages: [],
        historyItems: [],
        tools: [],
      }),
    );
    const events = await Effect.runPromise(Stream.runCollect(stream));

    expect(Array.from(events)).toEqual([
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:final",
        channel: "final",
        delta: "Hi",
      },
      {
        type: "output.message.completed",
        turnId: "turn_1",
        messageId: "turn_1:assistant:final",
        channel: "final",
        reason: "stop",
      },
      {
        type: "turn.completed",
        turnId: "turn_1",
      },
    ]);

    await Effect.runPromise(
      session.interruptTurn({ turnId: "turn_1", reason: "stop" }),
    );
    await Effect.runPromise(session.dispose());
  });

  it("resends tool definitions when submitting tool results", async () => {
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

    const factory = createCodexRuntimeFactory({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi.fn().mockResolvedValue({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 120_000,
          accountId: "acct_1",
          email: "user@example.com",
        }),
      } as unknown as CodexAuthClient,
      fetch: fetchMock as unknown as typeof fetch,
      defaultModel: "gpt-5.4",
    });

    const session = await Effect.runPromise(
      factory.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );

    await Effect.runPromise(
      Stream.runCollect(
        await Effect.runPromise(
          session.submitToolResults({
            turnId: "turn_1",
            toolResults: [
              {
                toolCallId: "call_1",
                toolName: "read",
                output: "done",
              },
            ],
            instructions: assistantInstructions,
            historyItems: [
              {
                type: "tool_call",
                toolCallId: "call_1",
                toolName: "read",
                input: { path: "notes.md" },
              },
              {
                type: "tool_result",
                toolCallId: "call_1",
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
  });

  it("supports multi-tool turns across tool-result continuations", async () => {
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
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_1","name":"read","arguments":"{\\"path\\":\\"notes.md\\"}"}}\n\n' +
            'data: {"type":"response.completed"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_2","name":"grep","arguments":"{\\"pattern\\":\\"hello\\"}"}}\n\n' +
            'data: {"type":"response.completed"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_3","role":"assistant","phase":"final_answer"}}\n\n' +
            'data: {"type":"response.output_text.delta","delta":"Done"}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_3","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Done"}]}}\n\n' +
            'data: {"type":"response.completed"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const factory = createCodexRuntimeFactory({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi.fn().mockResolvedValue({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 120_000,
          accountId: "acct_1",
          email: "user@example.com",
        }),
      } as unknown as CodexAuthClient,
      fetch: fetchMock as unknown as typeof fetch,
      defaultModel: "gpt-5.4",
    });

    const session = await Effect.runPromise(
      factory.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );

    const firstStream = await Effect.runPromise(
      session.startTurn({
        bookmarkId: "bookmark_1",
        turnId: "turn_1",
        messageId: "message_1",
        userMessage: "Investigate the note",
        instructions: assistantInstructions,
        contextMessages: [],
        historyItems: [],
        tools: [
          {
            name: "read",
            description: "Read a file",
            inputSchema: { type: "object" },
          },
          {
            name: "grep",
            description: "Search files",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );
    const firstEvents = Array.from(
      await Effect.runPromise(Stream.runCollect(firstStream)),
    );
    expect(firstEvents).toEqual([
      {
        type: "tool.call.requested",
        turnId: "turn_1",
        toolCallId: "call_1",
        toolName: "read",
        input: { path: "notes.md" },
      },
    ]);

    const secondStream = await Effect.runPromise(
      session.submitToolResults({
        turnId: "turn_1",
        toolResults: [
          {
            toolCallId: "call_1",
            toolName: "read",
            output: "hello world",
          },
        ],
        instructions: assistantInstructions,
        historyItems: [
          {
            type: "tool_call",
            toolCallId: "call_1",
            toolName: "read",
            input: { path: "notes.md" },
          },
          {
            type: "tool_result",
            toolCallId: "call_1",
            output: "hello world",
          },
        ],
        tools: [
          {
            name: "read",
            description: "Read a file",
            inputSchema: { type: "object" },
          },
          {
            name: "grep",
            description: "Search files",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );
    const secondEvents = Array.from(
      await Effect.runPromise(Stream.runCollect(secondStream)),
    );
    expect(secondEvents).toEqual([
      {
        type: "tool.call.requested",
        turnId: "turn_1",
        toolCallId: "call_2",
        toolName: "grep",
        input: { pattern: "hello" },
      },
    ]);

    const finalStream = await Effect.runPromise(
      session.submitToolResults({
        turnId: "turn_1",
        toolResults: [
          {
            toolCallId: "call_2",
            toolName: "grep",
            output: "notes.md:1:hello world",
          },
        ],
        instructions: assistantInstructions,
        historyItems: [
          {
            type: "tool_call",
            toolCallId: "call_1",
            toolName: "read",
            input: { path: "notes.md" },
          },
          {
            type: "tool_result",
            toolCallId: "call_1",
            output: "hello world",
          },
          {
            type: "tool_call",
            toolCallId: "call_2",
            toolName: "grep",
            input: { pattern: "hello" },
          },
          {
            type: "tool_result",
            toolCallId: "call_2",
            output: "notes.md:1:hello world",
          },
        ],
        tools: [
          {
            name: "read",
            description: "Read a file",
            inputSchema: { type: "object" },
          },
          {
            name: "grep",
            description: "Search files",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );
    const finalEvents = Array.from(
      await Effect.runPromise(Stream.runCollect(finalStream)),
    );
    expect(finalEvents).toEqual([
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:final",
        channel: "final",
        delta: "Done",
      },
      {
        type: "output.message.completed",
        turnId: "turn_1",
        messageId: "turn_1:assistant:final",
        channel: "final",
        reason: "stop",
      },
      {
        type: "turn.completed",
        turnId: "turn_1",
      },
    ]);

    const secondRequest = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body ?? "{}"),
    );
    expect(secondRequest.tools).toHaveLength(2);
    expect(secondRequest.input).toEqual([
      {
        type: "function_call",
        call_id: "call_1",
        name: "read",
        arguments: '{"path":"notes.md"}',
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "hello world",
      },
    ]);

    const thirdRequest = JSON.parse(
      String(fetchMock.mock.calls[2]?.[1]?.body ?? "{}"),
    );
    expect(thirdRequest.tools).toHaveLength(2);
    expect(thirdRequest.input).toEqual([
      {
        type: "function_call",
        call_id: "call_1",
        name: "read",
        arguments: '{"path":"notes.md"}',
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "hello world",
      },
      {
        type: "function_call",
        call_id: "call_2",
        name: "grep",
        arguments: '{"pattern":"hello"}',
      },
      {
        type: "function_call_output",
        call_id: "call_2",
        output: "notes.md:1:hello world",
      },
    ]);
  });

  it("skips incomplete assistant history messages when building Codex replay input", async () => {
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

    const factory = createCodexRuntimeFactory({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi.fn().mockResolvedValue({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 120_000,
          accountId: "acct_1",
          email: "user@example.com",
        }),
      } as unknown as CodexAuthClient,
      fetch: fetchMock as unknown as typeof fetch,
      defaultModel: "gpt-5.4",
    });

    const session = await Effect.runPromise(
      factory.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );

    await Effect.runPromise(
      Stream.runCollect(
        await Effect.runPromise(
          session.startTurn({
            bookmarkId: "bookmark_1",
            turnId: "turn_2",
            messageId: "message_2",
            userMessage: "Follow up",
            instructions: assistantInstructions,
            contextMessages: [],
            historyItems: [
              {
                type: "message",
                role: "user",
                channel: null,
                content: "First question",
              },
              {
                type: "message",
                role: "assistant",
                channel: "final",
                content: "Partial answer",
                reason: "incomplete",
              },
              {
                type: "message",
                role: "assistant",
                channel: "final",
                content: "Complete answer",
                reason: "stop",
              },
            ],
            tools: [],
          }),
        ),
      ),
    );

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"),
    );
    expect(request.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: "First question" }],
      },
      {
        role: "assistant",
        content: [{ type: "output_text", text: "Complete answer" }],
        phase: "final_answer",
      },
      {
        role: "user",
        content: [{ type: "input_text", text: "Follow up" }],
      },
    ]);
  });

  it("skips incomplete assistant fallback context messages when no history items exist", async () => {
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

    const factory = createCodexRuntimeFactory({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi.fn().mockResolvedValue({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 120_000,
          accountId: "acct_1",
          email: "user@example.com",
        }),
      } as unknown as CodexAuthClient,
      fetch: fetchMock as unknown as typeof fetch,
      defaultModel: "gpt-5.4",
    });

    const session = await Effect.runPromise(
      factory.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );

    await Effect.runPromise(
      Stream.runCollect(
        await Effect.runPromise(
          session.startTurn({
            bookmarkId: "bookmark_1",
            turnId: "turn_2",
            messageId: "message_2",
            userMessage: "Follow up",
            instructions: assistantInstructions,
            contextMessages: [
              {
                role: "user",
                channel: null,
                content: "First question",
                reason: null,
              },
              {
                role: "assistant",
                channel: "final",
                content: "Partial answer",
                reason: "incomplete",
              },
              {
                role: "assistant",
                channel: "final",
                content: "Complete answer",
                reason: "stop",
              },
            ],
            historyItems: [],
            tools: [],
          }),
        ),
      ),
    );

    const request = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"),
    );
    expect(request.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: "First question" }],
      },
      {
        role: "assistant",
        content: [{ type: "output_text", text: "Complete answer" }],
        phase: "final_answer",
      },
      {
        role: "user",
        content: [{ type: "input_text", text: "Follow up" }],
      },
    ]);
  });

  it("keeps commentary segments distinct across tool-result continuations", async () => {
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
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","phase":"commentary"}}\n\n' +
            'data: {"type":"response.output_text.delta","delta":"Reviewing the notes."}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"Reviewing the notes."}]}}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_1","name":"read","arguments":"{\\"path\\":\\"notes.md\\"}"}}\n\n' +
            'data: {"type":"response.completed"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_2","role":"assistant","phase":"commentary"}}\n\n' +
            'data: {"type":"response.output_text.delta","delta":"Cross-checking the summary."}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_2","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"Cross-checking the summary."}]}}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_2","name":"grep","arguments":"{\\"pattern\\":\\"replay\\"}"}}\n\n' +
            'data: {"type":"response.completed"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_3","role":"assistant","phase":"final_answer"}}\n\n' +
            'data: {"type":"response.output_text.delta","delta":"Replay restores missed durable history, while reconnect only restores transport."}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_3","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Replay restores missed durable history, while reconnect only restores transport."}]}}\n\n' +
            'data: {"type":"response.completed"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const factory = createCodexRuntimeFactory({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi.fn().mockResolvedValue({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 120_000,
          accountId: "acct_1",
          email: "user@example.com",
        }),
      } as unknown as CodexAuthClient,
      fetch: fetchMock as unknown as typeof fetch,
      defaultModel: "gpt-5.4",
    });

    const session = await Effect.runPromise(
      factory.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );

    const firstStream = await Effect.runPromise(
      session.startTurn({
        bookmarkId: "bookmark_1",
        turnId: "turn_1",
        messageId: "message_1",
        userMessage: "Help me compare replay and reconnect.",
        instructions: assistantInstructions,
        contextMessages: [],
        historyItems: [],
        tools: [
          {
            name: "read",
            description: "Read a file",
            inputSchema: { type: "object" },
          },
          {
            name: "grep",
            description: "Search files",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );

    expect(
      Array.from(await Effect.runPromise(Stream.runCollect(firstStream))),
    ).toEqual([
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:0",
        channel: "commentary",
        delta: "Reviewing the notes.",
      },
      {
        type: "output.message.completed",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:0",
        channel: "commentary",
        reason: "tool_calls",
      },
      {
        type: "tool.call.requested",
        turnId: "turn_1",
        toolCallId: "call_1",
        toolName: "read",
        input: { path: "notes.md" },
      },
    ]);

    const secondStream = await Effect.runPromise(
      session.submitToolResults({
        turnId: "turn_1",
        toolResults: [
          {
            toolCallId: "call_1",
            toolName: "read",
            output: "replay notes",
          },
        ],
        instructions: assistantInstructions,
        historyItems: [
          {
            type: "tool_call",
            toolCallId: "call_1",
            toolName: "read",
            input: { path: "notes.md" },
          },
          {
            type: "tool_result",
            toolCallId: "call_1",
            output: "replay notes",
          },
        ],
        tools: [
          {
            name: "read",
            description: "Read a file",
            inputSchema: { type: "object" },
          },
          {
            name: "grep",
            description: "Search files",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );

    expect(
      Array.from(await Effect.runPromise(Stream.runCollect(secondStream))),
    ).toEqual([
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:1",
        channel: "commentary",
        delta: "Cross-checking the summary.",
      },
      {
        type: "output.message.completed",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:1",
        channel: "commentary",
        reason: "tool_calls",
      },
      {
        type: "tool.call.requested",
        turnId: "turn_1",
        toolCallId: "call_2",
        toolName: "grep",
        input: { pattern: "replay" },
      },
    ]);

    const finalStream = await Effect.runPromise(
      session.submitToolResults({
        turnId: "turn_1",
        toolResults: [
          {
            toolCallId: "call_2",
            toolName: "grep",
            output: "notes.md:1:replay",
          },
        ],
        instructions: assistantInstructions,
        historyItems: [
          {
            type: "tool_call",
            toolCallId: "call_1",
            toolName: "read",
            input: { path: "notes.md" },
          },
          {
            type: "tool_result",
            toolCallId: "call_1",
            output: "replay notes",
          },
          {
            type: "tool_call",
            toolCallId: "call_2",
            toolName: "grep",
            input: { pattern: "replay" },
          },
          {
            type: "tool_result",
            toolCallId: "call_2",
            output: "notes.md:1:replay",
          },
        ],
        tools: [
          {
            name: "read",
            description: "Read a file",
            inputSchema: { type: "object" },
          },
          {
            name: "grep",
            description: "Search files",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );

    expect(
      Array.from(await Effect.runPromise(Stream.runCollect(finalStream))),
    ).toEqual([
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:final",
        channel: "final",
        delta:
          "Replay restores missed durable history, while reconnect only restores transport.",
      },
      {
        type: "output.message.completed",
        turnId: "turn_1",
        messageId: "turn_1:assistant:final",
        channel: "final",
        reason: "stop",
      },
      {
        type: "turn.completed",
        turnId: "turn_1",
      },
    ]);
  });

  it("keeps multiple commentary items distinct within a single response", async () => {
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
          'data: {"type":"response.output_item.added","item":{"type":"message","id":"commentary_a","role":"assistant","phase":"commentary"}}\n\n' +
            'data: {"type":"response.output_text.delta","item_id":"commentary_a","delta":"First note. "}\n\n' +
            'data: {"type":"response.output_item.added","item":{"type":"message","id":"commentary_b","role":"assistant","phase":"commentary"}}\n\n' +
            'data: {"type":"response.output_text.delta","item_id":"commentary_b","delta":"Second note."}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"message","id":"commentary_a","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"First note. "}]}}\n\n' +
            'data: {"type":"response.output_item.done","item":{"type":"message","id":"commentary_b","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"Second note."}]}}\n\n' +
            'data: {"type":"response.completed"}\n\n',
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

    const factory = createCodexRuntimeFactory({
      authRepository: authRepository as never,
      authClient: {
        refreshAccessToken: vi.fn().mockResolvedValue({
          accessToken: "access",
          refreshToken: "refresh",
          expiresAt: Date.now() + 120_000,
          accountId: "acct_1",
          email: "user@example.com",
        }),
      } as unknown as CodexAuthClient,
      fetch: fetchMock as unknown as typeof fetch,
      defaultModel: "gpt-5.4",
    });

    const session = await Effect.runPromise(
      factory.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );

    const stream = await Effect.runPromise(
      session.startTurn({
        bookmarkId: "bookmark_1",
        turnId: "turn_1",
        messageId: "message_1",
        userMessage: "Summarize these notes.",
        instructions: assistantInstructions,
        contextMessages: [],
        historyItems: [],
        tools: [],
      }),
    );

    expect(
      Array.from(await Effect.runPromise(Stream.runCollect(stream))),
    ).toEqual([
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:0",
        channel: "commentary",
        delta: "First note. ",
      },
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:1",
        channel: "commentary",
        delta: "Second note.",
      },
      {
        type: "output.message.completed",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:0",
        channel: "commentary",
        reason: "stop",
      },
      {
        type: "output.message.completed",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:1",
        channel: "commentary",
        reason: "stop",
      },
      {
        type: "turn.completed",
        turnId: "turn_1",
      },
    ]);
  });
});
