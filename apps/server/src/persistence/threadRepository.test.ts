// Verifies thread records and snapshots round-trip through persistence.

import { createDatabase } from "./database";
import { ThreadRepository } from "./threadRepository";

describe("ThreadRepository", () => {
  it("persists threads and snapshots", () => {
    const repository = new ThreadRepository(createDatabase());

    repository.create({
      id: "thread_1",
      workspaceId: "workspace_1",
      providerKey: "fake",
      providerSessionId: "session_1",
      title: "Chat",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

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
    );

    expect(repository.get("thread_1")).toMatchObject({ title: "Chat" });
    expect(repository.listByWorkspace("workspace_1")).toHaveLength(1);
    expect(repository.getSnapshot("thread_1")).toMatchObject({
      threadId: "thread_1",
    });
  });

  it("returns null or empty collections for missing thread data", () => {
    const repository = new ThreadRepository(createDatabase());

    expect(repository.get("missing")).toBeNull();
    expect(repository.getSnapshot("missing")).toBeNull();
    expect(repository.listByWorkspace("workspace_1")).toEqual([]);
  });

  it("overwrites an existing snapshot when saving again", () => {
    const repository = new ThreadRepository(createDatabase());

    repository.create({
      id: "thread_1",
      workspaceId: "workspace_1",
      providerKey: "fake",
      providerSessionId: "session_1",
      title: "Chat",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

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
    );

    repository.saveSnapshot(
      "thread_1",
      {
        threadId: "thread_1",
        workspaceId: "workspace_1",
        providerKey: "fake",
        title: "Updated",
        status: "failed",
        latestSequence: 2,
        updatedAt: "2026-01-01T00:00:02.000Z",
      },
      {
        threadId: "thread_1",
        workspaceId: "workspace_1",
        providerKey: "fake",
        providerSessionId: "session_1",
        title: "Updated",
        status: "failed",
        messages: [],
        activeTurnId: null,
        latestSequence: 2,
        lastError: "boom",
        lastUserMessageAt: null,
        lastAssistantMessageAt: null,
        updatedAt: "2026-01-01T00:00:02.000Z",
      },
    );

    expect(repository.getSnapshot("thread_1")).toMatchObject({
      title: "Updated",
      status: "failed",
    });
  });

  it("returns workspace summaries ordered by latest snapshot update", () => {
    const repository = new ThreadRepository(createDatabase());

    for (const threadId of ["thread_1", "thread_2"]) {
      repository.create({
        id: threadId,
        workspaceId: "workspace_1",
        providerKey: "fake",
        providerSessionId: `${threadId}_session`,
        title: threadId,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    }

    repository.saveSnapshot(
      "thread_1",
      {
        threadId: "thread_1",
        workspaceId: "workspace_1",
        providerKey: "fake",
        title: "thread_1",
        status: "idle",
        latestSequence: 1,
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
      {
        threadId: "thread_1",
        workspaceId: "workspace_1",
        providerKey: "fake",
        providerSessionId: "thread_1_session",
        title: "thread_1",
        status: "idle",
        messages: [],
        activeTurnId: null,
        latestSequence: 1,
        lastError: null,
        lastUserMessageAt: null,
        lastAssistantMessageAt: null,
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
    );
    repository.saveSnapshot(
      "thread_2",
      {
        threadId: "thread_2",
        workspaceId: "workspace_1",
        providerKey: "fake",
        title: "thread_2",
        status: "idle",
        latestSequence: 2,
        updatedAt: "2026-01-01T00:00:02.000Z",
      },
      {
        threadId: "thread_2",
        workspaceId: "workspace_1",
        providerKey: "fake",
        providerSessionId: "thread_2_session",
        title: "thread_2",
        status: "idle",
        messages: [],
        activeTurnId: null,
        latestSequence: 2,
        lastError: null,
        lastUserMessageAt: null,
        lastAssistantMessageAt: null,
        updatedAt: "2026-01-01T00:00:02.000Z",
      },
    );

    const summaries = repository.listByWorkspace("workspace_1");
    expect(summaries.map((summary) => summary.threadId)).toEqual([
      "thread_2",
      "thread_1",
    ]);
  });

  it("surfaces persistence errors when stored snapshots are invalid", () => {
    const database = createDatabase();
    database
      .prepare(
        `
          INSERT INTO thread_snapshots (thread_id, summary_json, thread_json, updated_at)
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(
        "thread_1",
        JSON.stringify({ threadId: "thread_1" }),
        "{bad json",
        "2026-01-01T00:00:00.000Z",
      );

    const repository = new ThreadRepository(database);

    expect(() => repository.getSnapshot("thread_1")).toThrow();
  });
});
