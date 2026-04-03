// @vitest-environment jsdom

import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CommentSidebar } from "./CommentSidebar";

const threads = [
  {
    threadId: "thread_1",
    title: "Chat 1",
    status: "open",
    updatedAt: "2026-04-02T10:00:00.000Z",
    messages: [
      {
        id: "message_1",
        author: "human",
        body: "hello",
        createdAt: "2026-04-02T10:00:00.000Z",
        status: "complete",
      },
    ],
  },
  {
    threadId: "thread_2",
    title: "Chat 2",
    status: "resolved",
    updatedAt: "2026-04-02T10:01:00.000Z",
    messages: [],
  },
] as const;

describe("CommentSidebar", () => {
  it("shows the ledger by default and opens a thread on selection", () => {
    const handleActivateThread = vi.fn();

    render(
      <CommentSidebar
        activeThreadId={null}
        onActivateThread={handleActivateThread}
        onSendReply={vi.fn(async () => undefined)}
        onShowLedger={vi.fn()}
        onToggleResolved={vi.fn(async () => undefined)}
        threads={threads}
      />,
    );

    expect(screen.getByLabelText("Open Chat 1")).toBeTruthy();
    expect(screen.queryByLabelText("Open Chat 2")).toBeNull();
    expect(screen.queryByLabelText("Back to chats")).toBeNull();

    fireEvent.click(screen.getByLabelText("Open Chat 1"));

    expect(handleActivateThread).toHaveBeenCalledWith("thread_1");
  });

  it("shows a thread view with a way back to the ledger", () => {
    const handleShowLedger = vi.fn();

    render(
      <CommentSidebar
        activeThreadId="thread_1"
        onActivateThread={vi.fn()}
        onSendReply={vi.fn(async () => undefined)}
        onShowLedger={handleShowLedger}
        onToggleResolved={vi.fn(async () => undefined)}
        threads={threads}
      />,
    );

    expect(screen.getByText("Chat 1")).toBeTruthy();
    expect(screen.getByLabelText("Back to chats")).toBeTruthy();
    expect(screen.queryByLabelText("Open Chat 2")).toBeNull();

    fireEvent.click(screen.getByLabelText("Back to chats"));

    expect(handleShowLedger).toHaveBeenCalled();
  });

  it("toggles the ledger between open and resolved chats", () => {
    render(
      <CommentSidebar
        activeThreadId={null}
        onActivateThread={vi.fn()}
        onSendReply={vi.fn(async () => undefined)}
        onShowLedger={vi.fn()}
        onToggleResolved={vi.fn(async () => undefined)}
        threads={threads}
      />,
    );

    expect(screen.getByLabelText("Open Chat 1")).toBeTruthy();
    expect(screen.queryByLabelText("Open Chat 2")).toBeNull();

    fireEvent.click(screen.getByLabelText("Show resolved chats"));

    expect(screen.queryByLabelText("Open Chat 1")).toBeNull();
    expect(screen.getByLabelText("Open Chat 2")).toBeTruthy();
    expect(screen.getByLabelText("Show open chats")).toBeTruthy();
  });

  it("sends replies on Enter without requiring a send button", async () => {
    const handleSendReply = vi.fn(async () => undefined);

    render(
      <CommentSidebar
        activeThreadId="thread_1"
        onActivateThread={vi.fn()}
        onSendReply={handleSendReply}
        onShowLedger={vi.fn()}
        onToggleResolved={vi.fn(async () => undefined)}
        threads={threads}
      />,
    );

    const composer = screen.getByPlaceholderText("Write a response");
    fireEvent.change(composer, { target: { value: "New reply" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => {
      expect(handleSendReply).toHaveBeenCalledWith("thread_1", "New reply");
    });
  });

  it("does not send on Enter while IME composition is active", async () => {
    const handleSendReply = vi.fn(async () => undefined);

    render(
      <CommentSidebar
        activeThreadId="thread_1"
        onActivateThread={vi.fn()}
        onSendReply={handleSendReply}
        onShowLedger={vi.fn()}
        onToggleResolved={vi.fn(async () => undefined)}
        threads={threads}
      />,
    );

    const composer = screen.getByPlaceholderText("Write a response");
    fireEvent.change(composer, { target: { value: "Composing" } });
    const keyDownEvent = createEvent.keyDown(composer, {
      key: "Enter",
      keyCode: 229,
      which: 229,
    });
    Object.defineProperty(keyDownEvent, "isComposing", { value: true });
    fireEvent(composer, keyDownEvent);

    await waitFor(() => {
      expect(handleSendReply).not.toHaveBeenCalled();
    });
  });
});
