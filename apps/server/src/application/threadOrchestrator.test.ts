import { Effect, Layer } from "effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

import {
  ClockLive,
  EventPublisher,
  IdGeneratorLive,
  RuntimeStateLive,
} from "../effect/runtime";
import { createDatabase } from "../persistence/database";
import {
  type EventStoreService,
  makeEventStoreLayer,
} from "../persistence/eventStore";
import {
  ProviderSessionRepository,
  type ProviderSessionRepositoryService,
  makeProviderSessionRepositoryLayer,
} from "../persistence/providerSessionRepository";
import {
  type ThreadRepositoryService,
  makeThreadRepositoryLayer,
} from "../persistence/threadRepository";
import { FakeProviderAdapter } from "../providers/fake/fakeProviderAdapter";
import type { ProviderRegistryService } from "../providers/providerTypes";
import { makeProviderRegistryLayer } from "./providerRegistry";
import {
  ReplayService,
  type ReplayServiceApi,
  ReplayServiceLive,
} from "./replayService";
import {
  ThreadOrchestrator,
  type ThreadOrchestratorApi,
  ThreadOrchestratorLive,
} from "./threadOrchestrator";

type TestRuntime =
  | ProviderRegistryService
  | EventStoreService
  | ThreadRepositoryService
  | ProviderSessionRepositoryService
  | ReplayServiceApi
  | ThreadOrchestratorApi;

const createTestContext = (adapter: FakeProviderAdapter) => {
  const database = createDatabase();
  const publishedEvents: string[] = [];

  const baseLayer = Layer.mergeAll(
    ClockLive,
    IdGeneratorLive,
    RuntimeStateLive,
    makeEventStoreLayer(database),
    makeThreadRepositoryLayer(database),
    makeProviderSessionRepositoryLayer(database),
    makeProviderRegistryLayer([adapter]),
    Layer.succeed(EventPublisher, {
      publish: (events) =>
        Effect.sync(() => {
          publishedEvents.push(...events.map((event) => event.type));
        }),
    }),
  );

  const appLayer = Layer.mergeAll(
    ReplayServiceLive,
    ThreadOrchestratorLive,
  ).pipe(Layer.provide(baseLayer));

  return {
    runtime: ManagedRuntime.make(Layer.mergeAll(baseLayer, appLayer)),
    publishedEvents,
  };
};

const runWithRuntime = <A, E>(
  runtime: ManagedRuntime.ManagedRuntime<TestRuntime, never>,
  effect: Effect.Effect<A, E, TestRuntime>,
) => runtime.runPromise(effect);

describe("ThreadOrchestrator", () => {
  it("creates a thread and streams a reply through the provider adapter", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      chunkDelayMs: 0,
    });
    const { runtime, publishedEvents } = createTestContext(adapter);

    const orchestrator = await runtime.runPromise(ThreadOrchestrator);
    const thread = await runWithRuntime(
      runtime,
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
        title: "Primary chat",
      }),
    );
    const updatedThread = await runWithRuntime(
      runtime,
      orchestrator.sendMessage(thread.threadId, "Hello there"),
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
      responder: ({ contextMessages, userMessage }) =>
        `context:${contextMessages.map((message) => message.content).join(",")}; latest:${userMessage}`,
    });
    const { runtime } = createTestContext(adapter);
    const orchestrator = await runtime.runPromise(ThreadOrchestrator);
    const providerSessionRepository = await runtime.runPromise(
      ProviderSessionRepository,
    );

    const thread = await runWithRuntime(
      runtime,
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    await runWithRuntime(
      runtime,
      orchestrator.sendMessage(thread.threadId, "First"),
    );
    await runWithRuntime(
      runtime,
      orchestrator.sendMessage(thread.threadId, "Second"),
    );

    const session = await runWithRuntime(
      runtime,
      providerSessionRepository.get(thread.providerSessionId),
    );
    expect(session?.capabilities.supportsNativeResume).toBe(false);

    const sessionRuntime = adapter.sessions.get(thread.providerSessionId);
    const lastInput = sessionRuntime?.observedInputs.at(-1);
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
    const { runtime } = createTestContext(adapter);
    const orchestrator = await runtime.runPromise(ThreadOrchestrator);

    const thread = await runWithRuntime(
      runtime,
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    const sendFiber = runtime.runFork(
      orchestrator.sendMessage(thread.threadId, "Interrupt me"),
    );
    await Effect.runPromise(Effect.sleep("1 millis"));
    const interruptedThread = await runWithRuntime(
      runtime,
      orchestrator.stopTurn(thread.threadId),
    );
    const finalThread = await Effect.runPromise(Effect.fromFiber(sendFiber));

    expect(interruptedThread.status).toBe("interrupted");
    expect(finalThread.status).toBe("interrupted");
  });

  it("replays events after a sequence checkpoint", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { runtime } = createTestContext(adapter);
    const orchestrator = await runtime.runPromise(ThreadOrchestrator);
    const replayService = await runtime.runPromise(ReplayService);

    const thread = await runWithRuntime(
      runtime,
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );
    await runWithRuntime(
      runtime,
      orchestrator.sendMessage(thread.threadId, "Replay this"),
    );

    const replayedEvents = await runWithRuntime(
      runtime,
      replayService.replayThread(thread.threadId, 2),
    );
    expect(replayedEvents.length).toBeGreaterThan(0);
    expect(replayedEvents[0]?.sequence).toBeGreaterThan(2);
  });
});
