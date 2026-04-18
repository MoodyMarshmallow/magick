import type { ThreadSummary, ThreadViewModel } from "@magick/contracts/chat";
import { projectThreadEvent } from "./threadProjector";

const summary: ThreadSummary = {
  threadId: "thread_1",
  workspaceId: "workspace_default",
  providerKey: "codex",
  title: "Chat 1",
  resolutionState: "open",
  runtimeState: "idle",
  latestSequence: 1,
  latestActivityAt: "2026-04-02T10:00:00.000Z",
  updatedAt: "2026-04-02T10:00:00.000Z",
};

const thread: ThreadViewModel = {
  threadId: "thread_1",
  workspaceId: "workspace_default",
  providerKey: "codex",
  providerSessionId: "session_1",
  title: "Chat 1",
  resolutionState: "open",
  runtimeState: "idle",
  messages: [
    {
      id: "message_1",
      role: "user",
      channel: null,
      content: "hello",
      createdAt: "2026-04-02T10:00:00.000Z",
      status: "complete",
    },
  ],
  toolActivities: [],
  pendingToolApproval: null,
  activeTurnId: null,
  latestSequence: 1,
  lastError: null,
  lastUserMessageAt: "2026-04-02T10:00:00.000Z",
  lastAssistantMessageAt: null,
  latestActivityAt: "2026-04-02T10:00:00.000Z",
  updatedAt: "2026-04-02T10:00:00.000Z",
};

describe("projectThreadEvent", () => {
  it("loads bootstrap summaries and merges an active thread snapshot", () => {
    const projected = projectThreadEvent([], {
      type: "snapshot.loaded",
      threads: [summary],
      activeThread: thread,
    });

    expect(projected).toEqual([
      expect.objectContaining({
        threadId: "thread_1",
        status: "open",
        runtimeState: "idle",
        messages: [expect.objectContaining({ body: "hello" })],
      }),
    ]);
  });

  it("projects streamed assistant output and completion", () => {
    const initial = projectThreadEvent([], {
      type: "snapshot.loaded",
      threads: [summary],
      activeThread: thread,
    });

    const firstThread = initial[0];
    expect(firstThread).toBeDefined();

    const started = projectThreadEvent(firstThread ? [firstThread] : [], {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_2",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 2,
        occurredAt: "2026-04-02T10:01:00.000Z",
        type: "message.assistant.delta",
        payload: {
          turnId: "turn_1",
          messageId: "turn_1:assistant:final",
          channel: "final",
          delta: "world",
        },
      },
    });

    expect(started[0]?.runtimeState).toBe("running");
    expect(started[0]?.messages.at(-1)).toMatchObject({
      author: "ai",
      channel: "final",
      body: "world",
      status: "streaming",
    });

    const completed = projectThreadEvent(started, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_3",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 3,
        occurredAt: "2026-04-02T10:02:00.000Z",
        type: "message.assistant.completed",
        payload: {
          turnId: "turn_1",
          messageId: "turn_1:assistant:final",
          channel: "final",
        },
      },
    });

    const settled = projectThreadEvent(completed, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_4",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 4,
        occurredAt: "2026-04-02T10:02:30.000Z",
        type: "turn.completed",
        payload: {
          turnId: "turn_1",
        },
      },
    });

    expect(settled[0]?.runtimeState).toBe("idle");
    expect(settled[0]?.messages.at(-1)?.status).toBe("complete");
  });

  it("keeps incomplete assistant completions streaming until the turn fails", () => {
    const initial = projectThreadEvent([], {
      type: "snapshot.loaded",
      threads: [summary],
      activeThread: {
        ...thread,
        runtimeState: "running",
        activeTurnId: "turn_1",
        messages: [
          ...thread.messages,
          {
            id: "turn_1:assistant:final",
            role: "assistant",
            channel: "final",
            content: "Partial",
            createdAt: "2026-04-02T10:01:00.000Z",
            status: "streaming",
            reason: null,
          },
        ],
      },
    });

    const incomplete = projectThreadEvent(initial, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_3",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 3,
        occurredAt: "2026-04-02T10:02:00.000Z",
        type: "message.assistant.completed",
        payload: {
          turnId: "turn_1",
          messageId: "turn_1:assistant:final",
          channel: "final",
          reason: "incomplete",
        },
      },
    });

    expect(incomplete[0]?.messages.at(-1)?.status).toBe("streaming");

    const failed = projectThreadEvent(incomplete, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_4",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 4,
        occurredAt: "2026-04-02T10:03:00.000Z",
        type: "turn.failed",
        payload: {
          turnId: "turn_1",
          error: "Socket lost",
        },
      },
    });

    expect(failed[0]?.messages.at(-1)?.status).toBe("failed");
  });

  it("merges replayed assistant deltas into an existing completed message without duplication", () => {
    const initial = projectThreadEvent([], {
      type: "snapshot.loaded",
      threads: [summary],
      activeThread: {
        ...thread,
        messages: [
          ...thread.messages,
          {
            id: "turn_1:assistant:final",
            role: "assistant",
            channel: "final",
            content: "Hello",
            createdAt: "2026-04-02T10:01:00.000Z",
            status: "complete",
          },
        ],
      },
    });

    const projected = projectThreadEvent(initial, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_overlap",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 2,
        occurredAt: "2026-04-02T10:01:30.000Z",
        type: "message.assistant.delta",
        payload: {
          turnId: "turn_1",
          messageId: "turn_1:assistant:final",
          channel: "final",
          delta: " world",
        },
      },
    });

    const assistantMessages =
      projected[0]?.messages.filter(
        (message) => message.id === "turn_1:assistant:final",
      ) ?? [];

    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      id: "turn_1:assistant:final",
      body: "Hello world",
      status: "complete",
    });
  });

  it("projects resolved state changes", () => {
    const projected = projectThreadEvent(
      projectThreadEvent([], {
        type: "snapshot.loaded",
        threads: [summary],
        activeThread: null,
      }),
      {
        type: "domain.event",
        threadId: "thread_1",
        event: {
          eventId: "event_2",
          threadId: "thread_1",
          providerSessionId: "session_1",
          sequence: 2,
          occurredAt: "2026-04-02T10:01:00.000Z",
          type: "thread.resolved",
          payload: {},
        },
      },
    );

    expect(projected[0]?.status).toBe("resolved");
  });

  it("projects renamed and deleted threads", () => {
    const renamed = projectThreadEvent(
      projectThreadEvent([], {
        type: "snapshot.loaded",
        threads: [summary],
        activeThread: null,
      }),
      {
        type: "domain.event",
        threadId: "thread_1",
        event: {
          eventId: "event_rename",
          threadId: "thread_1",
          providerSessionId: "session_1",
          sequence: 2,
          occurredAt: "2026-04-02T10:01:00.000Z",
          type: "thread.renamed",
          payload: {
            title: "Renamed chat",
          },
        },
      },
    );

    expect(renamed[0]?.title).toBe("Renamed chat");

    const deleted = projectThreadEvent(renamed, {
      type: "thread.deleted",
      threadId: "thread_1",
    });

    expect(deleted).toEqual([]);
  });

  it("projects approval requests and rejection states", () => {
    const initial = projectThreadEvent([], {
      type: "snapshot.loaded",
      threads: [summary],
      activeThread: thread,
    });

    const withTool = projectThreadEvent(initial, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_tool_1",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 2,
        occurredAt: "2026-04-02T10:03:00.000Z",
        type: "tool.requested",
        payload: {
          turnId: "turn_1",
          toolCallId: "tool_1",
          toolName: "read",
          title: "Read notes.md",
          argsPreview: '{"path":"notes.md"}',
          path: "notes.md",
          url: null,
        },
      },
    });

    const awaiting = projectThreadEvent(withTool, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_tool_2",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 3,
        occurredAt: "2026-04-02T10:04:00.000Z",
        type: "tool.approval.requested",
        payload: {
          turnId: "turn_1",
          toolCallId: "tool_1",
          toolName: "read",
          path: "../outside.md",
          reason: "Outside workspace root",
        },
      },
    });

    const rejected = projectThreadEvent(awaiting, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_tool_3",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 4,
        occurredAt: "2026-04-02T10:05:00.000Z",
        type: "tool.approval.resolved",
        payload: {
          turnId: "turn_1",
          toolCallId: "tool_1",
          decision: "rejected",
        },
      },
    });

    expect(awaiting[0]?.runtimeState).toBe("awaiting_approval");
    expect(awaiting[0]?.pendingToolApproval).toMatchObject({
      toolCallId: "tool_1",
      reason: "Outside workspace root",
    });
    expect(rejected[0]?.runtimeState).toBe("failed");
    expect(rejected[0]?.pendingToolApproval).toBeNull();
    expect(rejected[0]?.toolActivities[0]).toMatchObject({
      status: "failed",
      error: "Tool execution was rejected.",
    });
  });

  it("splits assistant messages around tool requests in the same turn", () => {
    const initial = projectThreadEvent([], {
      type: "snapshot.loaded",
      threads: [summary],
      activeThread: null,
    });

    const withFirstDelta = projectThreadEvent(initial, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_2",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 2,
        occurredAt: "2026-04-02T10:01:00.000Z",
        type: "message.assistant.delta",
        payload: {
          turnId: "turn_1",
          messageId: "turn_1:assistant:commentary:0",
          channel: "commentary",
          delta: "Before tool. ",
        },
      },
    });

    const withTool = projectThreadEvent(withFirstDelta, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_3",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 3,
        occurredAt: "2026-04-02T10:02:00.000Z",
        type: "tool.requested",
        payload: {
          turnId: "turn_1",
          toolCallId: "tool_1",
          toolName: "read",
          title: "Read notes.md",
          argsPreview: '{"path":"notes.md"}',
          path: "notes.md",
          url: null,
        },
      },
    });

    const withSecondDelta = projectThreadEvent(withTool, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_4",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 4,
        occurredAt: "2026-04-02T10:03:00.000Z",
        type: "message.assistant.delta",
        payload: {
          turnId: "turn_1",
          messageId: "turn_1:assistant:final",
          channel: "final",
          delta: "After tool.",
        },
      },
    });

    const completed = projectThreadEvent(withSecondDelta, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_5",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 5,
        occurredAt: "2026-04-02T10:04:00.000Z",
        type: "message.assistant.completed",
        payload: {
          turnId: "turn_1",
          messageId: "turn_1:assistant:final",
          channel: "final",
        },
      },
    });

    const settled = projectThreadEvent(completed, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_6",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 6,
        occurredAt: "2026-04-02T10:04:30.000Z",
        type: "turn.completed",
        payload: {
          turnId: "turn_1",
        },
      },
    });

    expect(settled[0]?.messages).toEqual([
      expect.objectContaining({
        id: "turn_1:assistant:commentary:0",
        channel: "commentary",
        body: "Before tool. ",
        status: "complete",
      }),
      expect.objectContaining({
        id: "turn_1:assistant:final",
        channel: "final",
        body: "After tool.",
        status: "complete",
      }),
    ]);
    expect(settled[0]?.toolActivities).toEqual([
      expect.objectContaining({
        toolCallId: "tool_1",
        createdAt: "2026-04-02T10:02:00.000Z",
      }),
    ]);
  });

  it("keeps completed commentary complete if the turn later fails or is interrupted", () => {
    const initial = projectThreadEvent([], {
      type: "snapshot.loaded",
      threads: [summary],
      activeThread: null,
    });

    const withCommentary = projectThreadEvent(initial, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_2",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 2,
        occurredAt: "2026-04-02T10:01:00.000Z",
        type: "message.assistant.delta",
        payload: {
          turnId: "turn_1",
          messageId: "turn_1:assistant:commentary:0",
          channel: "commentary",
          delta: "Checking the notes.",
        },
      },
    });

    const withTool = projectThreadEvent(withCommentary, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_3",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 3,
        occurredAt: "2026-04-02T10:02:00.000Z",
        type: "tool.requested",
        payload: {
          turnId: "turn_1",
          toolCallId: "tool_1",
          toolName: "read",
          title: "Read notes.md",
          argsPreview: '{"path":"notes.md"}',
          path: "notes.md",
          url: null,
        },
      },
    });

    const interrupted = projectThreadEvent(withTool, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_4",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 4,
        occurredAt: "2026-04-02T10:03:00.000Z",
        type: "turn.interrupted",
        payload: { turnId: "turn_1", reason: "Stopped during tool" },
      },
    });

    expect(interrupted[0]?.messages).toContainEqual(
      expect.objectContaining({
        id: "turn_1:assistant:commentary:0",
        status: "complete",
      }),
    );

    const failed = projectThreadEvent(withTool, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_5",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 5,
        occurredAt: "2026-04-02T10:03:30.000Z",
        type: "turn.failed",
        payload: { turnId: "turn_1", error: "Tool failed" },
      },
    });

    expect(failed[0]?.messages).toContainEqual(
      expect.objectContaining({
        id: "turn_1:assistant:commentary:0",
        status: "complete",
      }),
    );
  });

  it("updates all streaming assistant messages for turn-level tool and failure events", () => {
    const initial = projectThreadEvent([], {
      type: "snapshot.loaded",
      threads: [summary],
      activeThread: null,
    });

    const withCommentary = projectThreadEvent(initial, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_2",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 2,
        occurredAt: "2026-04-02T10:01:00.000Z",
        type: "message.assistant.delta",
        payload: {
          turnId: "turn_1",
          messageId: "turn_1:assistant:commentary:0",
          channel: "commentary",
          delta: "Inspecting notes. ",
        },
      },
    });

    const withFinal = projectThreadEvent(withCommentary, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_3",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 3,
        occurredAt: "2026-04-02T10:01:30.000Z",
        type: "message.assistant.delta",
        payload: {
          turnId: "turn_1",
          messageId: "turn_1:assistant:final",
          channel: "final",
          delta: "Drafting answer.",
        },
      },
    });

    const withTool = projectThreadEvent(withFinal, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_4",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 4,
        occurredAt: "2026-04-02T10:02:00.000Z",
        type: "tool.requested",
        payload: {
          turnId: "turn_1",
          toolCallId: "tool_1",
          toolName: "read",
          title: "Read notes.md",
          argsPreview: '{"path":"notes.md"}',
          path: "notes.md",
          url: null,
        },
      },
    });

    expect(withTool[0]?.messages).toEqual([
      expect.objectContaining({
        id: "turn_1:assistant:commentary:0",
        status: "complete",
      }),
      expect.objectContaining({
        id: "turn_1:assistant:final",
        status: "complete",
      }),
    ]);

    const failed = projectThreadEvent(withFinal, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_5",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 5,
        occurredAt: "2026-04-02T10:02:30.000Z",
        type: "turn.failed",
        payload: { turnId: "turn_1", error: "Socket lost" },
      },
    });

    expect(failed[0]?.messages).toEqual([
      expect.objectContaining({
        id: "turn_1:assistant:commentary:0",
        status: "failed",
      }),
      expect.objectContaining({
        id: "turn_1:assistant:final",
        status: "failed",
      }),
    ]);

    const interrupted = projectThreadEvent(withFinal, {
      type: "domain.event",
      threadId: "thread_1",
      event: {
        eventId: "event_6",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 6,
        occurredAt: "2026-04-02T10:03:00.000Z",
        type: "turn.interrupted",
        payload: { turnId: "turn_1", reason: "Stopped" },
      },
    });

    expect(interrupted[0]?.messages).toEqual([
      expect.objectContaining({
        id: "turn_1:assistant:commentary:0",
        status: "interrupted",
      }),
      expect.objectContaining({
        id: "turn_1:assistant:final",
        status: "interrupted",
      }),
    ]);
  });
});
