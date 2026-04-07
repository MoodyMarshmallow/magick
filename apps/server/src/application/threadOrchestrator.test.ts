// Exercises the orchestrator across create, send, replay, retry, and interrupt flows.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { PathPresentationPolicy } from "../tools/pathPresentationPolicy";
import { ToolExecutor } from "../tools/toolExecutor";
import { WebContentService } from "../tools/webContentService";
import { WorkspaceAccessService } from "../tools/workspaceAccessService";
import { WorkspacePathPolicy } from "../tools/workspacePathPolicy";
import { ProviderRegistry } from "./providerRegistry";
import { ReplayService } from "./replayService";
import { ThreadOrchestrator } from "./threadOrchestrator";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const createToolServices = (workspaceRoot = process.cwd()) => {
  const workspaceAccess = new WorkspaceAccessService({
    pathPolicy: new WorkspacePathPolicy(workspaceRoot),
    presentationPolicy: new PathPresentationPolicy("workspace-relative"),
  });
  return {
    toolExecutor: new ToolExecutor(),
    workspaceAccess,
    webContent: new WebContentService(),
  };
};

const createTestContext = (
  adapter: FakeProviderAdapter,
  options: { readonly workspaceRoot?: string } = {},
) => {
  const database = createDatabase();
  const publishedEvents: string[] = [];
  const threadRepository = new ThreadRepository(database);
  const toolServices = createToolServices(options.workspaceRoot);

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
      ...toolServices,
    }),
    replayService: new ReplayService({
      eventStore: new EventStore(database),
      threadRepository,
    }),
    providerSessionRepository: new ProviderSessionRepository(database),
    publishedEvents,
  };
};

const createProviderContext = (
  adapter: ProviderAdapter,
  options: { readonly workspaceRoot?: string } = {},
) => {
  const database = createDatabase();
  const threadRepository = new ThreadRepository(database);
  const toolServices = createToolServices(options.workspaceRoot);

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
      ...toolServices,
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

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
      title: "Primary chat",
    });
    const updatedThread = await run(
      orchestrator.sendMessage(thread.threadId, "Hello there"),
    );

    expect(updatedThread.runtimeState).toBe("idle");
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

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });

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

  it("rebuilds prior tool calls and tool results into the next user turn history", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magick-tool-history-"));
    writeFileSync(join(workspaceRoot, "notes.md"), "hello\nworld\n", "utf8");
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      responder: ({ userMessage }) =>
        userMessage === "First"
          ? {
              toolName: "read",
              input: { path: "notes.md" },
              onResult: (output) => `Tool saw: ${output}`,
            }
          : "Second reply",
    });
    const { orchestrator } = createTestContext(adapter, { workspaceRoot });

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });

    await run(orchestrator.sendMessage(thread.threadId, "First"));
    await run(orchestrator.sendMessage(thread.threadId, "Second"));

    const sessionRuntime = adapter.sessions.get(thread.providerSessionId);
    expect(sessionRuntime?.observedInputs.at(-1)?.historyItems).toEqual([
      {
        type: "message",
        role: "user",
        content: "First",
      },
      {
        type: "tool_call",
        toolCallId: expect.any(String),
        toolName: "read",
        input: { path: "notes.md" },
      },
      {
        type: "tool_result",
        toolCallId: expect.any(String),
        output: "hello\nworld\n",
      },
      {
        type: "message",
        role: "assistant",
        content: "Tool saw: helloworld",
      },
    ]);
  });

  it("interrupts an active turn and records an interrupted state", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      chunkDelayMs: 5,
    });
    const { orchestrator } = createTestContext(adapter);

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });

    const sendFiber = Effect.runFork(
      orchestrator.sendMessage(thread.threadId, "Interrupt me"),
    );
    await Effect.runPromise(Effect.sleep("1 millis"));
    const interruptedThread = await run(orchestrator.stopTurn(thread.threadId));
    const finalThread = await Effect.runPromise(Effect.fromFiber(sendFiber));

    expect(interruptedThread.runtimeState).toBe("interrupted");
    expect(finalThread.runtimeState).toBe("interrupted");
  });

  it("replays events after a sequence checkpoint", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { orchestrator, replayService } = createTestContext(adapter);

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });
    await run(orchestrator.sendMessage(thread.threadId, "Replay this"));

    const replayedEvents = replayService.replayThread(thread.threadId, 2);
    expect(replayedEvents.length).toBeGreaterThan(0);
    expect(replayedEvents[0]?.sequence).toBeGreaterThan(2);
  });

  it("retries the last user message and fails when retry is impossible", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { orchestrator } = createTestContext(adapter);

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });

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

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
      title: "Opened chat",
    });

    const summaries = await orchestrator.listThreads("workspace_1");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.threadId).toBe(thread.threadId);

    const opened = await orchestrator.openThread(thread.threadId);
    expect(opened.title).toBe("Opened chat");

    const ensured = await orchestrator.ensureSession(thread.threadId);
    expect(ensured.threadId).toBe(thread.threadId);
  });

  it("returns the current thread when stopTurn is called without an active turn", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { orchestrator } = createTestContext(adapter);

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });

    const stopped = await run(orchestrator.stopTurn(thread.threadId));
    expect(stopped.threadId).toBe(thread.threadId);
    expect(stopped.runtimeState).toBe("idle");
  });

  it("renames and deletes threads", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const { orchestrator, providerSessionRepository, publishedEvents } =
      createTestContext(adapter);

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
      title: "Original chat",
    });

    const renamed = await orchestrator.renameThread(
      thread.threadId,
      "Renamed chat",
    );

    expect(renamed.title).toBe("Renamed chat");
    expect(publishedEvents).toContain("thread.renamed");

    await orchestrator.deleteThread(thread.threadId);

    await expect(
      orchestrator.openThread(thread.threadId),
    ).rejects.toMatchObject({
      entity: "thread",
      id: thread.threadId,
    });
    expect(providerSessionRepository.get(thread.providerSessionId)).toBeNull();
    await expect(orchestrator.listThreads("workspace_1")).resolves.toEqual([]);
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
          submitToolResult: () => Effect.succeed(Stream.empty),
          interruptTurn: () => Effect.void,
          dispose: () => Effect.void,
        } as unknown as ProviderSessionHandle),
      resumeSession: ({ sessionId }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: () => Effect.die("unused"),
          submitToolResult: () => Effect.succeed(Stream.empty),
          interruptTurn: () => Effect.void,
          dispose: () => Effect.void,
        } as unknown as ProviderSessionHandle),
    };

    const { orchestrator } = createProviderContext(adapter);
    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });

    const result = await run(
      orchestrator.sendMessage(thread.threadId, "Hello"),
    );

    expect(result.runtimeState).toBe("failed");
    expect(result.lastError).toBe("boom");
  });

  it("executes a tool call and persists tool activity plus diff preview", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magick-tools-"));
    writeFileSync(join(workspaceRoot, "notes.md"), "hello\nworld\n", "utf8");
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      responder: () => ({
        toolName: "apply_patch",
        input: {
          path: "notes.md",
          patches: [{ find: "world", replace: "magick" }],
        },
        onResult: (output) => `Tool finished.\n${output}`,
      }),
    });
    const { orchestrator } = createTestContext(adapter, { workspaceRoot });

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });

    const updatedThread = await run(
      orchestrator.sendMessage(thread.threadId, "Patch the note"),
    );

    expect(updatedThread.toolActivities).toHaveLength(1);
    expect(updatedThread.toolActivities[0]).toMatchObject({
      toolName: "apply_patch",
      status: "completed",
      path: "notes.md",
    });
    expect(updatedThread.toolActivities[0]?.diff?.hunks[0]?.lines).toContain(
      "-world",
    );
    expect(updatedThread.messages.at(-1)?.content).toContain("Tool finished");
  });

  it("marks tool activity as failed when tool execution errors", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magick-tools-"));
    writeFileSync(join(workspaceRoot, "notes.md"), "hello\nworld\n", "utf8");
    const adapter = new FakeProviderAdapter({
      key: "fake-tools-regression",
      mode: "stateful",
      responder: () => ({
        toolName: "read",
        input: { path: "missing.md" },
        onResult: () => "done",
      }),
    });
    const { orchestrator } = createTestContext(adapter, { workspaceRoot });

    const thread = await orchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: adapter.key,
    });

    const updatedThread = await run(
      orchestrator.sendMessage(thread.threadId, "Read a missing file"),
    );

    expect(updatedThread.runtimeState).toBe("idle");
    expect(updatedThread.toolActivities[0]).toMatchObject({
      toolName: "read",
      status: "failed",
      error: expect.stringContaining("missing.md"),
    });
    expect(updatedThread.toolActivities[0]?.error).not.toContain(workspaceRoot);
  });
});
