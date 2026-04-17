import {
  createThreadServicesContext,
  createThreadViewModel,
  run,
} from "../test-support/threadTestSupport";

describe("ThreadHistoryBuilder", () => {
  it("builds context messages from the projected thread snapshot", () => {
    const { historyBuilder } = createThreadServicesContext();
    const contextMessages = historyBuilder.buildContextMessages(
      createThreadViewModel({
        messages: [
          {
            id: "message_1",
            role: "user",
            channel: null,
            content: "hello",
            status: "complete",
            createdAt: "2026-04-17T00:00:00.000Z",
          },
          {
            id: "message_2",
            role: "assistant",
            channel: "commentary",
            content: "working",
            status: "streaming",
            createdAt: "2026-04-17T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(contextMessages).toEqual([
      { role: "user", channel: null, content: "hello" },
      { role: "assistant", channel: "commentary", content: "working" },
    ]);
  });

  it("rebuilds conversation history across user messages, assistant deltas, and tool events", async () => {
    const { crudService, historyBuilder, eventPersistence } =
      createThreadServicesContext();
    const thread = await run(
      crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: "fake",
        title: "History thread",
      }),
    );

    await run(
      eventPersistence.persistAndProject(thread.threadId, [
        {
          eventId: "event_user",
          threadId: thread.threadId,
          providerSessionId: "session_1",
          occurredAt: "2026-04-17T00:00:00.000Z",
          type: "message.user.created",
          payload: { messageId: "user_1", content: "First" },
        },
        {
          eventId: "event_assistant_1",
          threadId: thread.threadId,
          providerSessionId: "session_1",
          occurredAt: "2026-04-17T00:00:00.000Z",
          type: "message.assistant.delta",
          payload: {
            turnId: "turn_1",
            messageId: "assistant_1",
            channel: "commentary",
            delta: "Think",
          },
        },
        {
          eventId: "event_assistant_2",
          threadId: thread.threadId,
          providerSessionId: "session_1",
          occurredAt: "2026-04-17T00:00:00.000Z",
          type: "message.assistant.delta",
          payload: {
            turnId: "turn_1",
            messageId: "assistant_1",
            channel: "commentary",
            delta: "ing",
          },
        },
        {
          eventId: "event_tool_requested_1",
          threadId: thread.threadId,
          providerSessionId: "session_1",
          occurredAt: "2026-04-17T00:00:00.000Z",
          type: "tool.requested",
          payload: {
            turnId: "turn_1",
            toolCallId: "tool_1",
            toolName: "read",
            title: "read",
            argsPreview: '{"path":"notes.md"}',
            input: undefined,
            path: "notes.md",
            url: null,
          },
        },
        {
          eventId: "event_tool_requested_2",
          threadId: thread.threadId,
          providerSessionId: "session_1",
          occurredAt: "2026-04-17T00:00:00.000Z",
          type: "tool.requested",
          payload: {
            turnId: "turn_1",
            toolCallId: "tool_2",
            toolName: "apply_patch",
            title: "apply_patch",
            argsPreview: null,
            input: {
              path: "notes.md",
              patches: [{ find: "a", replace: "b" }],
            },
            path: "notes.md",
            url: null,
          },
        },
        {
          eventId: "event_tool_requested_3",
          threadId: thread.threadId,
          providerSessionId: "session_1",
          occurredAt: "2026-04-17T00:00:00.000Z",
          type: "tool.requested",
          payload: {
            turnId: "turn_1",
            toolCallId: "tool_3",
            toolName: "fetch",
            title: "fetch",
            argsPreview: "not json",
            input: undefined,
            path: null,
            url: "https://example.com",
          },
        },
        {
          eventId: "event_tool_completed_1",
          threadId: thread.threadId,
          providerSessionId: "session_1",
          occurredAt: "2026-04-17T00:00:00.000Z",
          type: "tool.completed",
          payload: {
            turnId: "turn_1",
            toolCallId: "tool_1",
            resultPreview: "preview",
            modelOutput: "file content",
            path: "notes.md",
            url: null,
            diff: null,
          },
        },
        {
          eventId: "event_tool_completed_2",
          threadId: thread.threadId,
          providerSessionId: "session_1",
          occurredAt: "2026-04-17T00:00:00.000Z",
          type: "tool.completed",
          payload: {
            turnId: "turn_1",
            toolCallId: "tool_2",
            resultPreview: "preview only",
            modelOutput: null,
            path: "notes.md",
            url: null,
            diff: null,
          },
        },
        {
          eventId: "event_tool_completed_3",
          threadId: thread.threadId,
          providerSessionId: "session_1",
          occurredAt: "2026-04-17T00:00:00.000Z",
          type: "tool.completed",
          payload: {
            turnId: "turn_1",
            toolCallId: "tool_4",
            resultPreview: null,
            modelOutput: null,
            path: null,
            url: null,
            diff: null,
          },
        },
        {
          eventId: "event_tool_failed_1",
          threadId: thread.threadId,
          providerSessionId: "session_1",
          occurredAt: "2026-04-17T00:00:00.000Z",
          type: "tool.failed",
          payload: {
            turnId: "turn_1",
            toolCallId: "tool_5",
            error: "boom",
            modelOutput: null,
          },
        },
      ]),
    );

    expect(historyBuilder.buildConversationHistory(thread.threadId)).toEqual([
      { type: "message", role: "user", channel: null, content: "First" },
      {
        type: "message",
        role: "assistant",
        channel: "commentary",
        content: "Thinking",
      },
      {
        type: "tool_call",
        toolCallId: "tool_1",
        toolName: "read",
        input: { path: "notes.md" },
      },
      {
        type: "tool_call",
        toolCallId: "tool_2",
        toolName: "apply_patch",
        input: { path: "notes.md", patches: [{ find: "a", replace: "b" }] },
      },
      {
        type: "tool_call",
        toolCallId: "tool_3",
        toolName: "fetch",
        input: { rawInput: "not json" },
      },
      { type: "tool_result", toolCallId: "tool_1", output: "file content" },
      { type: "tool_result", toolCallId: "tool_2", output: "preview only" },
      { type: "tool_result", toolCallId: "tool_4", output: "" },
      {
        type: "tool_result",
        toolCallId: "tool_5",
        output: "Tool execution failed: boom",
      },
    ]);
  });
});
