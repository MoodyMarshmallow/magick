import { maxThreadTitleLength } from "@magick/shared/threadTitle";
import {
  Archive,
  ArrowLeft,
  Circle,
  CircleCheckBig,
  EllipsisVertical,
  Plus,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { appIconSize } from "../../../app/appIconSize";
import {
  OverlayMenu,
  type OverlayMenuPosition,
  getMenuPositionFromTrigger,
} from "../../../app/components/OverlayMenu";
import { RenderedMarkdown } from "../../document/components/RenderedMarkdown";
import type { CommentThread } from "../state/threadProjector";

const formatToolDiff = (
  diff: CommentThread["toolActivities"][number]["diff"],
) => {
  if (!diff) {
    return "";
  }

  const hunkLines = diff.hunks.flatMap((hunk) => [
    `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    ...hunk.lines,
  ]);
  return [
    `--- ${diff.kind === "created" ? "/dev/null" : diff.path}`,
    `+++ ${diff.path}`,
    ...hunkLines,
    ...(diff.truncated ? ["... diff truncated ..."] : []),
  ].join("\n");
};

type TimelineEntry =
  | {
      readonly type: "message";
      readonly createdAt: string;
      readonly id: string;
    }
  | { readonly type: "tool"; readonly createdAt: string; readonly id: string };

interface CommentSidebarProps {
  readonly threads: readonly CommentThread[];
  readonly activeThreadId: string | null;
  readonly activeThreadIsDraft?: boolean;
  readonly onActivateThread: (threadId: string) => void;
  readonly onCreateThread: () => Promise<void>;
  readonly onDeleteThread: (threadId: string) => Promise<void>;
  readonly onRenameThread: (threadId: string, title: string) => Promise<void>;
  readonly onShowLedger: () => void;
  readonly onSendReply: (threadId: string, message: string) => Promise<void>;
  readonly onToggleResolved: (threadId: string) => Promise<void>;
}

export function CommentSidebar({
  threads,
  activeThreadId,
  activeThreadIsDraft = false,
  onActivateThread,
  onCreateThread,
  onDeleteThread,
  onRenameThread,
  onShowLedger,
  onSendReply,
  onToggleResolved,
}: CommentSidebarProps) {
  const skipNextRenameBlurRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [renamePendingThreadId, setRenamePendingThreadId] = useState<
    string | null
  >(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [showResolvedOnly, setShowResolvedOnly] = useState(false);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [threadMenuPosition, setThreadMenuPosition] =
    useState<OverlayMenuPosition | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const activeThread =
    threads.find((thread) => thread.threadId === activeThreadId) ?? null;
  const visibleThreads = threads.filter((thread) =>
    showResolvedOnly ? thread.status === "resolved" : thread.status === "open",
  );
  const activeThreadTimeline: readonly TimelineEntry[] = activeThread
    ? [
        ...activeThread.messages.map((message) => ({
          type: "message" as const,
          createdAt: message.createdAt,
          id: message.id,
        })),
        ...activeThread.toolActivities.map((toolActivity) => ({
          type: "tool" as const,
          createdAt: toolActivity.createdAt,
          id: toolActivity.toolCallId,
        })),
      ].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    : [];

  useEffect(() => {
    if (
      editingThreadId &&
      !threads.some((thread) => thread.threadId === editingThreadId)
    ) {
      setEditingThreadId(null);
      setRenamePendingThreadId(null);
      setTitleDraft("");
    }

    if (
      threadMenuId &&
      !threads.some((thread) => thread.threadId === threadMenuId)
    ) {
      setThreadMenuId(null);
      setThreadMenuPosition(null);
    }
  }, [editingThreadId, threadMenuId, threads]);

  useEffect(() => {
    if (!editingThreadId) {
      return;
    }

    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [editingThreadId]);

  const beginThreadRename = (thread: CommentThread) => {
    skipNextRenameBlurRef.current = false;
    setThreadMenuId(null);
    setThreadMenuPosition(null);
    setEditingThreadId(thread.threadId);
    setTitleDraft(thread.title);
  };

  const cancelThreadRename = () => {
    setEditingThreadId(null);
    setRenamePendingThreadId(null);
    setTitleDraft("");
  };

  const commitThreadRename = async (thread: CommentThread) => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle || nextTitle === thread.title) {
      cancelThreadRename();
      return;
    }

    setRenamePendingThreadId(thread.threadId);
    try {
      await onRenameThread(thread.threadId, nextTitle);
      setEditingThreadId(null);
      setTitleDraft("");
    } finally {
      setRenamePendingThreadId((current) =>
        current === thread.threadId ? null : current,
      );
    }
  };

  const updateTitleDraft = (nextTitle: string) => {
    if (nextTitle.length > maxThreadTitleLength) {
      return;
    }

    setTitleDraft(nextTitle);
  };

  const sendReply = async (threadId: string) => {
    const nextMessage = replyDraft.trim();
    if (!nextMessage) {
      return;
    }

    await onSendReply(threadId, nextMessage);
    setReplyDraft("");
  };

  const handleComposerKeyDown = async (
    event: KeyboardEvent<HTMLTextAreaElement>,
    threadId: string,
  ) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    await sendReply(threadId);
  };

  const renderTitleInput = (thread: CommentThread, className: string) => (
    <input
      aria-label={`Rename ${thread.title}`}
      className={className}
      disabled={renamePendingThreadId === thread.threadId}
      maxLength={maxThreadTitleLength}
      onBlur={() => {
        if (skipNextRenameBlurRef.current) {
          skipNextRenameBlurRef.current = false;
          return;
        }

        void commitThreadRename(thread);
      }}
      onChange={(event) => {
        updateTitleDraft(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          skipNextRenameBlurRef.current = true;
          cancelThreadRename();
          return;
        }

        if (event.key !== "Enter") {
          return;
        }

        event.preventDefault();
        event.currentTarget.blur();
      }}
      ref={titleInputRef}
      type="text"
      value={titleDraft}
    />
  );

  return (
    <aside className="comment-sidebar">
      {activeThread ? (
        <section className="comment-sidebar__active-thread">
          <header className="thread-record__header-bar">
            <div className="thread-record__header-main">
              <button
                aria-label="Back to chats"
                className="flat-button thread-record__back"
                onClick={onShowLedger}
                type="button"
              >
                <ArrowLeft size={appIconSize} />
              </button>
              {editingThreadId === activeThread.threadId ? (
                renderTitleInput(
                  activeThread,
                  "thread-title-input thread-record__header-title-input",
                )
              ) : (
                <button
                  className="thread-record__header-title-button"
                  disabled={activeThreadIsDraft}
                  onClick={() => {
                    beginThreadRename(activeThread);
                  }}
                  type="button"
                >
                  <strong className="thread-record__header-title">
                    {activeThread.title}
                  </strong>
                </button>
              )}
            </div>
            <button
              aria-label={
                activeThread.status === "open"
                  ? `Resolve ${activeThread.title}`
                  : `Reopen ${activeThread.title}`
              }
              className="flat-button thread-record__status"
              disabled={activeThreadIsDraft}
              onClick={async () => {
                await onToggleResolved(activeThread.threadId);
              }}
              type="button"
            >
              {activeThread.status === "open" ? (
                <Circle size={appIconSize} />
              ) : (
                <CircleCheckBig size={appIconSize} />
              )}
            </button>
          </header>

          <div className="thread-record__messages">
            {activeThreadTimeline.map((entry) => {
              if (entry.type === "message") {
                const message = activeThread.messages.find(
                  (candidate) => candidate.id === entry.id,
                );
                if (!message) {
                  return null;
                }

                return (
                  <article
                    className={`thread-record__message thread-record__message--${message.author}`}
                    key={message.id}
                  >
                    <header>
                      <span>
                        {message.author === "human" ? "you" : "magick"}
                      </span>
                      <span>
                        {new Date(message.createdAt).toLocaleTimeString()}
                      </span>
                    </header>
                    <div className="thread-record__message-body">
                      {message.body ? (
                        <RenderedMarkdown content={message.body} />
                      ) : (
                        <p>Streaming...</p>
                      )}
                    </div>
                  </article>
                );
              }

              const toolActivity = activeThread.toolActivities.find(
                (candidate) => candidate.toolCallId === entry.id,
              );
              if (!toolActivity) {
                return null;
              }

              return (
                <article
                  className={`thread-record__tool thread-record__tool--${toolActivity.status}`}
                  key={toolActivity.toolCallId}
                >
                  <header>
                    <span>{toolActivity.title || toolActivity.toolName}</span>
                    <span>
                      {new Date(toolActivity.updatedAt).toLocaleTimeString()}
                    </span>
                  </header>
                  <div className="thread-record__tool-meta">
                    {toolActivity.path ? (
                      <span>{toolActivity.path}</span>
                    ) : null}
                    {toolActivity.url ? <span>{toolActivity.url}</span> : null}
                    <span>{toolActivity.status.replaceAll("_", " ")}</span>
                  </div>
                  {toolActivity.argsPreview ||
                  toolActivity.resultPreview ||
                  toolActivity.diff ||
                  toolActivity.error ? (
                    <details className="thread-record__tool-details">
                      <summary>Details</summary>
                      {toolActivity.argsPreview ? (
                        <pre className="thread-record__tool-pre">
                          {toolActivity.argsPreview}
                        </pre>
                      ) : null}
                      {toolActivity.diff ? (
                        <pre className="thread-record__tool-pre">
                          {formatToolDiff(toolActivity.diff)}
                        </pre>
                      ) : null}
                      {!toolActivity.diff && toolActivity.resultPreview ? (
                        <pre className="thread-record__tool-pre">
                          {toolActivity.resultPreview}
                        </pre>
                      ) : null}
                      {toolActivity.error ? (
                        <p className="thread-record__tool-error">
                          {toolActivity.error}
                        </p>
                      ) : null}
                    </details>
                  ) : null}
                </article>
              );
            })}
            {activeThread.pendingToolApproval ? (
              <article className="thread-record__tool thread-record__tool--awaiting_approval">
                <header>
                  <span>Approval needed</span>
                  <span>
                    {new Date(
                      activeThread.pendingToolApproval.requestedAt,
                    ).toLocaleTimeString()}
                  </span>
                </header>
                <div className="thread-record__tool-meta">
                  <span>{activeThread.pendingToolApproval.toolName}</span>
                  {activeThread.pendingToolApproval.path ? (
                    <span>{activeThread.pendingToolApproval.path}</span>
                  ) : null}
                </div>
                <p className="thread-record__tool-error">
                  {activeThread.pendingToolApproval.reason}
                </p>
              </article>
            ) : null}
          </div>

          <div className="thread-record__composer">
            <div className="thread-record__response-field">
              <textarea
                id="thread-response-field"
                value={replyDraft}
                onChange={(event) => setReplyDraft(event.target.value)}
                onKeyDown={(event) =>
                  handleComposerKeyDown(event, activeThread.threadId)
                }
                enterKeyHint="send"
                placeholder="Write a response"
                rows={3}
              />
            </div>
          </div>
        </section>
      ) : (
        <section className="thread-ledger thread-ledger--full">
          <header className="comment-sidebar__header">
            <div className="comment-sidebar__footer-main">
              <button
                aria-label="Create new chat"
                className="flat-button comment-sidebar__create"
                onClick={async () => {
                  await onCreateThread();
                }}
                type="button"
              >
                <Plus size={appIconSize} />
              </button>
              <strong>Chats</strong>
            </div>
            <button
              aria-label={
                showResolvedOnly ? "Show open chats" : "Show resolved chats"
              }
              className={`flat-button comment-sidebar__filter${showResolvedOnly ? " is-active" : ""}`}
              onClick={() => {
                setShowResolvedOnly((current) => !current);
              }}
              type="button"
            >
              <Archive size={appIconSize} />
            </button>
          </header>

          <div className="thread-ledger__items">
            {visibleThreads.map((thread) => (
              <div
                className={`thread-entry${threadMenuId === thread.threadId ? " thread-entry--menu-open" : ""}`}
                key={thread.threadId}
              >
                <button
                  aria-label={
                    thread.status === "open"
                      ? `Resolve ${thread.title}`
                      : `Reopen ${thread.title}`
                  }
                  className="flat-button thread-entry__toggle"
                  onClick={async () => {
                    await onToggleResolved(thread.threadId);
                  }}
                  type="button"
                >
                  {thread.status === "open" ? (
                    <Circle size={appIconSize} />
                  ) : (
                    <CircleCheckBig size={appIconSize} />
                  )}
                </button>
                {editingThreadId === thread.threadId ? (
                  <div className="thread-entry__summary thread-entry__summary--editing">
                    <div className="thread-entry__content">
                      {renderTitleInput(
                        thread,
                        "thread-title-input thread-entry__title-input",
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    aria-label={`Open ${thread.title}`}
                    className="thread-entry__summary"
                    onClick={() => {
                      onActivateThread(thread.threadId);
                    }}
                    type="button"
                  >
                    <div className="thread-entry__content">
                      <strong>{thread.title}</strong>
                    </div>
                  </button>
                )}
                <div className="thread-entry__menu-shell">
                  <button
                    aria-expanded={threadMenuId === thread.threadId}
                    aria-haspopup="menu"
                    aria-label={`More actions for ${thread.title}`}
                    className="flat-button thread-entry__menu-trigger"
                    onClick={(event) => {
                      const menuPosition = getMenuPositionFromTrigger(
                        event.currentTarget,
                      );

                      setThreadMenuId((current) => {
                        if (current === thread.threadId) {
                          setThreadMenuPosition(null);
                          return null;
                        }

                        setThreadMenuPosition(menuPosition);
                        return thread.threadId;
                      });
                    }}
                    type="button"
                  >
                    <EllipsisVertical size={appIconSize} />
                  </button>
                  {threadMenuId === thread.threadId && threadMenuPosition ? (
                    <OverlayMenu
                      className="thread-entry__menu"
                      onClose={() => {
                        setThreadMenuId(null);
                        setThreadMenuPosition(null);
                      }}
                      position={threadMenuPosition}
                    >
                      <button
                        className="thread-entry__menu-item"
                        onClick={() => {
                          beginThreadRename(thread);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        className="thread-entry__menu-item"
                        disabled={thread.runtimeState === "running"}
                        onClick={async () => {
                          setThreadMenuId(null);
                          setThreadMenuPosition(null);
                          await onDeleteThread(thread.threadId);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        Delete
                      </button>
                    </OverlayMenu>
                  ) : null}
                </div>
              </div>
            ))}
            {visibleThreads.length === 0 ? (
              <div className="thread-ledger__empty">
                {showResolvedOnly
                  ? "No resolved chats yet."
                  : "No open chats yet."}
              </div>
            ) : null}
            <div className="file-tree__root-create comment-sidebar__root-create">
              <div
                className="file-tree__root-create-spacer"
                aria-hidden="true"
              />
              <div className="file-tree__actions">
                <button
                  aria-label="Create new chat from add zone"
                  className="flat-button file-tree__action-button file-tree__action-button--root-create"
                  onClick={async () => {
                    await onCreateThread();
                  }}
                  type="button"
                >
                  <Plus size={appIconSize} />
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </aside>
  );
}
