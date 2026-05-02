import type {
  AssistantOutputChannel,
  BookmarkSummary,
  BranchViewModel,
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
  readonly channel: AssistantOutputChannel | null;
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

type CommentThreadEvent =
  | {
      readonly type: "snapshot.loaded";
      readonly bookmarks: readonly BookmarkSummary[];
      readonly activeBranch: BranchViewModel | null;
    }
  | {
      readonly type: "branch.loaded";
      readonly branch: BranchViewModel;
    }
  | {
      readonly type: "bookmark.deleted";
      readonly bookmarkId: string;
    };

const toCommentMessage = (
  message: BranchViewModel["messages"][number],
): CommentMessage => ({
  id: message.id,
  author: message.role === "user" ? "human" : "ai",
  channel: message.channel,
  body: message.content,
  createdAt: message.createdAt,
  status: message.status,
});

const toCommentThreadSummary = (summary: BookmarkSummary): CommentThread => ({
  threadId: summary.bookmarkId,
  title: summary.title,
  status: "open",
  runtimeState: summary.runtimeState,
  updatedAt: summary.updatedAt,
  messages: [],
  toolActivities: [],
  pendingToolApproval: null,
});

const toCommentThread = (branch: BranchViewModel): CommentThread => ({
  threadId: branch.bookmarkId,
  title: branch.title,
  status: "open",
  runtimeState: branch.runtimeState,
  updatedAt: branch.updatedAt,
  messages: branch.messages.map(toCommentMessage),
  toolActivities: branch.toolActivities,
  pendingToolApproval: branch.pendingToolApproval,
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

export const projectThreadEvent = (
  threads: readonly CommentThread[],
  event: CommentThreadEvent,
): readonly CommentThread[] => {
  switch (event.type) {
    case "snapshot.loaded": {
      const merged = event.bookmarks.map(toCommentThreadSummary);
      return event.activeBranch
        ? upsertThread(merged, toCommentThread(event.activeBranch))
        : sortThreads(merged);
    }
    case "branch.loaded":
      return upsertThread(threads, toCommentThread(event.branch));
    case "bookmark.deleted":
      return threads.filter((thread) => thread.threadId !== event.bookmarkId);
  }
};
