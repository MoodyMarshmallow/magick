import { type CommentThread, projectThreadEvent } from "./threadProjector";

const baseThread: CommentThread = {
  threadId: "thread_1",
  documentId: "doc_1",
  anchorText: "Shared contracts matter.",
  quote: "Shared contracts matter.",
  status: "open",
  updatedAt: "2026-03-27T10:00:00.000Z",
  messages: [],
};

describe("threadProjector", () => {
  it("loads snapshots in descending updated order", () => {
    const projected = projectThreadEvent([], {
      type: "snapshot.loaded",
      threads: [
        baseThread,
        {
          ...baseThread,
          threadId: "thread_2",
          updatedAt: "2026-03-27T10:05:00.000Z",
        },
      ],
    });

    expect(projected.map((thread) => thread.threadId)).toEqual([
      "thread_2",
      "thread_1",
    ]);
  });

  it("appends streaming deltas to an existing message", () => {
    const withMessage = projectThreadEvent([baseThread], {
      type: "message.added",
      threadId: baseThread.threadId,
      updatedAt: "2026-03-27T10:10:00.000Z",
      message: {
        id: "message_1",
        author: "ai",
        body: "Hello",
        createdAt: "2026-03-27T10:10:00.000Z",
        status: "streaming",
      },
    });
    const projected = projectThreadEvent(withMessage, {
      type: "message.delta",
      threadId: baseThread.threadId,
      messageId: "message_1",
      delta: " world",
      updatedAt: "2026-03-27T10:11:00.000Z",
    });

    expect(projected[0]?.messages[0]?.body).toBe("Hello world");
  });

  it("updates thread status without replacing the history", () => {
    const projected = projectThreadEvent([baseThread], {
      type: "thread.statusChanged",
      threadId: baseThread.threadId,
      status: "resolved",
      updatedAt: "2026-03-27T10:20:00.000Z",
    });

    expect(projected[0]).toMatchObject({
      threadId: baseThread.threadId,
      status: "resolved",
    });
  });

  it("moves a thread to the top when a new message arrives", () => {
    const projected = projectThreadEvent(
      [
        baseThread,
        {
          ...baseThread,
          threadId: "thread_2",
          updatedAt: "2026-03-27T10:05:00.000Z",
        },
      ],
      {
        type: "message.added",
        threadId: baseThread.threadId,
        updatedAt: "2026-03-27T10:10:00.000Z",
        message: {
          id: "message_1",
          author: "human",
          body: "Reply",
          createdAt: "2026-03-27T10:10:00.000Z",
          status: "complete",
        },
      },
    );

    expect(projected.map((thread) => thread.threadId)).toEqual([
      "thread_1",
      "thread_2",
    ]);
  });

  it("marks a streaming message as complete without changing other messages", () => {
    const projected = projectThreadEvent(
      [
        {
          ...baseThread,
          messages: [
            {
              id: "message_1",
              author: "ai",
              body: "Hello world",
              createdAt: "2026-03-27T10:10:00.000Z",
              status: "streaming",
            },
            {
              id: "message_2",
              author: "human",
              body: "Stable",
              createdAt: "2026-03-27T10:09:00.000Z",
              status: "complete",
            },
          ],
        },
      ],
      {
        type: "message.completed",
        threadId: baseThread.threadId,
        messageId: "message_1",
        updatedAt: "2026-03-27T10:12:00.000Z",
      },
    );

    expect(projected[0]?.messages).toEqual([
      {
        id: "message_1",
        author: "ai",
        body: "Hello world",
        createdAt: "2026-03-27T10:10:00.000Z",
        status: "complete",
      },
      {
        id: "message_2",
        author: "human",
        body: "Stable",
        createdAt: "2026-03-27T10:09:00.000Z",
        status: "complete",
      },
    ]);
  });

  it("leaves state unchanged when an event targets an unknown thread", () => {
    const projected = projectThreadEvent([baseThread], {
      type: "message.delta",
      threadId: "missing_thread",
      messageId: "message_1",
      delta: "ignored",
      updatedAt: "2026-03-27T10:30:00.000Z",
    });

    expect(projected).toEqual([baseThread]);
  });
});
