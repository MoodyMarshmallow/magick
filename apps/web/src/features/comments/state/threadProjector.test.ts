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
      content: "hello",
      createdAt: "2026-04-02T10:00:00.000Z",
      status: "complete",
    },
  ],
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
        type: "turn.delta",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
          delta: "world",
        },
      },
    });

    expect(started[0]?.runtimeState).toBe("running");
    expect(started[0]?.messages.at(-1)).toMatchObject({
      author: "ai",
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
        type: "turn.completed",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
        },
      },
    });

    expect(completed[0]?.runtimeState).toBe("idle");
    expect(completed[0]?.messages.at(-1)?.status).toBe("complete");
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
});
