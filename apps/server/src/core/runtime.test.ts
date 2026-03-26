// Verifies the shared runtime state service stores and clears active turn state correctly.

import { createRuntimeState } from "./runtime";

describe("createRuntimeState", () => {
  it("stores and clears active turns", () => {
    const state = createRuntimeState();

    state.setActiveTurn("thread_1", {
      turnId: "turn_1",
      sessionId: "session_1",
    });
    expect(state.getActiveTurn("thread_1")).toEqual({
      turnId: "turn_1",
      sessionId: "session_1",
    });

    state.clearActiveTurn("thread_1");
    expect(state.getActiveTurn("thread_1")).toBeUndefined();
  });
});
