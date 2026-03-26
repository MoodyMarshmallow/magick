// Exercises the orchestrator across create, send, replay, retry, and interrupt flows.

import { Cause, Effect, Exit, Option, Stream } from "effect";

import {
  createClock,
  createIdGenerator,
  createRuntimeState,
} from "../core/runtime";
import { createDatabase } from "../persistence/database";
import { EventStore } from "../persistence/eventStore";
import { ProviderSessionRepository } from "../persistence/providerSessionRepository";
import { ThreadRepository } from "../persistence/threadRepository";
import { FakeProviderAdapter } from "../providers/fake/fakeProviderAdapter";
import type {
  ProviderAdapter,
  ProviderSessionHandle,
} from "../providers/providerTypes";
import { ProviderRegistry } from "./providerRegistry";
import { ReplayService } from "./replayService";
import { ThreadOrchestrator } from "./threadOrchestrator";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const createTestContext = (adapter: FakeProviderAdapter) => {
  const database = createDatabase();
  const publishedEvents: string[] = [];
  const threadRepository = new ThreadRepository(database);

  return {
    orchestrator: new ThreadOrchestrator({
      providerRegistry: new ProviderRegistry([adapter]),
      eventStore: new EventStore(database),
      threadRepository,
      providerSessionRepository: new ProviderSessionRepository(database),
      publisher: {
        publish: async (events) => {
          publishedEvents.push(...events.map((event) => event.type));
        },
      },
      runtimeState: createRuntimeState(),
      clock: createClock(),
      idGenerator: createIdGenerator(),
    }),
    replayService: new ReplayService({
      eventStore: new EventStore(database),
      threadRepository,
    }),
    providerSessionRepository: new ProviderSessionRepository(database),
    publishedEvents,
  };
};

const createProviderContext = (adapter: ProviderAdapter) => {
  const database = createDatabase();
  const threadRepository = new ThreadRepository(database);

  return {
    orchestrator: new ThreadOrchestrator({
      providerRegistry: new ProviderRegistry([adapter]),
      eventStore: new EventStore(database),
      threadRepository,
      providerSessionRepository: new ProviderSessionRepository(database),
      publisher: {
        publish: async () => undefined,
      },
      runtimeState: createRuntimeState(),
      clock: createClock(),
      idGenerator: createIdGenerator(),
    }),
  };
};

describe("ThreadOrchestrator", () => {
  it("creates a thread and streams a reply through the provider adapter", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      chunkDelayMs: 0,
    });
    const { orchestrator, publishedEvents } = createTestContext(adapter);

    const thread = await run(
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
        title: "Primary chat",
      }),
    );
    const updatedThread = await run(
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
    const { orchestrator, providerSessionRepository } =
      createTestContext(adapter);

    const thread = await run(
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    await run(orchestrator.sendMessage(thread.threadId, "First"));
    await run(orchestrator.sendMessage(thread.threadId, "Second"));

    const session = providerSessionRepository.get(thread.providerSessionId);
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
    const { orchestrator } = createTestContext(adapter);

    const thread = await run(
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    const sendFiber = Effect.runFork(
      orchestrator.sendMessage(thread.threadId, "Interrupt me"),
    );
    await Effect.runPromise(Effect.sleep("1 millis"));
    const interruptedThread = await run(orchestrator.stopTurn(thread.threadId));
    const finalThread = await Effect.runPromise(Effect.fromFiber(sendFiber));

    expect(interruptedThread.status).toBe("interrupted");
    expect(finalThread.status).toBe("interrupted");
  });

  it("replays events after a sequence checkpoint", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { orchestrator, replayService } = createTestContext(adapter);

    const thread = await run(
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );
    await run(orchestrator.sendMessage(thread.threadId, "Replay this"));

    const replayedEvents = replayService.replayThread(thread.threadId, 2);
    expect(replayedEvents.length).toBeGreaterThan(0);
    expect(replayedEvents[0]?.sequence).toBeGreaterThan(2);
  });

  it("retries the last user message and fails when retry is impossible", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { orchestrator } = createTestContext(adapter);

    const thread = await run(
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    const exit = await Effect.runPromiseExit(
      orchestrator.retryTurn(thread.threadId),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        code: "retry_not_possible",
      });
    }

    await run(orchestrator.sendMessage(thread.threadId, "Retry me"));
    const retried = await run(orchestrator.retryTurn(thread.threadId));

    expect(
      retried.messages.filter((message) => message.role === "user"),
    ).toHaveLength(2);
  });

  it("lists, opens, and ensures sessions for created threads", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { orchestrator } = createTestContext(adapter);

    const thread = await run(
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
        title: "Opened chat",
      }),
    );

    const summaries = await run(orchestrator.listThreads("workspace_1"));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.threadId).toBe(thread.threadId);

    const opened = await run(orchestrator.openThread(thread.threadId));
    expect(opened.title).toBe("Opened chat");

    const ensured = await run(orchestrator.ensureSession(thread.threadId));
    expect(ensured.threadId).toBe(thread.threadId);
  });

  it("returns the current thread when stopTurn is called without an active turn", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { orchestrator } = createTestContext(adapter);

    const thread = await run(
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    const stopped = await run(orchestrator.stopTurn(thread.threadId));
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

    const { orchestrator } = createProviderContext(adapter);
    const thread = await run(
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    const result = await run(
      orchestrator.sendMessage(thread.threadId, "Hello"),
    );

    expect(result.status).toBe("failed");
    expect(result.lastError).toBe("boom");
  });
});
