import { Cause, Effect, Exit, Option, Stream } from "effect";

import { FakeProviderAdapter } from "../providers/fake/fakeProviderAdapter";
import { ProviderFailureError } from "../runtime/errors";
import { createThreadServicesContext, run } from "./threadTestSupport";

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
          submitToolResult: () => Effect.succeed(Stream.empty),
          dispose: () => Effect.void,
        }),
      resumeSession: ({ sessionId }: { readonly sessionId: string }) =>
        Effect.succeed({
          sessionId,
          providerSessionRef: null,
          providerThreadRef: null,
          startTurn: () => Effect.succeed(Stream.empty),
          interruptTurn: () => Effect.void,
          submitToolResult: () => Effect.succeed(Stream.empty),
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
});
