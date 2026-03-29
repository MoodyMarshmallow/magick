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

  return (
    <aside className="comment-sidebar">
      <header className="comment-sidebar__header">
        <h2>Threads</h2>
        <p>Open a thread to view the full chat history for this document.</p>
      </header>

      <section className="sidebar-section thread-ledger">
        <div className="sidebar-section__header thread-ledger__header">
          <span>Thread list</span>
          <span>{threads.length}</span>
        </div>
        <div className="thread-ledger__items">
          {threads.map((thread) => (
            <article
              key={thread.threadId}
              className={`thread-entry${
                thread.threadId === activeThreadId ? " is-active" : ""
              }`}
            >
              <button
                className="thread-entry__summary"
                onClick={() => onActivateThread(thread.threadId)}
                type="button"
              >
                <div className="thread-entry__sigil">
                  {thread.status === "open" ? (
                    <Circle size={14} />
                  ) : (
                    <CircleDashed size={14} />
                  )}
                </div>
                <div className="thread-entry__body">
                  <strong>{thread.title}</strong>
                  <span>{thread.threadId}</span>
                  <p>{thread.messages.at(-1)?.body ?? "No messages yet."}</p>
                </div>
              </button>

              {thread.threadId === activeThreadId ? (
                <div className="thread-entry__detail">
                  <div className="thread-record__messages">
                    {thread.messages.map((message) => (
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
                        className="flat-button flat-button--accent"
                        disabled={!replyDraft.trim()}
                        onClick={async () => {
                          await onSendReply(thread.threadId, replyDraft.trim());
                          setReplyDraft("");
                        }}
                        type="button"
                      >
                        <CornerDownRight size={15} />
                        respond
                      </button>
                    </div>
                    <div className="thread-entry__actions">
                      <button
                        className="flat-button"
                        onClick={() => onToggleResolved(thread.threadId)}
                        type="button"
                      >
                        {thread.status === "open" ? "resolve" : "reopen"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}
