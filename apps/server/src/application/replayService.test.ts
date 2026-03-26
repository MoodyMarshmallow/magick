// Verifies replay service behavior for missing threads and replay queries.

import { createDatabase } from "../persistence/database";
import { EventStore } from "../persistence/eventStore";
import { ThreadRepository } from "../persistence/threadRepository";
import { ReplayService } from "./replayService";

const makeReplayService = () => {
  const database = createDatabase();
  return new ReplayService({
    eventStore: new EventStore(database),
    threadRepository: new ThreadRepository(database),
  });
};

describe("ReplayService", () => {
  it("fails when requesting state for an unknown thread", () => {
    const replayService = makeReplayService();

    expect(() => replayService.getThreadState("missing_thread")).toThrowError(
      expect.objectContaining({
        _tag: "NotFoundError",
        id: "missing_thread",
      }),
    );
  });

  it("returns an empty replay when no events exist after the checkpoint", () => {
    const replayService = makeReplayService();

    expect(replayService.replayThread("unknown_thread", 99)).toEqual([]);
  });
});
