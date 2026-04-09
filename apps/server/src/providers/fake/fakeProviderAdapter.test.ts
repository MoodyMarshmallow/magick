// Verifies the fake provider capabilities and streaming behavior.

import { Effect, Stream } from "effect";

import { FakeProviderAdapter } from "./fakeProviderAdapter";

describe("FakeProviderAdapter", () => {
  it("reports capabilities based on mode", () => {
    expect(
      new FakeProviderAdapter({ mode: "stateful" }).listCapabilities()
        .supportsNativeResume,
    ).toBe(true);
    expect(
      new FakeProviderAdapter({ mode: "stateless" }).listCapabilities()
        .supportsNativeResume,
    ).toBe(false);
  });

  it("creates sessions and streams provider events", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      chunkDelayMs: 0,
    });
    const session = await Effect.runPromise(
      adapter.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );
    const stream = await Effect.runPromise(
      session.startTurn({
        threadId: "thread_1",
        turnId: "turn_1",
        messageId: "message_1",
        userMessage: "Hello",
        contextMessages: [],
        historyItems: [],
        tools: [],
      }),
    );
    const events = await Effect.runPromise(Stream.runCollect(stream));

    expect(Array.from(events).map((event) => event.type)).toContain(
      "output.completed",
    );
  });

  it("generates thread titles through the provider adapter", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      titleGenerator: (firstMessage) => `Title: ${firstMessage}`,
    });

    await expect(
      Effect.runPromise(adapter.generateThreadTitle("Hello")),
    ).resolves.toBe("Title: Hello");
  });

  it("requests a tool and continues once the tool result is submitted", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      responder: () => ({
        toolName: "read",
        input: { path: "notes.md" },
        onResult: (output) => `Result: ${output}`,
      }),
    });
    const session = await Effect.runPromise(
      adapter.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );

    const startStream = await Effect.runPromise(
      session.startTurn({
        threadId: "thread_1",
        turnId: "turn_1",
        messageId: "message_1",
        userMessage: "Hello",
        contextMessages: [],
        historyItems: [],
        tools: [],
      }),
    );
    const startEvents = await Effect.runPromise(Stream.runCollect(startStream));
    expect(Array.from(startEvents)[0]).toMatchObject({
      type: "tool.call.requested",
      toolName: "read",
    });

    const continuation = await Effect.runPromise(
      session.submitToolResult({
        turnId: "turn_1",
        toolCallId: "turn_1:tool:read",
        toolName: "read",
        output: "content",
        historyItems: [],
        tools: [],
      }),
    );
    const continuationEvents = await Effect.runPromise(
      Stream.runCollect(continuation),
    );
    expect(Array.from(continuationEvents).map((event) => event.type)).toContain(
      "output.completed",
    );
  });
});
