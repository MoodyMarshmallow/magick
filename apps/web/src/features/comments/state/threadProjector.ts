import type {
  DomainEvent,
  ThreadSummary,
  ThreadViewModel,
} from "@magick/contracts/chat";

export type CommentMessageAuthor = "human" | "ai";
export type CommentMessageStatus =
  | "complete"
  | "streaming"
  | "failed"
  | "interrupted";
export type CommentThreadStatus = "open" | "resolved";
export type CommentThreadRuntimeState =
  | "idle"
  | "running"
  | "interrupted"
  | "failed";

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
  readonly runtimeState: CommentThreadRuntimeState;
  readonly updatedAt: string;
  readonly messages: readonly CommentMessage[];
}

export type CommentThreadEvent =
  | {
      readonly type: "snapshot.loaded";
      readonly threads: readonly ThreadSummary[];
      readonly activeThread: ThreadViewModel | null;
    }
  | {
      readonly type: "thread.loaded";
      readonly thread: ThreadViewModel;
    }
  | {
      readonly type: "domain.event";
      readonly threadId: string;
      readonly event: DomainEvent;
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

const toCommentMessage = (
  message: ThreadViewModel["messages"][number],
): CommentMessage => ({
  id: message.id,
  author: message.role === "user" ? "human" : "ai",
  body: message.content,
  createdAt: message.createdAt,
  status: message.status,
});

const toCommentThreadSummary = (summary: ThreadSummary): CommentThread => ({
  threadId: summary.threadId,
  title: summary.title,
  status: summary.resolutionState,
  runtimeState: summary.runtimeState,
  updatedAt: summary.updatedAt,
  messages: [],
});

const toCommentThread = (thread: ThreadViewModel): CommentThread => ({
  threadId: thread.threadId,
  title: thread.title,
  status: thread.resolutionState,
  runtimeState: thread.runtimeState,
  updatedAt: thread.updatedAt,
  messages: thread.messages.map(toCommentMessage),
});

const sortThreads = (
  threads: readonly CommentThread[],
): readonly CommentThread[] => {
  return [...threads].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
};

const upsertThread = (
  threads: readonly CommentThread[],
  nextThread: CommentThread,
): readonly CommentThread[] => {
  const existing = threads.find(
    (thread) => thread.threadId === nextThread.threadId,
  );
  if (!existing) {
    return sortThreads([nextThread, ...threads]);
  }

  return sortThreads(
    threads.map((thread) =>
      thread.threadId === nextThread.threadId
        ? {
            ...thread,
            ...nextThread,
            messages:
              nextThread.messages.length > 0
                ? nextThread.messages
                : thread.messages,
          }
        : thread,
    ),
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

const ensureThread = (
  threads: readonly CommentThread[],
  threadId: string,
): readonly CommentThread[] => {
  if (threads.some((thread) => thread.threadId === threadId)) {
    return threads;
  }

  return [
    {
      threadId,
      title: "New chat",
      status: "open",
      runtimeState: "idle",
      updatedAt: new Date(0).toISOString(),
      messages: [],
    },
    ...threads,
  ];
};

export const projectThreadEvent = (
  threads: readonly CommentThread[],
  event: CommentThreadEvent,
): readonly CommentThread[] => {
  switch (event.type) {
    case "snapshot.loaded": {
      const merged = event.threads.map(toCommentThreadSummary);
      return event.activeThread
        ? upsertThread(merged, toCommentThread(event.activeThread))
        : sortThreads(merged);
    }
    case "thread.loaded":
      return upsertThread(threads, toCommentThread(event.thread));
    case "thread.created":
      return upsertThread(threads, event.thread);
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
    case "domain.event": {
      const nextThreads = ensureThread(threads, event.threadId);
      const domainEvent = event.event;
      switch (domainEvent.type) {
        case "thread.created":
          return upsertThread(nextThreads, {
            threadId: event.threadId,
            title: domainEvent.payload.title,
            status: "open",
            runtimeState: "idle",
            updatedAt: domainEvent.occurredAt,
            messages: [],
          });
        case "thread.resolved":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            status: "resolved",
            updatedAt: domainEvent.occurredAt,
          }));
        case "thread.reopened":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            status: "open",
            updatedAt: domainEvent.occurredAt,
          }));
        case "provider.session.disconnected":
        case "turn.failed":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            runtimeState: "failed",
            updatedAt: domainEvent.occurredAt,
          }));
        case "turn.started":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            runtimeState: "running",
            updatedAt: domainEvent.occurredAt,
          }));
        case "turn.interrupted":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            runtimeState: "interrupted",
            updatedAt: domainEvent.occurredAt,
            messages: thread.messages.map((message) =>
              message.id === `${domainEvent.payload.turnId}:assistant`
                ? { ...message, status: "interrupted" }
                : message,
            ),
          }));
        case "turn.completed":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            runtimeState: "idle",
            updatedAt: domainEvent.occurredAt,
            messages: thread.messages.map((message) =>
              message.id === `${domainEvent.payload.turnId}:assistant`
                ? { ...message, status: "complete" }
                : message,
            ),
          }));
        case "provider.session.started":
        case "provider.session.recovered":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            updatedAt: domainEvent.occurredAt,
          }));
        case "message.user.created":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            updatedAt: domainEvent.occurredAt,
            messages: [
              ...thread.messages,
              {
                id: domainEvent.payload.messageId,
                author: "human",
                body: domainEvent.payload.content,
                createdAt: domainEvent.occurredAt,
                status: "complete",
              },
            ],
          }));
        case "turn.delta":
          return updateThread(nextThreads, event.threadId, (thread) => {
            const existingMessage = thread.messages.find(
              (message) =>
                message.id === `${domainEvent.payload.turnId}:assistant`,
            );

            return {
              ...thread,
              runtimeState: "running",
              updatedAt: domainEvent.occurredAt,
              messages: existingMessage
                ? thread.messages.map((message) =>
                    message.id === `${domainEvent.payload.turnId}:assistant`
                      ? {
                          ...message,
                          body: `${message.body}${domainEvent.payload.delta}`,
                          status: "streaming",
                        }
                      : message,
                  )
                : [
                    ...thread.messages,
                    {
                      id: `${domainEvent.payload.turnId}:assistant`,
                      author: "ai",
                      body: domainEvent.payload.delta,
                      createdAt: domainEvent.occurredAt,
                      status: "streaming",
                    },
                  ],
            };
          });
      }
    }
  }
};
