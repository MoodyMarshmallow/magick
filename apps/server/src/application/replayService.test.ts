import { Cause, Exit, Layer, Option } from "effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { createDatabase } from "../persistence/database";
import { makeEventStoreLayer } from "../persistence/eventStore";
import { makeThreadRepositoryLayer } from "../persistence/threadRepository";
import { ReplayService, ReplayServiceLive } from "./replayService";

const makeReplayRuntime = () => {
  const database = createDatabase();
  const baseLayer = Layer.mergeAll(
    makeEventStoreLayer(database),
    makeThreadRepositoryLayer(database),
  );

  return ManagedRuntime.make(ReplayServiceLive.pipe(Layer.provide(baseLayer)));
};

describe("ReplayService", () => {
  it("fails when requesting state for an unknown thread", async () => {
    const runtime = makeReplayRuntime();
    const replayService = await runtime.runPromise(ReplayService);

    const exit = await runtime.runPromiseExit(
      replayService.getThreadState("missing_thread"),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(Option.isSome(failure) ? failure.value : null).toMatchObject({
        _tag: "NotFoundError",
        id: "missing_thread",
      });
    }
  });

  it("returns an empty replay when no events exist after the checkpoint", async () => {
    const runtime = makeReplayRuntime();
    const replayService = await runtime.runPromise(ReplayService);

    const events = await runtime.runPromise(
      replayService.replayThread("unknown_thread", 99),
    );

    expect(events).toEqual([]);
  });
});
