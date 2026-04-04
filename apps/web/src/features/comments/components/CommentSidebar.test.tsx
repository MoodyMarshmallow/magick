// @vitest-environment jsdom

import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { CommentThread } from "../state/threadProjector";
import { CommentSidebar } from "./CommentSidebar";

const threads: readonly CommentThread[] = [
  {
    threadId: "thread_1",
    title: "Chat 1",
    status: "open",
    runtimeState: "idle",
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
    runtimeState: "failed",
    updatedAt: "2026-04-02T10:01:00.000Z",
    messages: [],
  },
];

const baseProps = {
  activeThreadId: null,
  isLoggedIn: false,
  isLoginPending: false,
  onActivateThread: vi.fn(),
  onCreateThread: vi.fn(async () => undefined),
  onLogin: vi.fn(async () => undefined),
  onSendReply: vi.fn(async () => undefined),
  onShowLedger: vi.fn(),
  onToggleResolved: vi.fn(async () => undefined),
  threads,
};

describe("CommentSidebar", () => {
  it("shows the ledger by default and opens a thread on selection", () => {
    const handleActivateThread = vi.fn();

    render(
      <CommentSidebar {...baseProps} onActivateThread={handleActivateThread} />,
    );

    expect(screen.getByLabelText("Open Chat 1")).toBeTruthy();
    expect(screen.queryByLabelText("Open Chat 2")).toBeNull();

    fireEvent.click(screen.getByLabelText("Open Chat 1"));

    expect(handleActivateThread).toHaveBeenCalledWith("thread_1");
  });

  it("shows a login button and disables it when logged in", () => {
    const { rerender } = render(<CommentSidebar {...baseProps} />);

    const loginButton = screen.getByRole("button", { name: "log in" });
    expect(loginButton).toBeTruthy();
    expect(loginButton.hasAttribute("disabled")).toBe(false);

    rerender(<CommentSidebar {...baseProps} isLoggedIn />);

    expect(
      screen
        .getByRole("button", { name: "logged in" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("creates a new chat from the ledger footer", async () => {
    const onCreateThread = vi.fn(async () => undefined);

    render(<CommentSidebar {...baseProps} onCreateThread={onCreateThread} />);

    fireEvent.click(screen.getByLabelText("Create new chat"));

    await waitFor(() => {
      expect(onCreateThread).toHaveBeenCalled();
    });
  });

  it("toggles the ledger between open and resolved chats", () => {
    render(<CommentSidebar {...baseProps} />);

    expect(screen.getByLabelText("Open Chat 1")).toBeTruthy();
    expect(screen.queryByLabelText("Open Chat 2")).toBeNull();

    fireEvent.click(screen.getByLabelText("Show resolved chats"));

    expect(screen.queryByLabelText("Open Chat 1")).toBeNull();
    expect(screen.getByLabelText("Open Chat 2")).toBeTruthy();
  });

  it("allows resolving a thread directly from the ledger", async () => {
    const handleToggleResolved = vi.fn(async () => undefined);

    render(
      <CommentSidebar {...baseProps} onToggleResolved={handleToggleResolved} />,
    );

    fireEvent.click(screen.getByLabelText("Resolve Chat 1"));

    await waitFor(() => {
      expect(handleToggleResolved).toHaveBeenCalledWith("thread_1");
    });
  });

  it("sends replies on Enter without requiring a send button", async () => {
    const handleSendReply = vi.fn(async () => undefined);

    render(
      <CommentSidebar
        {...baseProps}
        activeThreadId="thread_1"
        onSendReply={handleSendReply}
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
        {...baseProps}
        activeThreadId="thread_1"
        onSendReply={handleSendReply}
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
