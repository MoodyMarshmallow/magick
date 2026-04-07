// Verifies thread records and snapshots round-trip through persistence.

import type { ThreadSummary, ThreadViewModel } from "@magick/contracts/chat";
import { createDatabase } from "./database";
import { ThreadRepository } from "./threadRepository";

const makeSummary = (
  overrides: Partial<ThreadSummary> = {},
): ThreadSummary => ({
  threadId: "thread_1",
  workspaceId: "workspace_1",
  providerKey: "fake",
  title: "Chat",
  resolutionState: "open",
  runtimeState: "idle",
  latestSequence: 1,
  latestActivityAt: "2026-01-01T00:00:01.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
  ...overrides,
});

const makeThread = (
  overrides: Partial<ThreadViewModel> = {},
): ThreadViewModel => ({
  threadId: "thread_1",
  workspaceId: "workspace_1",
  providerKey: "fake",
  providerSessionId: "session_1",
  title: "Chat",
  resolutionState: "open",
  runtimeState: "idle",
  messages: [],
  toolActivities: [],
  pendingToolApproval: null,
  activeTurnId: null,
  latestSequence: 1,
  lastError: null,
  lastUserMessageAt: null,
  lastAssistantMessageAt: null,
  latestActivityAt: "2026-01-01T00:00:01.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
  ...overrides,
});

describe("ThreadRepository", () => {
  it("persists threads and snapshots", () => {
    const repository = new ThreadRepository(createDatabase());

    repository.create({
      id: "thread_1",
      workspaceId: "workspace_1",
      providerKey: "fake",
      providerSessionId: "session_1",
      title: "Chat",
      resolutionState: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    repository.saveSnapshot("thread_1", makeSummary(), makeThread());

    expect(repository.get("thread_1")).toMatchObject({
      title: "Chat",
      resolutionState: "open",
    });
    expect(repository.listByWorkspace("workspace_1")).toHaveLength(1);
    expect(repository.getSnapshot("thread_1")).toMatchObject({
      threadId: "thread_1",
      runtimeState: "idle",
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
        resolutionState: "open",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    }

    repository.saveSnapshot(
      "thread_1",
      makeSummary({ threadId: "thread_1", title: "thread_1" }),
      makeThread({
        threadId: "thread_1",
        providerSessionId: "thread_1_session",
        title: "thread_1",
      }),
    );
    repository.saveSnapshot(
      "thread_2",
      makeSummary({
        threadId: "thread_2",
        title: "thread_2",
        latestSequence: 2,
        latestActivityAt: "2026-01-01T00:00:02.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z",
      }),
      makeThread({
        threadId: "thread_2",
        providerSessionId: "thread_2_session",
        title: "thread_2",
        latestSequence: 2,
        latestActivityAt: "2026-01-01T00:00:02.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z",
      }),
    );

    const summaries = repository.listByWorkspace("workspace_1");
    expect(summaries.map((entry) => entry.threadId)).toEqual([
      "thread_2",
      "thread_1",
    ]);
  });

  it("updates persisted titles and deletes threads", () => {
    const repository = new ThreadRepository(createDatabase());

    repository.create({
      id: "thread_1",
      workspaceId: "workspace_1",
      providerKey: "fake",
      providerSessionId: "session_1",
      title: "Chat",
      resolutionState: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    repository.saveSnapshot("thread_1", makeSummary(), makeThread());

    repository.updateTitle(
      "thread_1",
      "Renamed chat",
      "2026-01-01T00:00:02.000Z",
    );

    expect(repository.get("thread_1")).toMatchObject({
      title: "Renamed chat",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });
    expect(repository.getSnapshot("thread_1")).toMatchObject({
      title: "Renamed chat",
      updatedAt: "2026-01-01T00:00:02.000Z",
    });

    repository.delete("thread_1");

    expect(repository.get("thread_1")).toBeNull();
    expect(repository.getSnapshot("thread_1")).toBeNull();
  });
});
