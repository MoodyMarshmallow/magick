// Exercises the orchestrator across create, send, replay, retry, and interrupt flows.

import { Cause, Effect, Exit, Layer, Option, Stream } from "effect";
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
import type {
  ProviderAdapter,
  ProviderRegistryService,
  ProviderSessionHandle,
} from "../providers/providerTypes";
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

const createProviderContext = (adapter: ProviderAdapter) => {
  const database = createDatabase();

  const baseLayer = Layer.mergeAll(
    ClockLive,
    IdGeneratorLive,
    RuntimeStateLive,
    makeEventStoreLayer(database),
    makeThreadRepositoryLayer(database),
    makeProviderSessionRepositoryLayer(database),
    makeProviderRegistryLayer([adapter]),
    Layer.succeed(EventPublisher, {
      publish: () => Effect.void,
    }),
  );

  const appLayer = Layer.mergeAll(
    ReplayServiceLive,
    ThreadOrchestratorLive,
  ).pipe(Layer.provide(baseLayer));

  return {
    runtime: ManagedRuntime.make(Layer.mergeAll(baseLayer, appLayer)),
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

  it("retries the last user message and fails when retry is impossible", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { runtime } = createTestContext(adapter);
    const orchestrator = await runtime.runPromise(ThreadOrchestrator);

    const thread = await runWithRuntime(
      runtime,
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    const exit = await runtime.runPromiseExit(
      orchestrator.retryTurn(thread.threadId),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        code: "retry_not_possible",
      });
    }

    await runWithRuntime(
      runtime,
      orchestrator.sendMessage(thread.threadId, "Retry me"),
    );
    const retried = await runWithRuntime(
      runtime,
      orchestrator.retryTurn(thread.threadId),
    );

    expect(
      retried.messages.filter((message) => message.role === "user"),
    ).toHaveLength(2);
  });

  it("lists, opens, and ensures sessions for created threads", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { runtime } = createTestContext(adapter);
    const orchestrator = await runtime.runPromise(ThreadOrchestrator);

    const thread = await runWithRuntime(
      runtime,
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
        title: "Opened chat",
      }),
    );

    const summaries = await runWithRuntime(
      runtime,
      orchestrator.listThreads("workspace_1"),
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.threadId).toBe(thread.threadId);

    const opened = await runWithRuntime(
      runtime,
      orchestrator.openThread(thread.threadId),
    );
    expect(opened.title).toBe("Opened chat");

    const ensured = await runWithRuntime(
      runtime,
      orchestrator.ensureSession(thread.threadId),
    );
    expect(ensured.threadId).toBe(thread.threadId);
  });

  it("returns the current thread when stopTurn is called without an active turn", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { runtime } = createTestContext(adapter);
    const orchestrator = await runtime.runPromise(ThreadOrchestrator);

    const thread = await runWithRuntime(
      runtime,
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    const stopped = await runWithRuntime(
      runtime,
      orchestrator.stopTurn(thread.threadId),
    );
    expect(stopped.threadId).toBe(thread.threadId);
    expect(stopped.status).toBe("idle");
  });

  it("handles provider failure and session state events from a custom provider", async () => {
    const adapter: ProviderAdapter = {
      key: "custom",
      listCapabilities: () => ({
        supportsNativeResume: false,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: false,
        supportsApprovals: false,
        supportsServerSideSessions: false,
      }),
      getResumeStrategy: () => "rebuild",
      createSession: ({ sessionId }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: ({
            turnId,
          }: { readonly turnId: string; readonly messageId: string }) =>
            Effect.succeed(
              Stream.fromIterable([
                {
                  type: "session.disconnected" as const,
                  reason: "offline",
                },
                {
                  type: "session.recovered" as const,
                  reason: "back",
                },
                {
                  type: "turn.failed" as const,
                  turnId,
                  error: "boom",
                },
              ]),
            ),
          interruptTurn: () => Effect.void,
          dispose: () => Effect.void,
        } as unknown as ProviderSessionHandle),
      resumeSession: ({ sessionId }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: () => Effect.die("unused"),
          interruptTurn: () => Effect.void,
          dispose: () => Effect.void,
        } as unknown as ProviderSessionHandle),
    };

    const { runtime } = createProviderContext(adapter);
    const orchestrator = await runtime.runPromise(ThreadOrchestrator);
    const thread = await runWithRuntime(
      runtime,
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    const result = await runWithRuntime(
      runtime,
      orchestrator.sendMessage(thread.threadId, "Hello"),
    );

    expect(result.status).toBe("failed");
    expect(result.lastError).toBe("boom");
  });
});
