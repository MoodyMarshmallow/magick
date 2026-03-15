// Verifies event append and replay ordering semantics.

import { Layer } from "effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { createDatabase } from "./database";
import { EventStore, makeEventStoreLayer } from "./eventStore";

describe("EventStore", () => {
  it("appends sequenced events and lists them in order", async () => {
    const runtime = ManagedRuntime.make(makeEventStoreLayer(createDatabase()));
    const eventStore = await runtime.runPromise(EventStore);

    const events = await runtime.runPromise(
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
      ]),
    );

    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
    const replay = await runtime.runPromise(
      eventStore.listThreadEvents("thread_1", 1),
    );
    expect(replay).toHaveLength(1);
    expect(replay[0]?.eventId).toBe("event_2");
  });

  it("returns an empty list for threads with no stored events", async () => {
    const runtime = ManagedRuntime.make(makeEventStoreLayer(createDatabase()));
    const eventStore = await runtime.runPromise(EventStore);

    expect(
      await runtime.runPromise(eventStore.listThreadEvents("missing")),
    ).toEqual([]);
  });
});
