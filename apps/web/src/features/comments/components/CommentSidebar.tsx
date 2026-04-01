import {
  Circle,
  CircleDashed,
  CornerDownRight,
  MessagesSquare,
} from "lucide-react";
import { useState } from "react";
import type { CommentThread } from "../state/threadProjector";

interface CommentSidebarProps {
  readonly threads: readonly CommentThread[];
  readonly activeThreadId: string | null;
  readonly onActivateThread: (threadId: string) => void;
  readonly onSendReply: (threadId: string, message: string) => Promise<void>;
  readonly onToggleResolved: (threadId: string) => Promise<void>;
}

export function CommentSidebar({
  threads,
  activeThreadId,
  onActivateThread,
  onSendReply,
  onToggleResolved,
}: CommentSidebarProps) {
  const [replyDraft, setReplyDraft] = useState("");
  const activeThread =
    threads.find((thread) => thread.threadId === activeThreadId) ?? null;

  return (
    <aside className="comment-sidebar">
      <section className="thread-ledger">
        <div className="thread-ledger__items">
          {threads.map((thread) => (
            <article
              key={thread.threadId}
              className={`thread-entry${
                thread.threadId === activeThreadId ? " is-active" : ""
              }`}
            >
              <button
                aria-label={
                  thread.threadId === activeThreadId
                    ? thread.status === "open"
                      ? `Resolve ${thread.title}`
                      : `Reopen ${thread.title}`
                    : `Open ${thread.title}`
                }
                className="thread-entry__summary"
                onClick={async () => {
                  if (thread.threadId === activeThreadId) {
                    await onToggleResolved(thread.threadId);
                    return;
                  }

                  onActivateThread(thread.threadId);
                }}
                type="button"
              >
                <div className="thread-entry__sigil">
                  {thread.status === "open" ? (
                    <Circle size={14} />
                  ) : (
                    <CircleDashed size={14} />
                  )}
                </div>
                <div className="thread-entry__content">
                  <strong>{thread.title}</strong>
                </div>
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="comment-sidebar__active-thread">
        {activeThread ? (
          <>
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
                  placeholder="Write a response"
                  rows={3}
                />
                <button
                  aria-label="Send reply"
                  className="flat-button flat-button--accent"
                  disabled={!replyDraft.trim()}
                  onClick={async () => {
                    await onSendReply(activeThread.threadId, replyDraft.trim());
                    setReplyDraft("");
                  }}
                  type="button"
                >
                  <CornerDownRight size={15} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="thread-record__empty">
            <p>Select a thread to view its messages.</p>
          </div>
        )}
      </section>
    </aside>
  );
}
