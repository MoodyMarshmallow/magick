// Verifies the shared runtime state service stores and clears active turn state correctly.

import { Effect, Layer } from "effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { RuntimeState, RuntimeStateLive } from "./runtime";

describe("RuntimeStateLive", () => {
  it("stores and clears active turns", async () => {
    const runtime = ManagedRuntime.make(RuntimeStateLive);
    const state = await runtime.runPromise(RuntimeState);

    await runtime.runPromise(
      state.setActiveTurn("thread_1", {
        turnId: "turn_1",
        sessionId: "session_1",
      }),
    );
    expect(await runtime.runPromise(state.getActiveTurn("thread_1"))).toEqual({
      turnId: "turn_1",
      sessionId: "session_1",
    });

    await runtime.runPromise(state.clearActiveTurn("thread_1"));
    expect(
      await runtime.runPromise(state.getActiveTurn("thread_1")),
    ).toBeUndefined();
  });
});
