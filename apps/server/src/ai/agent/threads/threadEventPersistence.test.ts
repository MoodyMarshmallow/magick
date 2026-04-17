import { Effect } from "effect";

import { createThreadServicesContext, run } from "./threadTestSupport";

describe("ThreadEventPersistence", () => {
  it("appends, projects, snapshots, and publishes events while tolerating publisher failure", async () => {
    const publisher = {
      publish: vi.fn().mockRejectedValue(new Error("publish failed")),
    };
    const { crudService, eventPersistence, eventStore, threadRepository } =
      createThreadServicesContext({ publisher });
    const thread = await run(
      crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: "fake",
        title: "Persist me",
      }),
    );

    const projected = await run(
      eventPersistence.persistAndProject(thread.threadId, [
        {
          eventId: "event_user_1",
          threadId: thread.threadId,
          providerSessionId: "session_1",
          occurredAt: "2026-04-17T00:00:00.000Z",
          type: "message.user.created",
          payload: { messageId: "message_1", content: "Hello" },
        },
      ]),
    );

    expect(projected.thread.messages.at(-1)).toMatchObject({
      role: "user",
      content: "Hello",
    });
    expect(
      eventStore.listThreadEvents(thread.threadId).map((event) => event.type),
    ).toEqual([
      "thread.created",
      "provider.session.started",
      "message.user.created",
    ]);
    expect(
      threadRepository.getSnapshot(thread.threadId)?.messages.at(-1),
    ).toMatchObject({
      role: "user",
      content: "Hello",
    });
    expect(publisher.publish).toHaveBeenCalled();
  });

  it("persists tool metadata, tool status transitions, and assistant provider output events", async () => {
    const {
      crudService,
      eventPersistence,
      eventStore,
      providerSessionRepository,
    } = createThreadServicesContext();
    const thread = await run(
      crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: "fake",
        title: "Tool thread",
      }),
    );

    await run(
      eventPersistence.applyToolRequestedEvent(thread.threadId, "session_1", {
        type: "tool.call.requested",
        turnId: "turn_1",
        toolCallId: "tool_1",
        toolName: "fetch",
        input: { path: "notes.md", url: "https://example.com" },
      }),
    );
    await run(
      eventPersistence.persistToolStarted(
        thread.threadId,
        "session_1",
        "turn_1",
        "tool_1",
      ),
    );
    await run(
      eventPersistence.persistToolCompleted(
        thread.threadId,
        "session_1",
        "turn_1",
        "tool_1",
        {
          resultPreview: "preview",
          modelOutput: "full output",
          path: "notes.md",
          url: "https://example.com",
          diff: null,
        },
      ),
    );
    await run(
      eventPersistence.persistToolFailed(
        thread.threadId,
        "session_1",
        "turn_1",
        "tool_2",
        "boom",
        "Tool execution failed: boom",
      ),
    );
    await run(
      (() => {
        const effect = eventPersistence.applyProviderEvent(
          thread.threadId,
          "session_1",
          {
            type: "output.delta",
            turnId: "turn_1",
            messageId: "message_1",
            channel: "final",
            delta: "Hello",
          },
        );
        if (!effect) {
          throw new Error("Expected output.delta to map to a persisted event.");
        }
        return effect;
      })(),
    );
    await run(
      (() => {
        const effect = eventPersistence.applyProviderEvent(
          thread.threadId,
          "session_1",
          {
            type: "output.message.completed",
            turnId: "turn_1",
            messageId: "message_1",
            channel: "final",
          },
        );
        if (!effect) {
          throw new Error(
            "Expected output.message.completed to map to a persisted event.",
          );
        }
        return effect;
      })(),
    );
    await run(
      (() => {
        const effect = eventPersistence.applyProviderEvent(
          thread.threadId,
          "session_1",
          {
            type: "turn.completed",
            turnId: "turn_1",
          },
        );
        if (!effect) {
          throw new Error(
            "Expected turn.completed to map to a persisted event.",
          );
        }
        return effect;
      })(),
    );
    await run(
      (() => {
        const effect = eventPersistence.applyProviderEvent(
          thread.threadId,
          "session_1",
          {
            type: "turn.failed",
            turnId: "turn_2",
            error: "nope",
          },
        );
        if (!effect) {
          throw new Error("Expected turn.failed to map to a persisted event.");
        }
        return effect;
      })(),
    );
    await run(
      (() => {
        const effect = eventPersistence.applyProviderEvent(
          thread.threadId,
          "session_1",
          {
            type: "session.disconnected",
            reason: "offline",
          },
        );
        if (!effect) {
          throw new Error(
            "Expected session.disconnected to map to a persisted event.",
          );
        }
        return effect;
      })(),
    );
    await run(
      (() => {
        const effect = eventPersistence.applyProviderEvent(
          thread.threadId,
          "session_1",
          {
            type: "session.recovered",
            reason: "back",
          },
        );
        if (!effect) {
          throw new Error(
            "Expected session.recovered to map to a persisted event.",
          );
        }
        return effect;
      })(),
    );

    const events = eventStore.listThreadEvents(thread.threadId);
    expect(events.map((event) => event.type)).toContain("tool.requested");
    expect(events.map((event) => event.type)).toContain("tool.started");
    expect(events.map((event) => event.type)).toContain("tool.completed");
    expect(events.map((event) => event.type)).toContain("tool.failed");
    expect(events.map((event) => event.type)).toContain(
      "message.assistant.delta",
    );
    expect(events.map((event) => event.type)).toContain(
      "message.assistant.completed",
    );
    expect(events.map((event) => event.type)).toContain("turn.completed");
    expect(events.map((event) => event.type)).toContain("turn.failed");
    expect(events.map((event) => event.type)).toContain(
      "provider.session.disconnected",
    );
    expect(events.map((event) => event.type)).toContain(
      "provider.session.recovered",
    );

    const toolRequested = events.find(
      (event) => event.type === "tool.requested",
    );
    expect(toolRequested).toMatchObject({
      payload: {
        argsPreview: '{"path":"notes.md","url":"https://example.com"}',
        path: "notes.md",
        url: "https://example.com",
      },
    });

    expect(
      eventPersistence.applyProviderEvent(thread.threadId, "session_1", {
        type: "tool.call.requested",
        turnId: "turn_3",
        toolCallId: "tool_3",
        toolName: "read",
        input: { path: "notes.md" },
      }),
    ).toBeNull();
    expect(providerSessionRepository.get("session_1")?.status).toBe("active");
  });
});
