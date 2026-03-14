import { Effect } from "effect";

import { CodexProviderAdapter } from "./codexProviderAdapter";

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
});
