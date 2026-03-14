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
      }),
    );
    const events = await Effect.runPromise(Stream.runCollect(stream));

    expect(Array.from(events).map((event) => event.type)).toContain(
      "output.completed",
    );
  });
});
