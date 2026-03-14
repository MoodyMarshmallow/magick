import { ProviderRegistry } from "../src/application/providerRegistry";
import { ThreadOrchestrator } from "../src/application/threadOrchestrator";
import { createDatabase } from "../src/persistence/database";
import { EventStore } from "../src/persistence/eventStore";
import { ProviderSessionRepository } from "../src/persistence/providerSessionRepository";
import { ThreadRepository } from "../src/persistence/threadRepository";
import { FakeProviderAdapter } from "../src/providers/fake/fakeProviderAdapter";

const createTestOrchestrator = (adapter: FakeProviderAdapter) => {
  const database = createDatabase();
  const eventStore = new EventStore(database);
  const threadRepository = new ThreadRepository(database);
  const providerSessionRepository = new ProviderSessionRepository(database);
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(adapter);

  const publishedEvents: string[] = [];
  const orchestrator = new ThreadOrchestrator({
    providerRegistry,
    eventStore,
    threadRepository,
    providerSessionRepository,
    publisher: {
      publish: async (events) => {
        publishedEvents.push(...events.map((event) => event.type));
      },
    },
  });

  return {
    orchestrator,
    providerSessionRepository,
    publishedEvents,
  };
};

describe("ThreadOrchestrator", () => {
  it("creates a thread and streams a reply through the provider adapter", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      chunkDelayMs: 0,
    });
    const { orchestrator, publishedEvents } = createTestOrchestrator(adapter);

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
      title: "Primary chat",
    });
    const updatedThread = await orchestrator.sendMessage(
      thread.threadId,
      "Hello there",
    );

    expect(updatedThread.status).toBe("idle");
    expect(updatedThread.messages.at(-1)).toMatchObject({
      role: "assistant",
      status: "complete",
    });
    expect(publishedEvents).toContain("turn.completed");
  });

  it("rebuilds stateless provider context from persisted thread history", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateless",
      chunkDelayMs: 0,
      responder: ({ contextMessages, userMessage }) =>
        `context:${contextMessages.map((message) => message.content).join(",")}; latest:${userMessage}`,
    });
    const { orchestrator, providerSessionRepository } =
      createTestOrchestrator(adapter);

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });

    await orchestrator.sendMessage(thread.threadId, "First");
    await orchestrator.sendMessage(thread.threadId, "Second");

    const session = providerSessionRepository.get(thread.providerSessionId);
    expect(session?.capabilities.supportsNativeResume).toBe(false);

    const runtime = adapter.sessions.get(thread.providerSessionId);
    const lastInput = runtime?.observedInputs.at(-1);
    const contextContents = lastInput?.contextMessages.map(
      (message) => message.content,
    );
    expect(contextContents).toContain("First");
    expect(
      contextContents?.some((content) => content.includes("context:")),
    ).toBe(true);
    expect(lastInput?.userMessage).toBe("Second");
  });

  it("interrupts an active turn and records an interrupted state", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      chunkDelayMs: 5,
    });
    const { orchestrator } = createTestOrchestrator(adapter);

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });

    const sendPromise = orchestrator.sendMessage(
      thread.threadId,
      "Interrupt me",
    );
    await new Promise((resolve) => setTimeout(resolve, 1));
    const interruptedThread = await orchestrator.stopTurn(thread.threadId);
    const finalThread = await sendPromise;

    expect(interruptedThread.status).toBe("interrupted");
    expect(finalThread.status).toBe("interrupted");
  });

  it("replays events after a sequence checkpoint", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      chunkDelayMs: 0,
    });
    const { orchestrator } = createTestOrchestrator(adapter);

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });
    await orchestrator.sendMessage(thread.threadId, "Replay this");

    const replayedEvents = await orchestrator.replayThread(thread.threadId, 2);
    expect(replayedEvents.length).toBeGreaterThan(0);
    expect(replayedEvents[0]?.sequence).toBeGreaterThan(2);
  });
});
