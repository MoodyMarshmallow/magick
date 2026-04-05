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
import { RenderedMarkdown } from "../../document/components/RenderedMarkdown";
import type { CommentThread } from "../state/threadProjector";

interface CommentSidebarProps {
  readonly threads: readonly CommentThread[];
  readonly activeThreadId: string | null;
  readonly isLoggedIn: boolean;
  readonly isLoginPending: boolean;
  readonly onActivateThread: (threadId: string) => void;
  readonly onCreateThread: () => Promise<void>;
  readonly onDeleteThread: (threadId: string) => Promise<void>;
  readonly onLogin: () => Promise<void>;
  readonly onRenameThread: (threadId: string, title: string) => Promise<void>;
  readonly onShowLedger: () => void;
  readonly onSendReply: (threadId: string, message: string) => Promise<void>;
  readonly onToggleResolved: (threadId: string) => Promise<void>;
}

export function CommentSidebar({
  threads,
  activeThreadId,
  isLoggedIn,
  isLoginPending,
  onActivateThread,
  onCreateThread,
  onDeleteThread,
  onLogin,
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
  const [titleDraft, setTitleDraft] = useState("");
  const activeThread =
    threads.find((thread) => thread.threadId === activeThreadId) ?? null;
  const visibleThreads = threads.filter((thread) =>
    showResolvedOnly ? thread.status === "resolved" : thread.status === "open",
  );

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
      <header className="comment-sidebar__header">
        <button
          className="flat-button comment-sidebar__login"
          disabled={isLoggedIn || isLoginPending}
          onClick={async () => {
            await onLogin();
          }}
          type="button"
        >
          {isLoggedIn ? "logged in" : "log in"}
        </button>
      </header>
      {activeThread ? (
        <section className="comment-sidebar__active-thread">
          <div className="thread-record__messages">
            {activeThread.messages.map((message) => (
              <article
                className={`thread-record__message thread-record__message--${message.author}`}
                key={message.id}
              >
                <header>
                  <span>{message.author === "human" ? "you" : "magick"}</span>
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
            ))}
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

          <footer className="thread-record__footer">
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
          </footer>
        </section>
      ) : (
        <section className="thread-ledger thread-ledger--full">
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
                    onClick={() => {
                      setThreadMenuId((current) =>
                        current === thread.threadId ? null : thread.threadId,
                      );
                    }}
                    type="button"
                  >
                    <EllipsisVertical size={appIconSize} />
                  </button>
                  {threadMenuId === thread.threadId ? (
                    <div className="thread-entry__menu" role="menu">
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
                          await onDeleteThread(thread.threadId);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
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
          </div>
          <footer className="comment-sidebar__footer">
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
          </footer>
        </section>
      )}
    </aside>
  );
}
