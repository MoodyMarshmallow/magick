import { Cause, Effect, Exit, Option, Stream } from "effect";

import { FakeProviderAdapter } from "../../providers/fake/fakeProviderAdapter";
import { ProviderFailureError } from "../../runtime/errors";
import {
  createThreadServicesContext,
  run,
} from "../test-support/threadTestSupport";

describe("ThreadTurnRunner", () => {
  it("sends a message through the provider runtime and completes the turn", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      chunkDelayMs: 0,
    });
    const { crudService, turnRunner, publishedEvents } =
      createThreadServicesContext({
        adapters: [adapter],
      });
    const thread = await run(
      crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
        title: "Chat",
      }),
    );

    const updated = await run(
      turnRunner.sendMessage(thread.threadId, "Hello there"),
    );

    expect(updated.runtimeState).toBe("idle");
    expect(updated.messages.at(-1)).toMatchObject({
      role: "assistant",
      status: "complete",
    });
    expect(publishedEvents).toContain("turn.completed");
  });

  it("executes tool continuations and records failed tool activity without leaking workspace paths", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "magick-turn-runner-"),
    );
    fs.writeFileSync(
      path.join(workspaceRoot, "notes.md"),
      "hello\nworld\n",
      "utf8",
    );
    const successAdapter = new FakeProviderAdapter({
      key: "fake-tools-success",
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
    const successContext = createThreadServicesContext({
      adapters: [successAdapter],
      workspaceRoot,
    });
    const successThread = await run(
      successContext.crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: successAdapter.key,
      }),
    );

    const completed = await run(
      successContext.turnRunner.sendMessage(
        successThread.threadId,
        "Patch the note",
      ),
    );
    expect(completed.toolActivities[0]).toMatchObject({
      toolName: "apply_patch",
      status: "completed",
      path: "notes.md",
    });
    expect(completed.messages.at(-1)?.content).toContain("Tool finished");

    const failingAdapter = new FakeProviderAdapter({
      key: "fake-tools-failure",
      mode: "stateful",
      responder: () => ({
        toolName: "read",
        input: { path: "missing.md" },
        onResult: () => "done",
      }),
    });
    const failingContext = createThreadServicesContext({
      adapters: [failingAdapter],
      workspaceRoot,
    });
    const failingThread = await run(
      failingContext.crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: failingAdapter.key,
      }),
    );

    const failed = await run(
      failingContext.turnRunner.sendMessage(
        failingThread.threadId,
        "Read missing",
      ),
    );
    expect(failed.toolActivities[0]).toMatchObject({
      toolName: "read",
      status: "failed",
      error: expect.stringContaining("missing.md"),
    });
    expect(failed.toolActivities[0]?.error).not.toContain(workspaceRoot);
  });

  it("waits for all sibling tool calls in a response step before submitting batched tool results", async () => {
    type BatchedToolResults = {
      toolResults: readonly {
        toolCallId: string;
        toolName: string;
        output: string;
      }[];
      historyItems: readonly {
        type: string;
        toolCallId?: string;
        output?: string;
      }[];
    };

    let batchedToolResults: BatchedToolResults | null = null;

    const provider = {
      key: "parallel-tools-provider",
      listCapabilities: () => ({
        supportsNativeResume: false,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: true,
        supportsApprovals: false,
        supportsServerSideSessions: false,
      }),
      getResumeStrategy: () => "rebuild" as const,
      generateThreadTitle: () => Effect.succeed(null),
      createSession: ({ sessionId }: { readonly sessionId: string }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: () =>
            Effect.succeed(
              Stream.fromIterable([
                {
                  type: "output.delta" as const,
                  turnId: "turn_1",
                  messageId: "turn_1:assistant:commentary:0",
                  channel: "commentary" as const,
                  delta: "Planning.",
                },
                {
                  type: "output.message.completed" as const,
                  turnId: "turn_1",
                  messageId: "turn_1:assistant:commentary:0",
                  channel: "commentary" as const,
                  reason: "tool_calls" as const,
                },
                {
                  type: "tool.call.requested" as const,
                  turnId: "turn_1",
                  toolCallId: "call_1",
                  toolName: "read",
                  input: { path: "notes.md" },
                },
                {
                  type: "tool.call.requested" as const,
                  turnId: "turn_1",
                  toolCallId: "call_2",
                  toolName: "grep",
                  input: { pattern: "hello" },
                },
              ]),
            ),
          interruptTurn: () => Effect.void,
          submitToolResults: (input: {
            readonly toolResults: readonly {
              toolCallId: string;
              toolName: string;
              output: string;
            }[];
            readonly historyItems: readonly {
              type: string;
              toolCallId?: string;
              output?: string;
            }[];
          }) => {
            batchedToolResults = {
              toolResults: input.toolResults,
              historyItems: input.historyItems,
            };
            return Effect.succeed(
              Stream.fromIterable([
                {
                  type: "output.delta" as const,
                  turnId: "turn_1",
                  messageId: "turn_1:assistant:final",
                  channel: "final" as const,
                  delta: "Done.",
                },
                {
                  type: "output.message.completed" as const,
                  turnId: "turn_1",
                  messageId: "turn_1:assistant:final",
                  channel: "final" as const,
                  reason: "stop" as const,
                },
                {
                  type: "turn.completed" as const,
                  turnId: "turn_1",
                },
              ]),
            );
          },
          dispose: () => Effect.void,
        }),
      resumeSession: ({ sessionId }: { readonly sessionId: string }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: () => Effect.succeed(Stream.empty),
          interruptTurn: () => Effect.void,
          submitToolResults: () => Effect.succeed(Stream.empty),
          dispose: () => Effect.void,
        }),
    };

    const context = createThreadServicesContext({ adapters: [provider] });
    vi.spyOn(context.toolExecutor, "execute").mockImplementation(
      async ({ toolName }) => {
        return {
          title: `${toolName} result`,
          resultPreview: `${toolName} preview`,
          modelOutput: `${toolName} output`,
          path: null,
          url: null,
          diff: null,
        };
      },
    );

    const thread = await run(
      context.crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: provider.key,
      }),
    );

    const result = await run(
      context.turnRunner.sendMessage(thread.threadId, "Do both tools"),
    );
    const submittedToolBatch = (() => {
      if (!batchedToolResults) {
        throw new Error("Expected batched tool results to be submitted.");
      }

      return batchedToolResults as BatchedToolResults;
    })();

    expect(result.runtimeState).toBe("idle");
    expect(submittedToolBatch.toolResults).toEqual([
      { toolCallId: "call_1", toolName: "read", output: "read output" },
      { toolCallId: "call_2", toolName: "grep", output: "grep output" },
    ]);
    expect(
      submittedToolBatch.historyItems.filter(
        (item) => item.type === "tool_call",
      ),
    ).toEqual([
      expect.objectContaining({ toolCallId: "call_1" }),
      expect.objectContaining({ toolCallId: "call_2" }),
    ]);
    expect(
      submittedToolBatch.historyItems.filter(
        (item) => item.type === "tool_result",
      ),
    ).toEqual([
      expect.objectContaining({ toolCallId: "call_1", output: "read output" }),
      expect.objectContaining({ toolCallId: "call_2", output: "grep output" }),
    ]);
  });

  it("blocks concurrent turns, interrupts active turns, retries the last user message, and records provider stream failures", async () => {
    const adapter = new FakeProviderAdapter({
      mode: "stateful",
      chunkDelayMs: 5,
    });
    const context = createThreadServicesContext({ adapters: [adapter] });
    const thread = await run(
      context.crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    context.runtimeState.setActiveTurn(thread.threadId, {
      turnId: "turn_busy",
      sessionId: "session_1",
    });
    const blockedTurn = await Effect.runPromiseExit(
      context.turnRunner.sendMessage(thread.threadId, "Blocked"),
    );
    expect(Exit.isFailure(blockedTurn)).toBe(true);
    if (Exit.isFailure(blockedTurn)) {
      const failure = Cause.failureOption(blockedTurn.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        code: "turn_already_running",
      });
    }
    context.runtimeState.clearActiveTurn(thread.threadId);

    const sendFiber = Effect.runFork(
      context.turnRunner.sendMessage(thread.threadId, "Interrupt me"),
    );
    await Effect.runPromise(Effect.sleep("1 millis"));
    const interrupted = await run(context.turnRunner.stopTurn(thread.threadId));
    const finalThread = await Effect.runPromise(Effect.fromFiber(sendFiber));
    expect(interrupted.runtimeState).toBe("interrupted");
    expect(finalThread.runtimeState).toBe("interrupted");

    const retryFailureContext = createThreadServicesContext({
      adapters: [adapter],
    });
    const retryFailureThread = await run(
      retryFailureContext.crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );
    const retryFailure = await Effect.runPromiseExit(
      retryFailureContext.turnRunner.retryTurn(retryFailureThread.threadId),
    );
    expect(Exit.isFailure(retryFailure)).toBe(true);
    if (Exit.isFailure(retryFailure)) {
      const failure = Cause.failureOption(retryFailure.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        code: "retry_not_possible",
      });
    }

    await run(context.turnRunner.sendMessage(thread.threadId, "Retry me"));
    const retried = await run(context.turnRunner.retryTurn(thread.threadId));
    expect(
      retried.messages.filter((message) => message.role === "user"),
    ).toHaveLength(3);

    const failingProvider = {
      key: "failing",
      listCapabilities: () => ({
        supportsNativeResume: false,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: false,
        supportsApprovals: false,
        supportsServerSideSessions: false,
      }),
      getResumeStrategy: () => "rebuild" as const,
      generateThreadTitle: () => Effect.succeed(null),
      createSession: ({ sessionId }: { readonly sessionId: string }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: () =>
            Effect.succeed(
              Stream.fail(
                new ProviderFailureError({
                  providerKey: "failing",
                  code: "stream_failed",
                  detail: "provider stream exploded",
                  retryable: false,
                }),
              ),
            ),
          interruptTurn: () => Effect.void,
          submitToolResults: () => Effect.succeed(Stream.empty),
          dispose: () => Effect.void,
        }),
      resumeSession: ({ sessionId }: { readonly sessionId: string }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: () => Effect.succeed(Stream.empty),
          interruptTurn: () => Effect.void,
          submitToolResults: () => Effect.succeed(Stream.empty),
          dispose: () => Effect.void,
        }),
    };
    const failingContext = createThreadServicesContext({
      adapters: [failingProvider],
    });
    const failingThread = await run(
      failingContext.crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: failingProvider.key,
      }),
    );
    const failedResult = await run(
      failingContext.turnRunner.sendMessage(failingThread.threadId, "Boom"),
    );
    expect(failedResult.runtimeState).toBe("failed");
    expect(failedResult.lastError).toBe("provider stream exploded");
    expect(
      failingContext.runtimeState.getActiveTurn(failingThread.threadId),
    ).toBeUndefined();
  });

  it("returns the current snapshot when stopTurn is called without an active turn or throws if runtime is missing", async () => {
    const adapter = new FakeProviderAdapter({ mode: "stateful" });
    const context = createThreadServicesContext({ adapters: [adapter] });
    const thread = await run(
      context.crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    const idleThread = await run(context.turnRunner.stopTurn(thread.threadId));
    expect(idleThread.threadId).toBe(thread.threadId);
    expect(idleThread.runtimeState).toBe("idle");

    context.runtimeState.setActiveTurn(thread.threadId, {
      turnId: "turn_1",
      sessionId: "missing_runtime",
    });
    const missingRuntime = await Effect.runPromiseExit(
      context.turnRunner.stopTurn(thread.threadId),
    );
    expect(Exit.isFailure(missingRuntime)).toBe(true);
    if (Exit.isFailure(missingRuntime)) {
      const failure = Cause.failureOption(missingRuntime.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        entity: "provider_session_runtime",
        id: "missing_runtime",
      });
    }
  });

  it("fails the turn instead of continuing when a provider requests a tool after assistant completion reason stop", async () => {
    let toolExecuted = false;
    let submitToolResultCalled = false;
    const provider = {
      key: "stop-reason-protocol-error",
      listCapabilities: () => ({
        supportsNativeResume: false,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: true,
        supportsApprovals: false,
        supportsServerSideSessions: false,
      }),
      getResumeStrategy: () => "rebuild" as const,
      generateThreadTitle: () => Effect.succeed(null),
      createSession: ({ sessionId }: { readonly sessionId: string }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: () =>
            Effect.succeed(
              Stream.fromIterable([
                {
                  type: "output.delta" as const,
                  turnId: "turn_1",
                  messageId: "turn_1:assistant:final",
                  channel: "final" as const,
                  delta: "Done.",
                },
                {
                  type: "output.message.completed" as const,
                  turnId: "turn_1",
                  messageId: "turn_1:assistant:final",
                  channel: "final" as const,
                  reason: "stop" as const,
                },
                {
                  type: "tool.call.requested" as const,
                  turnId: "turn_1",
                  toolCallId: "call_1",
                  toolName: "write_file",
                  input: { path: "notes.md", content: "should not write" },
                },
                {
                  type: "turn.completed" as const,
                  turnId: "turn_1",
                },
              ]),
            ),
          interruptTurn: () => Effect.void,
          submitToolResults: () => {
            submitToolResultCalled = true;
            return Effect.succeed(Stream.empty);
          },
          dispose: () => Effect.void,
        }),
      resumeSession: ({ sessionId }: { readonly sessionId: string }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: () => Effect.succeed(Stream.empty),
          interruptTurn: () => Effect.void,
          submitToolResults: () => Effect.succeed(Stream.empty),
          dispose: () => Effect.void,
        }),
    };

    const context = createThreadServicesContext({ adapters: [provider] });
    const executeSpy = vi
      .spyOn(context.toolExecutor, "execute")
      .mockImplementation(async () => {
        toolExecuted = true;
        return {
          title: "Wrote notes.md",
          resultPreview: "wrote file",
          modelOutput: "wrote file",
          path: "notes.md",
          url: null,
          diff: null,
        };
      });
    const thread = await run(
      context.crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: provider.key,
      }),
    );

    const result = await run(
      context.turnRunner.sendMessage(thread.threadId, "Do the thing"),
    );

    expect(toolExecuted).toBe(false);
    expect(executeSpy).not.toHaveBeenCalled();
    expect(submitToolResultCalled).toBe(false);
    expect(result.runtimeState).toBe("failed");
    expect(result.lastError).toBe(
      "Provider requested tool continuation after assistant completion reason 'stop'.",
    );
  });

  it("does not let unresolved tool activities from older turns keep a later stop-reason turn looping", async () => {
    let submitToolResultCalled = false;
    const provider = {
      key: "turn-scoped-unresolved-tools",
      listCapabilities: () => ({
        supportsNativeResume: false,
        supportsInterrupt: true,
        supportsAttachments: false,
        supportsToolCalls: true,
        supportsApprovals: false,
        supportsServerSideSessions: false,
      }),
      getResumeStrategy: () => "rebuild" as const,
      generateThreadTitle: () => Effect.succeed(null),
      createSession: ({ sessionId }: { readonly sessionId: string }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: () =>
            Effect.succeed(
              Stream.fromIterable([
                {
                  type: "output.delta" as const,
                  turnId: "turn_2",
                  messageId: "turn_2:assistant:final",
                  channel: "final" as const,
                  delta: "Done.",
                },
                {
                  type: "output.message.completed" as const,
                  turnId: "turn_2",
                  messageId: "turn_2:assistant:final",
                  channel: "final" as const,
                  reason: "stop" as const,
                },
                {
                  type: "tool.call.requested" as const,
                  turnId: "turn_2",
                  toolCallId: "call_new",
                  toolName: "read",
                  input: { path: "notes.md" },
                },
              ]),
            ),
          interruptTurn: () => Effect.void,
          submitToolResults: () => {
            submitToolResultCalled = true;
            return Effect.succeed(Stream.empty);
          },
          dispose: () => Effect.void,
        }),
      resumeSession: ({ sessionId }: { readonly sessionId: string }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: () => Effect.succeed(Stream.empty),
          interruptTurn: () => Effect.void,
          submitToolResults: () => Effect.succeed(Stream.empty),
          dispose: () => Effect.void,
        }),
    };

    const context = createThreadServicesContext({ adapters: [provider] });
    const thread = await run(
      context.crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: provider.key,
      }),
    );

    await run(
      context.eventPersistence.persistAndProject(thread.threadId, [
        {
          eventId: context.idGenerator.next("event"),
          threadId: thread.threadId,
          providerSessionId: thread.providerSessionId,
          occurredAt: context.clock.now(),
          type: "tool.requested",
          payload: {
            turnId: "turn_1",
            toolCallId: "call_old",
            toolName: "read",
            title: "Read notes.md",
            argsPreview: '{"path":"notes.md"}',
            path: "notes.md",
            url: null,
          },
        },
        {
          eventId: context.idGenerator.next("event"),
          threadId: thread.threadId,
          providerSessionId: thread.providerSessionId,
          occurredAt: context.clock.now(),
          type: "tool.started",
          payload: {
            turnId: "turn_1",
            toolCallId: "call_old",
          },
        },
      ]),
    );

    const result = await run(
      context.turnRunner.sendMessage(thread.threadId, "Do the new thing"),
    );

    expect(submitToolResultCalled).toBe(false);
    expect(result.runtimeState).toBe("failed");
    expect(result.lastError).toBe(
      "Provider requested tool continuation after assistant completion reason 'stop'.",
    );
  });
});
