import { Cause, Effect, Exit, Option } from "effect";

import { maxThreadTitleLength } from "@magick/shared/threadTitle";
import { InvalidStateError } from "../../runtime/errors";
import {
  createThreadServicesContext,
  run,
} from "../test-support/threadTestSupport";

describe("ThreadCrudService", () => {
  it("normalizes thread titles and rejects invalid ones", () => {
    const { crudService } = createThreadServicesContext();

    expect(crudService.normalizeThreadTitle("  Hello  ")).toBe("Hello");
    expect(crudService.normalizeThreadTitle("   ", "New chat")).toBe(
      "New chat",
    );
    expect(() => crudService.normalizeThreadTitle("   ")).toThrow(
      InvalidStateError,
    );
    expect(() =>
      crudService.normalizeThreadTitle("x".repeat(maxThreadTitleLength + 1)),
    ).toThrow(InvalidStateError);
  });

  it("creates, renames, resolves, reopens, ensures sessions, and lists threads", async () => {
    const { crudService, providerSessionRepository, runtimeState } =
      createThreadServicesContext();

    const created = await run(
      crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: "fake",
      }),
    );
    expect(created.title).toBe("New chat");
    expect(providerSessionRepository.get("session_1")).not.toBeNull();

    const renamed = await run(
      crudService.renameThreadEffect(created.threadId, "Renamed thread"),
    );
    expect(renamed.title).toBe("Renamed thread");

    const unchanged = await run(
      crudService.renameThreadEffect(created.threadId, "Renamed thread"),
    );
    expect(unchanged.title).toBe("Renamed thread");

    const resolved = await run(
      crudService.setThreadResolutionStateEffect(created.threadId, "resolved"),
    );
    expect(resolved.resolutionState).toBe("resolved");
    const reopened = await run(
      crudService.setThreadResolutionStateEffect(created.threadId, "open"),
    );
    expect(reopened.resolutionState).toBe("open");

    runtimeState.clearSessionRuntime("session_1");
    const ensured = await run(
      crudService.ensureSessionEffect(created.threadId),
    );
    expect(ensured.threadId).toBe(created.threadId);
    expect(runtimeState.getSessionRuntime("session_1")).toBeDefined();

    await expect(crudService.listThreads("workspace_1")).resolves.toEqual([
      expect.objectContaining({
        threadId: created.threadId,
        title: "Renamed thread",
      }),
    ]);
  });

  it("deletes threads, clears cached runtime, and blocks deletion while a turn is active", async () => {
    const {
      crudService,
      runtimeState,
      providerSessionRepository,
      threadRepository,
    } = createThreadServicesContext();
    const thread = await run(
      crudService.createThreadEffect({
        workspaceId: "workspace_1",
        providerKey: "fake",
        title: "Disposable",
      }),
    );

    runtimeState.setActiveTurn(thread.threadId, {
      turnId: "turn_1",
      sessionId: "session_1",
    });
    const blockedDelete = await Effect.runPromiseExit(
      crudService.deleteThreadEffect(thread.threadId),
    );
    expect(Exit.isFailure(blockedDelete)).toBe(true);
    if (Exit.isFailure(blockedDelete)) {
      const failure = Cause.failureOption(blockedDelete.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        code: "thread_delete_while_running",
      });
    }

    runtimeState.clearActiveTurn(thread.threadId);
    const dispose = vi.fn().mockReturnValue(Effect.void);
    runtimeState.setSessionRuntime("session_1", {
      recordId: "session_1",
      adapter: {} as never,
      session: {
        sessionId: "session_1",
        providerSessionRef: null,
        providerThreadRef: null,
        startTurn: vi.fn(),
        interruptTurn: vi.fn(),
        submitToolResults: vi.fn(),
        dispose,
      } as never,
    });

    await expect(
      run(crudService.deleteThreadEffect(thread.threadId)),
    ).resolves.toEqual({
      threadId: thread.threadId,
      workspaceId: "workspace_1",
    });
    expect(dispose).toHaveBeenCalled();
    expect(runtimeState.getSessionRuntime("session_1")).toBeUndefined();
    expect(providerSessionRepository.get("session_1")).toBeNull();
    expect(threadRepository.get(thread.threadId)).toBeNull();
  });
});
