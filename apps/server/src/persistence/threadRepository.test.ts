import * as ManagedRuntime from "effect/ManagedRuntime";

import { createDatabase } from "./database";
import {
  ThreadRepository,
  makeThreadRepositoryLayer,
} from "./threadRepository";

describe("ThreadRepository", () => {
  it("persists threads and snapshots", async () => {
    const runtime = ManagedRuntime.make(
      makeThreadRepositoryLayer(createDatabase()),
    );
    const repository = await runtime.runPromise(ThreadRepository);

    await runtime.runPromise(
      repository.create({
        id: "thread_1",
        workspaceId: "workspace_1",
        providerKey: "fake",
        providerSessionId: "session_1",
        title: "Chat",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await runtime.runPromise(
      repository.saveSnapshot(
        "thread_1",
        {
          threadId: "thread_1",
          workspaceId: "workspace_1",
          providerKey: "fake",
          title: "Chat",
          status: "idle",
          latestSequence: 1,
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
        {
          threadId: "thread_1",
          workspaceId: "workspace_1",
          providerKey: "fake",
          providerSessionId: "session_1",
          title: "Chat",
          status: "idle",
          messages: [],
          activeTurnId: null,
          latestSequence: 1,
          lastError: null,
          lastUserMessageAt: null,
          lastAssistantMessageAt: null,
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      ),
    );

    expect(await runtime.runPromise(repository.get("thread_1"))).toMatchObject({
      title: "Chat",
    });
    expect(
      await runtime.runPromise(repository.listByWorkspace("workspace_1")),
    ).toHaveLength(1);
    expect(
      await runtime.runPromise(repository.getSnapshot("thread_1")),
    ).toMatchObject({
      threadId: "thread_1",
    });
  });
});
