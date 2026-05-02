import { createDatabase } from "../../../../persistence/database";
import { ContextCore } from "./contextCore";

const createTestCore = () => {
  let idCounter = 0;
  let timeCounter = 0;
  const core = new ContextCore({
    database: createDatabase(),
    clock: {
      now: () =>
        new Date(Date.UTC(2026, 0, 1, 0, 0, timeCounter++)).toISOString(),
    },
    idGenerator: {
      next: (prefix) => `${prefix}_${++idCounter}`,
    },
  });
  core.bootstrap({ instructions: "You are Magick." });
  return core;
};

describe("ContextCore", () => {
  it("creates bookmarks at the trunk tail and returns no active branch during bootstrap", () => {
    const core = createTestCore();

    expect(core.listBookmarks()).toEqual([]);

    const branch = core.createBookmark({ providerKey: "fake", title: "Work" });

    expect(branch).toMatchObject({
      bookmarkId: "bookmark_3",
      title: "Work",
      providerKey: "fake",
      messages: [],
      toolActivities: [],
      runtimeState: "idle",
    });
    expect(core.listBookmarks()).toMatchObject([
      { bookmarkId: "bookmark_3", title: "Work" },
    ]);
  });

  it("appends user and assistant nodes, advances the bookmark, and derives provider payload", () => {
    const core = createTestCore();
    const bookmark = core.createBookmark({ providerKey: "fake" });

    core.appendUserMessage({
      bookmarkId: bookmark.bookmarkId,
      messageId: "message_user",
      content: "Hello",
    });
    core.beginAssistantMessage({
      bookmarkId: bookmark.bookmarkId,
      turnId: "turn_1",
      messageId: "message_assistant",
      channel: "final",
    });
    core.appendAssistantDelta({
      bookmarkId: bookmark.bookmarkId,
      messageId: "message_assistant",
      delta: "Hi",
    });
    const branch = core.completeAssistantMessage({
      bookmarkId: bookmark.bookmarkId,
      messageId: "message_assistant",
      reason: "stop",
    });

    expect(branch.messages.map((message) => message.content)).toEqual([
      "Hello",
      "Hi",
    ]);
    expect(
      core.buildProviderPayload({ bookmarkId: bookmark.bookmarkId }),
    ).toEqual({
      instructions: "You are Magick.",
      historyItems: [
        { type: "message", role: "user", channel: null, content: "Hello" },
        {
          type: "message",
          role: "assistant",
          channel: "final",
          content: "Hi",
          reason: "stop",
        },
      ],
    });
  });

  it("stores tool calls and results in provider order", () => {
    const core = createTestCore();
    const bookmark = core.createBookmark({ providerKey: "fake" });

    core.appendToolCall({
      bookmarkId: bookmark.bookmarkId,
      turnId: "turn_1",
      toolCallId: "call_1",
      toolName: "read",
      title: "Read file",
      argsPreview: '{"path":"notes.md"}',
      input: { path: "notes.md" },
      path: "notes.md",
      url: null,
    });
    const branch = core.appendToolResult({
      bookmarkId: bookmark.bookmarkId,
      turnId: "turn_1",
      toolCallId: "call_1",
      toolName: "read",
      status: "completed",
      resultPreview: "contents",
      modelOutput: "contents",
      path: "notes.md",
      url: null,
      diff: null,
      error: null,
    });

    expect(branch.toolActivities).toMatchObject([
      {
        toolCallId: "call_1",
        toolName: "read",
        status: "completed",
        resultPreview: "contents",
      },
    ]);
    expect(
      core.buildProviderPayload({ bookmarkId: bookmark.bookmarkId })
        .historyItems,
    ).toEqual([
      {
        type: "tool_call",
        toolCallId: "call_1",
        toolName: "read",
        input: { path: "notes.md" },
      },
      { type: "tool_result", toolCallId: "call_1", output: "contents" },
    ]);
  });

  it("prunes only an unreachable leaf suffix when deleting a bookmark", () => {
    const core = createTestCore();
    const first = core.createBookmark({ providerKey: "fake", title: "First" });
    const second = core.createBookmark({
      providerKey: "fake",
      title: "Second",
    });

    core.appendUserMessage({
      bookmarkId: first.bookmarkId,
      messageId: "message_first",
      content: "First branch",
    });
    core.appendUserMessage({
      bookmarkId: second.bookmarkId,
      messageId: "message_second",
      content: "Second branch",
    });

    core.deleteBookmark({ bookmarkId: first.bookmarkId });

    expect(core.listBookmarks().map((bookmark) => bookmark.bookmarkId)).toEqual(
      [second.bookmarkId],
    );
    expect(
      core.selectBookmark({ bookmarkId: second.bookmarkId }).messages,
    ).toMatchObject([{ content: "Second branch" }]);
  });
});
