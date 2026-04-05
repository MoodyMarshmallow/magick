// Verifies event append and replay ordering semantics.

import { createDatabase } from "./database";
import { EventStore } from "./eventStore";

describe("EventStore", () => {
  it("appends sequenced events and lists them in order", () => {
    const eventStore = new EventStore(createDatabase());

    const events = eventStore.append("thread_1", [
      {
        eventId: "event_1",
        threadId: "thread_1",
        providerSessionId: "session_1",
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
        occurredAt: "2026-01-01T00:00:01.000Z",
        type: "provider.session.started",
        payload: {
          providerKey: "fake",
          resumeStrategy: "native",
        },
      },
    ]);

    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    const replay = eventStore.listThreadEvents("thread_1", 1);
    expect(replay).toHaveLength(1);
    expect(replay[0]?.eventId).toBe("event_2");
  });

  it("returns an empty list for threads with no stored events", () => {
    const eventStore = new EventStore(createDatabase());

    expect(eventStore.listThreadEvents("missing")).toEqual([]);
  });

  it("deletes stored events for a thread", () => {
    const eventStore = new EventStore(createDatabase());

    eventStore.append("thread_1", [
      {
        eventId: "event_1",
        threadId: "thread_1",
        providerSessionId: "session_1",
        occurredAt: "2026-01-01T00:00:00.000Z",
        type: "thread.created",
        payload: {
          workspaceId: "workspace_1",
          providerKey: "fake",
          title: "Chat",
        },
      },
    ]);

    eventStore.deleteThreadEvents("thread_1");

    expect(eventStore.listThreadEvents("thread_1")).toEqual([]);
  });
});
