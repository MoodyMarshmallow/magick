// Verifies the fake provider capabilities and streaming behavior.

import { Effect, Stream } from "effect";

import { FakeProviderAdapter } from "./fakeProviderAdapter";

const assistantInstructions = "Assistant instructions";
const titleInstructions = "Title instructions";

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
        bookmarkId: "bookmark_1",
        turnId: "turn_1",
        messageId: "message_1",
        userMessage: "Hello",
        instructions: assistantInstructions,
        contextMessages: [],
        historyItems: [],
        tools: [],
      }),
    );
    const events = await Effect.runPromise(Stream.runCollect(stream));

    expect(Array.from(events).map((event) => event.type)).toContain(
      "output.message.completed",
    );
    expect(Array.from(events).map((event) => event.type)).toContain(
      "turn.completed",
    );
  });

  it("generates bookmark titles through the provider adapter", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      titleGenerator: (input) => `Title: ${input.firstMessage}`,
    });

    await expect(
      Effect.runPromise(
        adapter.generateBookmarkTitle({
          firstMessage: "Hello",
          instructions: titleInstructions,
        }),
      ),
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
        bookmarkId: "bookmark_1",
        turnId: "turn_1",
        messageId: "message_1",
        userMessage: "Hello",
        instructions: assistantInstructions,
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
      session.submitToolResults({
        turnId: "turn_1",
        toolResults: [
          {
            toolCallId: "turn_1:tool:read",
            toolName: "read",
            output: "content",
          },
        ],
        instructions: assistantInstructions,
        historyItems: [],
        tools: [],
      }),
    );
    const continuationEvents = await Effect.runPromise(
      Stream.runCollect(continuation),
    );
    expect(Array.from(continuationEvents).map((event) => event.type)).toContain(
      "output.message.completed",
    );
    expect(Array.from(continuationEvents).map((event) => event.type)).toContain(
      "turn.completed",
    );
  });

  it("keeps commentary segments distinct across tool-result continuations", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      responder: () => [
        { channel: "commentary", content: "Inspecting notes." },
        {
          toolName: "read",
          input: { path: "notes.md" },
          onResult: () => [
            { channel: "commentary", content: "Cross-checking summary." },
            { channel: "final", content: "Final answer." },
          ],
        },
      ],
    });
    const session = await Effect.runPromise(
      adapter.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );

    const firstStream = await Effect.runPromise(
      session.startTurn({
        bookmarkId: "bookmark_1",
        turnId: "turn_1",
        messageId: "message_1",
        userMessage: "Hello",
        instructions: assistantInstructions,
        contextMessages: [],
        historyItems: [],
        tools: [],
      }),
    );
    const firstEvents = Array.from(
      await Effect.runPromise(Stream.runCollect(firstStream)),
    );

    expect(firstEvents).toEqual([
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:0",
        channel: "commentary",
        delta: "Inspecti",
      },
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:0",
        channel: "commentary",
        delta: "ng notes",
      },
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:0",
        channel: "commentary",
        delta: ".",
      },
      {
        type: "output.message.completed",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:0",
        channel: "commentary",
        reason: "tool_calls",
      },
      {
        type: "tool.call.requested",
        turnId: "turn_1",
        toolCallId: "turn_1:tool:read",
        toolName: "read",
        input: { path: "notes.md" },
      },
    ]);

    const continuation = await Effect.runPromise(
      session.submitToolResults({
        turnId: "turn_1",
        toolResults: [
          {
            toolCallId: "turn_1:tool:read",
            toolName: "read",
            output: "content",
          },
        ],
        instructions: assistantInstructions,
        historyItems: [],
        tools: [],
      }),
    );
    const continuationEvents = Array.from(
      await Effect.runPromise(Stream.runCollect(continuation)),
    );

    expect(continuationEvents).toEqual([
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:1",
        channel: "commentary",
        delta: "Cross-ch",
      },
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:1",
        channel: "commentary",
        delta: "ecking s",
      },
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:1",
        channel: "commentary",
        delta: "ummary.",
      },
      {
        type: "output.message.completed",
        turnId: "turn_1",
        messageId: "turn_1:assistant:commentary:1",
        channel: "commentary",
        reason: "stop",
      },
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:final",
        channel: "final",
        delta: "Final an",
      },
      {
        type: "output.delta",
        turnId: "turn_1",
        messageId: "turn_1:assistant:final",
        channel: "final",
        delta: "swer.",
      },
      {
        type: "output.message.completed",
        turnId: "turn_1",
        messageId: "turn_1:assistant:final",
        channel: "final",
        reason: "stop",
      },
      {
        type: "turn.completed",
        turnId: "turn_1",
      },
    ]);
  });
});
