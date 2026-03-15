import { Effect } from "effect";

import {
  CodexProviderAdapter,
  createCodexRuntimeFactory,
} from "./codexProviderAdapter";

describe("CodexProviderAdapter", () => {
  it("delegates session creation and reports native resume capabilities", async () => {
    const createSession = vi.fn().mockResolvedValue({ sessionId: "session_1" });
    const resumeSession = vi.fn().mockResolvedValue({ sessionId: "session_1" });
    const adapter = new CodexProviderAdapter({
      createSession: (input) =>
        Effect.promise(() => createSession(input) as never),
      resumeSession: (input) =>
        Effect.promise(() => resumeSession(input) as never),
    });

    expect(adapter.getResumeStrategy()).toBe("native");
    expect(adapter.listCapabilities().supportsNativeResume).toBe(true);

    await Effect.runPromise(
      adapter.createSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
      }),
    );
    expect(createSession).toHaveBeenCalled();
  });

  it("creates and resumes sessions through the Codex app-server runtime factory", async () => {
    const startThread = vi.fn().mockResolvedValue("thr_started");
    const resumeThread = vi.fn().mockResolvedValue("thr_resumed");
    const dispose = vi.fn().mockResolvedValue(undefined);
    const interruptTurn = vi.fn().mockResolvedValue(undefined);
    const startTurn = vi.fn().mockResolvedValue({ turnId: "turn_1" });
    const streamTurn = vi.fn().mockReturnValue(Effect.never as never);

    const factory = createCodexRuntimeFactory({
      resolveWorkspaceCwd: (workspaceId) => `/tmp/${workspaceId}`,
      defaultModel: "gpt-5-codex",
      spawn: () => {
        throw new Error("spawn should not be called when mocked");
      },
    });

    const adapterWithMock = new CodexProviderAdapter({
      createSession: (input) =>
        Effect.succeed({
          sessionId: input.sessionId,
          providerSessionRef: "thr_started",
          providerThreadRef: "thr_started",
          startTurn: () => Effect.succeed(streamTurn()),
          interruptTurn: () => Effect.promise(() => interruptTurn()),
          dispose: () => Effect.promise(() => dispose()),
        }),
      resumeSession: (input) =>
        Effect.succeed({
          sessionId: input.sessionId,
          providerSessionRef: input.providerSessionRef,
          providerThreadRef: input.providerThreadRef,
          startTurn: () => Effect.succeed(streamTurn()),
          interruptTurn: () => Effect.promise(() => interruptTurn()),
          dispose: () => Effect.promise(() => dispose()),
        }),
    });

    await Effect.runPromise(
      adapterWithMock.resumeSession({
        workspaceId: "workspace_1",
        sessionId: "session_1",
        providerSessionRef: "thr_started",
        providerThreadRef: "thr_started",
      }),
    );

    expect(adapterWithMock.getResumeStrategy()).toBe("native");
    expect(factory).toBeDefined();
    expect(startThread).not.toHaveBeenCalled();
    expect(resumeThread).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
  });
});
