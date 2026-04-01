export type CommentMessageAuthor = "human" | "ai";
export type CommentMessageStatus = "complete" | "streaming" | "failed";
export type CommentThreadStatus = "open" | "resolved";

export interface CommentMessage {
  readonly id: string;
  readonly author: CommentMessageAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly status: CommentMessageStatus;
}

export interface CommentThread {
  readonly threadId: string;
  readonly title: string;
  readonly status: CommentThreadStatus;
  readonly updatedAt: string;
  readonly messages: readonly CommentMessage[];
}

export type CommentThreadEvent =
  | {
      readonly type: "snapshot.loaded";
      readonly threads: readonly CommentThread[];
    }
  | {
      readonly type: "thread.created";
      readonly thread: CommentThread;
    }
  | {
      readonly type: "thread.statusChanged";
      readonly threadId: string;
      readonly status: CommentThreadStatus;
      readonly updatedAt: string;
    }
  | {
      readonly type: "message.added";
      readonly threadId: string;
      readonly message: CommentMessage;
      readonly updatedAt: string;
    }
  | {
      readonly type: "message.delta";
      readonly threadId: string;
      readonly messageId: string;
      readonly delta: string;
      readonly updatedAt: string;
    }
  | {
      readonly type: "message.completed";
      readonly threadId: string;
      readonly messageId: string;
      readonly updatedAt: string;
    };

const sortThreads = (
  threads: readonly CommentThread[],
): readonly CommentThread[] => {
  return [...threads].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
};

const updateThread = (
  threads: readonly CommentThread[],
  threadId: string,
  updater: (thread: CommentThread) => CommentThread,
): readonly CommentThread[] => {
  return sortThreads(
    threads.map((thread) =>
      thread.threadId === threadId ? updater(thread) : thread,
    ),
  );
};

export const projectThreadEvent = (
  threads: readonly CommentThread[],
  event: CommentThreadEvent,
): readonly CommentThread[] => {
  switch (event.type) {
    case "snapshot.loaded":
      return sortThreads(event.threads);
    case "thread.created":
      return sortThreads([event.thread, ...threads]);
    case "thread.statusChanged":
      return updateThread(threads, event.threadId, (thread) => ({
        ...thread,
        status: event.status,
        updatedAt: event.updatedAt,
      }));
    case "message.added":
      return updateThread(threads, event.threadId, (thread) => ({
        ...thread,
        updatedAt: event.updatedAt,
        messages: [...thread.messages, event.message],
      }));
    case "message.delta":
      return updateThread(threads, event.threadId, (thread) => ({
        ...thread,
        updatedAt: event.updatedAt,
        messages: thread.messages.map((message) =>
          message.id === event.messageId
            ? { ...message, body: `${message.body}${event.delta}` }
            : message,
        ),
      }));
    case "message.completed":
      return updateThread(threads, event.threadId, (thread) => ({
        ...thread,
        updatedAt: event.updatedAt,
        messages: thread.messages.map((message) =>
          message.id === event.messageId
            ? { ...message, status: "complete" }
            : message,
        ),
      }));
  }
};
