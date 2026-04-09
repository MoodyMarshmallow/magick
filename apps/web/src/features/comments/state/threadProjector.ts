import type {
  DomainEvent,
  ThreadSummary,
  ThreadViewModel,
  ToolActivityView,
  ToolApprovalView,
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
  | "awaiting_approval"
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
  readonly toolActivities: readonly ToolActivityView[];
  readonly pendingToolApproval: ToolApprovalView | null;
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
      readonly type: "thread.deleted";
      readonly threadId: string;
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
  toolActivities: [],
  pendingToolApproval: null,
});

const toCommentThread = (thread: ThreadViewModel): CommentThread => ({
  threadId: thread.threadId,
  title: thread.title,
  status: thread.resolutionState,
  runtimeState: thread.runtimeState,
  updatedAt: thread.updatedAt,
  messages: thread.messages.map(toCommentMessage),
  toolActivities: thread.toolActivities,
  pendingToolApproval: thread.pendingToolApproval,
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
            toolActivities:
              nextThread.toolActivities.length > 0
                ? nextThread.toolActivities
                : thread.toolActivities,
            pendingToolApproval:
              nextThread.pendingToolApproval ?? thread.pendingToolApproval,
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

const assistantMessageIdPrefix = (turnId: string) => `${turnId}:assistant`;

const isAssistantMessageForTurn = (
  messageId: string,
  turnId: string,
): boolean => {
  return (
    messageId === assistantMessageIdPrefix(turnId) ||
    messageId.startsWith(`${assistantMessageIdPrefix(turnId)}:`)
  );
};

const getAssistantSegmentIndex = (
  messageId: string,
  turnId: string,
): number => {
  const prefix = assistantMessageIdPrefix(turnId);
  if (messageId === prefix) {
    return 0;
  }

  const suffix = messageId.slice(prefix.length + 1);
  const parsed = Number.parseInt(suffix, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const findLatestAssistantMessageByTurn = (
  thread: CommentThread,
  turnId: string,
): CommentMessage | undefined => {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message && isAssistantMessageForTurn(message.id, turnId)) {
      return message;
    }
  }

  return undefined;
};

const createNextAssistantMessageId = (
  messages: readonly CommentMessage[],
  turnId: string,
): string => {
  const highestSegmentIndex = messages.reduce((highest, message) => {
    if (!isAssistantMessageForTurn(message.id, turnId)) {
      return highest;
    }

    return Math.max(highest, getAssistantSegmentIndex(message.id, turnId));
  }, -1);

  return `${assistantMessageIdPrefix(turnId)}:${highestSegmentIndex + 1}`;
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
      toolActivities: [],
      pendingToolApproval: null,
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
    case "thread.deleted":
      return threads.filter((thread) => thread.threadId !== event.threadId);
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
            toolActivities: [],
            pendingToolApproval: null,
          });
        case "thread.renamed":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            title: domainEvent.payload.title,
            updatedAt: domainEvent.occurredAt,
          }));
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
        case "tool.approval.requested":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            runtimeState: "awaiting_approval",
            toolActivities: thread.toolActivities.map((toolActivity) =>
              toolActivity.toolCallId === domainEvent.payload.toolCallId
                ? {
                    ...toolActivity,
                    status: "awaiting_approval",
                    updatedAt: domainEvent.occurredAt,
                  }
                : toolActivity,
            ),
            pendingToolApproval: {
              toolCallId: domainEvent.payload.toolCallId,
              toolName: domainEvent.payload.toolName,
              path: domainEvent.payload.path,
              reason: domainEvent.payload.reason,
              requestedAt: domainEvent.occurredAt,
            },
            updatedAt: domainEvent.occurredAt,
          }));
        case "tool.approval.resolved":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            runtimeState:
              domainEvent.payload.decision === "approved"
                ? "running"
                : "failed",
            toolActivities: thread.toolActivities.map((toolActivity) =>
              toolActivity.toolCallId === domainEvent.payload.toolCallId
                ? {
                    ...toolActivity,
                    status:
                      domainEvent.payload.decision === "approved"
                        ? "running"
                        : "failed",
                    error:
                      domainEvent.payload.decision === "approved"
                        ? toolActivity.error
                        : "Tool execution was rejected.",
                    updatedAt: domainEvent.occurredAt,
                  }
                : toolActivity,
            ),
            pendingToolApproval: null,
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
              message.id ===
              findLatestAssistantMessageByTurn(
                thread,
                domainEvent.payload.turnId,
              )?.id
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
              message.id ===
              findLatestAssistantMessageByTurn(
                thread,
                domainEvent.payload.turnId,
              )?.id
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
        case "tool.requested":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            updatedAt: domainEvent.occurredAt,
            messages: thread.messages.map((message) =>
              message.id ===
                findLatestAssistantMessageByTurn(
                  thread,
                  domainEvent.payload.turnId,
                )?.id && message.status === "streaming"
                ? { ...message, status: "complete" }
                : message,
            ),
            toolActivities: [
              ...thread.toolActivities.filter(
                (toolActivity) =>
                  toolActivity.toolCallId !== domainEvent.payload.toolCallId,
              ),
              {
                toolCallId: domainEvent.payload.toolCallId,
                toolName: domainEvent.payload.toolName,
                title: domainEvent.payload.title,
                status: "requested",
                argsPreview: domainEvent.payload.argsPreview,
                resultPreview: null,
                path: domainEvent.payload.path,
                url: domainEvent.payload.url,
                diff: null,
                error: null,
                createdAt: domainEvent.occurredAt,
                updatedAt: domainEvent.occurredAt,
              },
            ],
          }));
        case "tool.started":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            updatedAt: domainEvent.occurredAt,
            toolActivities: thread.toolActivities.map((toolActivity) =>
              toolActivity.toolCallId === domainEvent.payload.toolCallId
                ? {
                    ...toolActivity,
                    status: "running",
                    updatedAt: domainEvent.occurredAt,
                  }
                : toolActivity,
            ),
          }));
        case "tool.completed":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            updatedAt: domainEvent.occurredAt,
            toolActivities: thread.toolActivities.map((toolActivity) =>
              toolActivity.toolCallId === domainEvent.payload.toolCallId
                ? {
                    ...toolActivity,
                    status: "completed",
                    resultPreview: domainEvent.payload.resultPreview,
                    path: domainEvent.payload.path ?? toolActivity.path,
                    url: domainEvent.payload.url ?? toolActivity.url,
                    diff: domainEvent.payload.diff,
                    updatedAt: domainEvent.occurredAt,
                  }
                : toolActivity,
            ),
          }));
        case "tool.failed":
          return updateThread(nextThreads, event.threadId, (thread) => ({
            ...thread,
            updatedAt: domainEvent.occurredAt,
            toolActivities: thread.toolActivities.map((toolActivity) =>
              toolActivity.toolCallId === domainEvent.payload.toolCallId
                ? {
                    ...toolActivity,
                    status: "failed",
                    error: domainEvent.payload.error,
                    updatedAt: domainEvent.occurredAt,
                  }
                : toolActivity,
            ),
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
            const existingMessage = findLatestAssistantMessageByTurn(
              thread,
              domainEvent.payload.turnId,
            );

            return {
              ...thread,
              runtimeState: "running",
              updatedAt: domainEvent.occurredAt,
              messages:
                existingMessage?.status === "streaming"
                  ? thread.messages.map((message) =>
                      message.id === existingMessage.id
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
                        id: createNextAssistantMessageId(
                          thread.messages,
                          domainEvent.payload.turnId,
                        ),
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
