// Verifies thread projection behavior across message and turn events.

import { projectThreadEvents } from "./threadProjector";

describe("projectThreadEvents", () => {
  it("builds a thread view model from sequenced events", () => {
    const thread = projectThreadEvents(null, [
      {
        eventId: "event_1",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 1,
        occurredAt: "2026-01-01T00:00:00.000Z",
        type: "thread.created",
        payload: {
          workspaceId: "workspace_1",
          providerKey: "fake",
          title: "Chat",
        },
      },
      {
        eventId: "event_2",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 2,
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "message.user.created",
        payload: {
          messageId: "message_1",
          content: "Hello",
        },
      },
      {
        eventId: "event_3",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 3,
        occurredAt: "2026-01-01T00:00:02.000Z",
        type: "turn.started",
        payload: {
          turnId: "turn_1",
          parentTurnId: null,
        },
      },
      {
        eventId: "event_4",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 4,
        occurredAt: "2026-01-01T00:00:03.000Z",
        type: "turn.delta",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
          delta: "Hi",
        },
      },
      {
        eventId: "event_5",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 5,
        occurredAt: "2026-01-01T00:00:04.000Z",
        type: "turn.completed",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
        },
      },
    ]);

    expect(thread.status).toBe("idle");
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]).toMatchObject({
      role: "assistant",
      content: "Hi",
      status: "complete",
    });
    expect(thread.latestSequence).toBe(5);
  });

  it("projects failed, interrupted, and disconnected session states", () => {
    const thread = projectThreadEvents(null, [
      {
        eventId: "event_1",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 1,
        occurredAt: "2026-01-01T00:00:00.000Z",
        type: "thread.created",
        payload: {
          workspaceId: "workspace_1",
          providerKey: "fake",
          title: "Chat",
        },
      },
      {
        eventId: "event_2",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 2,
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "turn.started",
        payload: {
          turnId: "turn_1",
          parentTurnId: null,
        },
      },
      {
        eventId: "event_3",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 3,
        occurredAt: "2026-01-01T00:00:02.000Z",
        type: "turn.delta",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
          delta: "Partial",
        },
      },
      {
        eventId: "event_4",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 4,
        occurredAt: "2026-01-01T00:00:03.000Z",
        type: "turn.interrupted",
        payload: {
          turnId: "turn_1",
          reason: "Stopped",
        },
      },
      {
        eventId: "event_5",
        threadId: "thread_1",
        providerSessionId: "session_1",
        sequence: 5,
        occurredAt: "2026-01-01T00:00:04.000Z",
        type: "provider.session.disconnected",
        payload: {
          reason: "Socket lost",
        },
      },
    ]);

    expect(thread.status).toBe("interrupted");
    expect(thread.lastError).toBe("Socket lost");
    expect(thread.messages.at(-1)).toMatchObject({
      status: "interrupted",
      content: "Partial",
    });
  });
});
