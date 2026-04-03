import { Archive, ArrowLeft, Circle, CircleCheckBig } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { appIconSize } from "../../../app/appIconSize";
import type { CommentThread } from "../state/threadProjector";

interface CommentSidebarProps {
  readonly threads: readonly CommentThread[];
  readonly activeThreadId: string | null;
  readonly onActivateThread: (threadId: string) => void;
  readonly onShowLedger: () => void;
  readonly onSendReply: (threadId: string, message: string) => Promise<void>;
  readonly onToggleResolved: (threadId: string) => Promise<void>;
}

export function CommentSidebar({
  threads,
  activeThreadId,
  onActivateThread,
  onShowLedger,
  onSendReply,
  onToggleResolved,
}: CommentSidebarProps) {
  const [replyDraft, setReplyDraft] = useState("");
  const [showResolvedOnly, setShowResolvedOnly] = useState(false);
  const activeThread =
    threads.find((thread) => thread.threadId === activeThreadId) ?? null;
  const visibleThreads = threads.filter((thread) =>
    showResolvedOnly ? thread.status === "resolved" : thread.status === "open",
  );

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

  return (
    <aside className="comment-sidebar">
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
                <p>{message.body || "Streaming..."}</p>
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
              <strong className="thread-record__header-title">
                {activeThread.title}
              </strong>
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
              <div className="thread-entry" key={thread.threadId}>
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
            <strong>Chats</strong>
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
