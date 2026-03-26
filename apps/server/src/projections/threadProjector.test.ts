// Verifies thread projection behavior across replay, turn lifecycle, and summary state.

import type { DomainEvent, ThreadViewModel } from "@magick/contracts/chat";
import { projectThreadEvents, toThreadSummary } from "./threadProjector";

const eventBase = {
  threadId: "thread_1",
  providerSessionId: "session_1",
} satisfies Pick<DomainEvent, "threadId" | "providerSessionId">;

const makeEvent = <TEvent extends DomainEvent>(
  event: Omit<TEvent, "eventId" | "threadId" | "providerSessionId">,
): TEvent => {
  return {
    eventId: `event_${event.sequence}`,
    threadId: eventBase.threadId,
    providerSessionId: eventBase.providerSessionId,
    ...event,
  } as TEvent;
};

const createdEvent = () =>
  makeEvent({
    sequence: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    type: "thread.created",
    payload: {
      workspaceId: "workspace_1",
      providerKey: "fake",
      title: "Chat",
    },
  });

const runningSeed: ThreadViewModel = {
  threadId: "thread_1",
  workspaceId: "workspace_1",
  providerKey: "fake",
  providerSessionId: "session_1",
  title: "Chat",
  status: "running",
  messages: [
    {
      id: "message_1",
      role: "user",
      content: "Hello",
      status: "complete",
    },
    {
      id: "turn_1:assistant",
      role: "assistant",
      content: "Part 1",
      status: "streaming",
    },
  ],
  activeTurnId: "turn_1",
  latestSequence: 3,
  lastError: null,
  lastUserMessageAt: "2026-01-01T00:00:01.000Z",
  lastAssistantMessageAt: "2026-01-01T00:00:03.000Z",
  updatedAt: "2026-01-01T00:00:03.000Z",
};

describe("projectThreadEvents", () => {
  it("builds a thread view model from sequenced events", () => {
    const thread = projectThreadEvents(null, [
      createdEvent(),
      makeEvent({
        sequence: 2,
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "message.user.created",
        payload: {
          messageId: "message_1",
          content: "Hello",
        },
      }),
      makeEvent({
        sequence: 3,
        occurredAt: "2026-01-01T00:00:02.000Z",
        type: "turn.started",
        payload: {
          turnId: "turn_1",
          parentTurnId: null,
        },
      }),
      makeEvent({
        sequence: 4,
        occurredAt: "2026-01-01T00:00:03.000Z",
        type: "turn.delta",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
          delta: "Hi",
        },
      }),
      makeEvent({
        sequence: 5,
        occurredAt: "2026-01-01T00:00:04.000Z",
        type: "turn.completed",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
        },
      }),
    ]);

    expect(thread.status).toBe("idle");
    expect(thread.activeTurnId).toBeNull();
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]).toMatchObject({
      id: "turn_1:assistant",
      role: "assistant",
      content: "Hi",
      status: "complete",
    });
    expect(thread.lastUserMessageAt).toBe("2026-01-01T00:00:01.000Z");
    expect(thread.lastAssistantMessageAt).toBe("2026-01-01T00:00:04.000Z");
    expect(thread.latestSequence).toBe(5);
  });

  it("appends multiple deltas into a single assistant message", () => {
    const thread = projectThreadEvents(null, [
      createdEvent(),
      makeEvent({
        sequence: 2,
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "turn.started",
        payload: {
          turnId: "turn_1",
          parentTurnId: null,
        },
      }),
      makeEvent({
        sequence: 3,
        occurredAt: "2026-01-01T00:00:02.000Z",
        type: "turn.delta",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
          delta: "Hello",
        },
      }),
      makeEvent({
        sequence: 4,
        occurredAt: "2026-01-01T00:00:03.000Z",
        type: "turn.delta",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
          delta: ", world",
        },
      }),
      makeEvent({
        sequence: 5,
        occurredAt: "2026-01-01T00:00:04.000Z",
        type: "turn.completed",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
        },
      }),
    ]);

    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({
      id: "turn_1:assistant",
      content: "Hello, world",
      status: "complete",
    });
    expect(thread.lastAssistantMessageAt).toBe("2026-01-01T00:00:04.000Z");
  });

  it("marks interrupted turns and preserves disconnect status while idle", () => {
    const thread = projectThreadEvents(null, [
      createdEvent(),
      makeEvent({
        sequence: 2,
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "turn.started",
        payload: {
          turnId: "turn_1",
          parentTurnId: null,
        },
      }),
      makeEvent({
        sequence: 3,
        occurredAt: "2026-01-01T00:00:02.000Z",
        type: "turn.delta",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
          delta: "Partial",
        },
      }),
      makeEvent({
        sequence: 4,
        occurredAt: "2026-01-01T00:00:03.000Z",
        type: "turn.interrupted",
        payload: {
          turnId: "turn_1",
          reason: "Stopped",
        },
      }),
      makeEvent({
        sequence: 5,
        occurredAt: "2026-01-01T00:00:04.000Z",
        type: "provider.session.disconnected",
        payload: {
          reason: "Socket lost",
        },
      }),
    ]);

    expect(thread.status).toBe("interrupted");
    expect(thread.lastError).toBe("Socket lost");
    expect(thread.messages.at(-1)).toMatchObject({
      status: "interrupted",
      content: "Partial",
    });
  });

  it("marks running threads as failed when the provider disconnects", () => {
    const thread = projectThreadEvents(null, [
      createdEvent(),
      makeEvent({
        sequence: 2,
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "turn.started",
        payload: {
          turnId: "turn_1",
          parentTurnId: null,
        },
      }),
      makeEvent({
        sequence: 3,
        occurredAt: "2026-01-01T00:00:02.000Z",
        type: "provider.session.disconnected",
        payload: {
          reason: "Socket lost",
        },
      }),
    ]);

    expect(thread.status).toBe("failed");
    expect(thread.activeTurnId).toBe("turn_1");
    expect(thread.lastError).toBe("Socket lost");
  });

  it("marks failed turns and updates the existing assistant message", () => {
    const thread = projectThreadEvents(null, [
      createdEvent(),
      makeEvent({
        sequence: 2,
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "turn.started",
        payload: {
          turnId: "turn_1",
          parentTurnId: null,
        },
      }),
      makeEvent({
        sequence: 3,
        occurredAt: "2026-01-01T00:00:02.000Z",
        type: "turn.delta",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
          delta: "Almost done",
        },
      }),
      makeEvent({
        sequence: 4,
        occurredAt: "2026-01-01T00:00:03.000Z",
        type: "turn.failed",
        payload: {
          turnId: "turn_1",
          error: "Provider exploded",
        },
      }),
    ]);

    expect(thread.status).toBe("failed");
    expect(thread.activeTurnId).toBeNull();
    expect(thread.lastError).toBe("Provider exploded");
    expect(thread.messages.at(-1)).toMatchObject({
      id: "turn_1:assistant",
      content: "Almost done",
      status: "failed",
    });
  });

  it("records provider session start and recovery updates", () => {
    const thread = projectThreadEvents(null, [
      createdEvent(),
      makeEvent({
        sequence: 2,
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "provider.session.started",
        payload: {
          providerKey: "fake",
          resumeStrategy: "rebuild",
        },
      }),
      {
        ...makeEvent({
          sequence: 3,
          occurredAt: "2026-01-01T00:00:02.000Z",
          type: "provider.session.recovered",
          payload: {
            reason: "Reconnected",
          },
        }),
        providerSessionId: "session_2",
      },
    ]);

    expect(thread.providerSessionId).toBe("session_2");
    expect(thread.latestSequence).toBe(3);
    expect(thread.updatedAt).toBe("2026-01-01T00:00:02.000Z");
  });

  it("replays events onto a seed without mutating the original thread", () => {
    const seed: ThreadViewModel = {
      ...runningSeed,
      messages: [...runningSeed.messages],
    };

    const thread = projectThreadEvents(seed, [
      makeEvent({
        sequence: 4,
        occurredAt: "2026-01-01T00:00:04.000Z",
        type: "turn.delta",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
          delta: " + Part 2",
        },
      }),
      makeEvent({
        sequence: 5,
        occurredAt: "2026-01-01T00:00:05.000Z",
        type: "turn.completed",
        payload: {
          turnId: "turn_1",
          messageId: "assistant_1",
        },
      }),
    ]);

    expect(thread).not.toBe(seed);
    expect(thread.messages).not.toBe(seed.messages);
    expect(seed.messages[1]?.content).toBe("Part 1");
    expect(seed.messages[1]?.status).toBe("streaming");
    expect(thread.messages[1]).toMatchObject({
      content: "Part 1 + Part 2",
      status: "complete",
    });
    expect(thread.status).toBe("idle");
  });

  it("throws when projecting without a seed or thread.created event", () => {
    expect(() =>
      projectThreadEvents(null, [
        makeEvent({
          sequence: 1,
          occurredAt: "2026-01-01T00:00:00.000Z",
          type: "turn.started",
          payload: {
            turnId: "turn_1",
            parentTurnId: null,
          },
        }),
      ]),
    ).toThrow("Thread projection requires a thread.created event as a seed.");
  });
});

describe("toThreadSummary", () => {
  it("returns the list-view fields from a projected thread", () => {
    const summary = toThreadSummary({
      ...runningSeed,
      status: "failed",
      latestSequence: 9,
      updatedAt: "2026-01-01T00:00:09.000Z",
    });

    expect(summary).toEqual({
      threadId: "thread_1",
      workspaceId: "workspace_1",
      providerKey: "fake",
      title: "Chat",
      status: "failed",
      latestSequence: 9,
      updatedAt: "2026-01-01T00:00:09.000Z",
    });
  });
});
