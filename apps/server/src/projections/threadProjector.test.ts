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
  resolutionState: "open",
  runtimeState: "running",
  messages: [
    {
      id: "message_1",
      role: "user",
      content: "Hello",
      createdAt: "2026-01-01T00:00:01.000Z",
      status: "complete",
    },
    {
      id: "turn_1:assistant",
      role: "assistant",
      content: "Part 1",
      createdAt: "2026-01-01T00:00:03.000Z",
      status: "streaming",
    },
  ],
  activeTurnId: "turn_1",
  latestSequence: 3,
  lastError: null,
  lastUserMessageAt: "2026-01-01T00:00:01.000Z",
  lastAssistantMessageAt: "2026-01-01T00:00:03.000Z",
  latestActivityAt: "2026-01-01T00:00:03.000Z",
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
        payload: { messageId: "message_1", content: "Hello" },
      }),
      makeEvent({
        sequence: 3,
        occurredAt: "2026-01-01T00:00:02.000Z",
        type: "turn.started",
        payload: { turnId: "turn_1", parentTurnId: null },
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
        payload: { turnId: "turn_1", messageId: "assistant_1" },
      }),
    ]);

    expect(thread.runtimeState).toBe("idle");
    expect(thread.messages[1]).toMatchObject({
      content: "Hi",
      status: "complete",
    });
  });

  it("marks interrupted and failed turns correctly", () => {
    const interrupted = projectThreadEvents(null, [
      createdEvent(),
      makeEvent({
        sequence: 2,
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "turn.started",
        payload: { turnId: "turn_1", parentTurnId: null },
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
        payload: { turnId: "turn_1", reason: "Stopped" },
      }),
    ]);

    expect(interrupted.runtimeState).toBe("interrupted");

    const failed = projectThreadEvents(null, [
      createdEvent(),
      makeEvent({
        sequence: 2,
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "turn.started",
        payload: { turnId: "turn_1", parentTurnId: null },
      }),
      makeEvent({
        sequence: 3,
        occurredAt: "2026-01-01T00:00:02.000Z",
        type: "provider.session.disconnected",
        payload: { reason: "Socket lost" },
      }),
    ]);

    expect(failed.runtimeState).toBe("failed");
    expect(failed.lastError).toBe("Socket lost");
  });

  it("applies resolve and reopen events", () => {
    const resolved = projectThreadEvents(null, [
      createdEvent(),
      makeEvent({
        sequence: 2,
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "thread.resolved",
        payload: {},
      }),
    ]);
    expect(resolved.resolutionState).toBe("resolved");

    const reopened = projectThreadEvents(resolved, [
      makeEvent({
        sequence: 3,
        occurredAt: "2026-01-01T00:00:02.000Z",
        type: "thread.reopened",
        payload: {},
      }),
    ]);
    expect(reopened.resolutionState).toBe("open");
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
        payload: { turnId: "turn_1", messageId: "assistant_1" },
      }),
    ]);

    expect(seed.messages[1]?.content).toBe("Part 1");
    expect(thread.messages[1]).toMatchObject({
      content: "Part 1 + Part 2",
      status: "complete",
    });
  });
});

describe("toThreadSummary", () => {
  it("returns the list-view fields from a projected thread", () => {
    const summary = toThreadSummary({
      ...runningSeed,
      resolutionState: "resolved",
      runtimeState: "failed",
      latestSequence: 9,
      latestActivityAt: "2026-01-01T00:00:09.000Z",
      updatedAt: "2026-01-01T00:00:09.000Z",
    });

    expect(summary).toEqual({
      threadId: "thread_1",
      workspaceId: "workspace_1",
      providerKey: "fake",
      title: "Chat",
      resolutionState: "resolved",
      runtimeState: "failed",
      latestSequence: 9,
      latestActivityAt: "2026-01-01T00:00:09.000Z",
      updatedAt: "2026-01-01T00:00:09.000Z",
    });
  });
});
