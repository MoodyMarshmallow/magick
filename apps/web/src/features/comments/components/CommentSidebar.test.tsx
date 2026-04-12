// @vitest-environment jsdom

import { maxThreadTitleLength } from "@magick/shared/threadTitle";
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
        channel: null,
        body: "hello",
        createdAt: "2026-04-02T10:00:00.000Z",
        status: "complete",
      },
    ],
    toolActivities: [],
    pendingToolApproval: null,
  },
  {
    threadId: "thread_2",
    title: "Chat 2",
    status: "resolved",
    runtimeState: "failed",
    updatedAt: "2026-04-02T10:01:00.000Z",
    messages: [],
    toolActivities: [],
    pendingToolApproval: null,
  },
];

const baseProps = {
  activeThreadId: null,
  onActivateThread: vi.fn(),
  onCreateThread: vi.fn(async () => undefined),
  onDeleteThread: vi.fn(async () => undefined),
  onRenameThread: vi.fn(async () => undefined),
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

  it("creates a new chat from the ledger footer", async () => {
    const onCreateThread = vi.fn(async () => undefined);

    render(<CommentSidebar {...baseProps} onCreateThread={onCreateThread} />);

    fireEvent.click(screen.getByLabelText("Create new chat"));

    await waitFor(() => {
      expect(onCreateThread).toHaveBeenCalled();
    });
  });

  it("creates a new chat from the trailing add zone", async () => {
    const onCreateThread = vi.fn(async () => undefined);

    render(<CommentSidebar {...baseProps} onCreateThread={onCreateThread} />);

    fireEvent.click(screen.getByLabelText("Create new chat from add zone"));

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

  it("renames a thread from the ledger actions menu", async () => {
    const handleRenameThread = vi.fn(async () => undefined);

    render(
      <CommentSidebar {...baseProps} onRenameThread={handleRenameThread} />,
    );

    fireEvent.click(screen.getByLabelText("More actions for Chat 1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByLabelText("Rename Chat 1");
    fireEvent.change(input, { target: { value: "Renamed chat" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(handleRenameThread).toHaveBeenCalledWith(
        "thread_1",
        "Renamed chat",
      );
    });
  });

  it("opens the ledger actions menu from the dots trigger without throwing", () => {
    render(<CommentSidebar {...baseProps} />);

    expect(() => {
      fireEvent.click(screen.getByLabelText("More actions for Chat 1"));
    }).not.toThrow();

    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("blocks overlong names while renaming", () => {
    render(<CommentSidebar {...baseProps} />);

    fireEvent.click(screen.getByLabelText("More actions for Chat 1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByLabelText("Rename Chat 1") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Short" } });
    fireEvent.change(input, {
      target: { value: "x".repeat(maxThreadTitleLength + 1) },
    });

    expect(input.value).toBe("Short");
  });

  it("deletes a thread from the ledger actions menu", async () => {
    const handleDeleteThread = vi.fn(async () => undefined);

    render(
      <CommentSidebar {...baseProps} onDeleteThread={handleDeleteThread} />,
    );

    fireEvent.click(screen.getByLabelText("More actions for Chat 1"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(handleDeleteThread).toHaveBeenCalledWith("thread_1");
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

  it("renames the active thread in place from the header title", async () => {
    const handleRenameThread = vi.fn(async () => undefined);

    render(
      <CommentSidebar
        {...baseProps}
        activeThreadId="thread_1"
        onRenameThread={handleRenameThread}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Chat 1" }));

    const input = screen.getByLabelText("Rename Chat 1");
    fireEvent.change(input, { target: { value: "Renamed in place" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(handleRenameThread).toHaveBeenCalledWith(
        "thread_1",
        "Renamed in place",
      );
    });
  });

  it("disables persisted-thread actions for a draft active thread", () => {
    const handleRenameThread = vi.fn(async () => undefined);
    const handleToggleResolved = vi.fn(async () => undefined);
    const draftThreads: readonly CommentThread[] = [
      {
        threadId: "draft:new-chat",
        title: "New chat",
        status: "open",
        runtimeState: "idle",
        updatedAt: "1970-01-01T00:00:00.000Z",
        messages: [],
        toolActivities: [],
        pendingToolApproval: null,
      },
    ];

    render(
      <CommentSidebar
        {...baseProps}
        activeThreadId="draft:new-chat"
        activeThreadIsDraft
        onRenameThread={handleRenameThread}
        onToggleResolved={handleToggleResolved}
        threads={draftThreads}
      />,
    );

    const titleButton = screen.getByRole("button", { name: "New chat" });
    const statusButton = screen.getByLabelText("Resolve New chat");

    expect(titleButton.getAttribute("disabled")).not.toBeNull();
    expect(statusButton.getAttribute("disabled")).not.toBeNull();

    fireEvent.click(titleButton);
    fireEvent.click(statusButton);

    expect(handleRenameThread).not.toHaveBeenCalled();
    expect(handleToggleResolved).not.toHaveBeenCalled();
  });

  it("renders markdown formatting and LaTeX in active thread messages", () => {
    const markdownThreads: readonly CommentThread[] = [
      {
        threadId: "thread_math",
        title: "Math chat",
        status: "open",
        runtimeState: "idle",
        updatedAt: "2026-04-02T10:00:00.000Z",
        messages: [
          {
            id: "message_math",
            author: "ai",
            channel: "final",
            body: "**bold**\n\n- item one\n- item two\n\n`inline code` and [link](https://example.com) and $E = mc^2$",
            createdAt: "2026-04-02T10:00:00.000Z",
            status: "complete",
          },
        ],
        toolActivities: [],
        pendingToolApproval: null,
      },
    ];

    const { container } = render(
      <CommentSidebar
        {...baseProps}
        activeThreadId="thread_math"
        threads={markdownThreads}
      />,
    );

    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(container.querySelector("ul li")?.textContent).toBe("item one");
    expect(screen.getByText("inline code").tagName).toBe("CODE");
    expect(
      screen.getByRole("link", { name: "link" }).getAttribute("href"),
    ).toBe("https://example.com");
    expect(container.querySelector(".katex")).toBeTruthy();
  });

  it("renders tool activity and inline diffs inside the active thread", () => {
    const toolThreads: readonly CommentThread[] = [
      {
        threadId: "thread_tool",
        title: "Tool chat",
        status: "open",
        runtimeState: "idle",
        updatedAt: "2026-04-02T10:00:00.000Z",
        messages: [],
        toolActivities: [
          {
            toolCallId: "tool_1",
            toolName: "apply_patch",
            title: "Patched notes.md",
            status: "completed",
            argsPreview: '{"path":"notes.md"}',
            resultPreview: null,
            path: "notes.md",
            url: null,
            diff: {
              kind: "updated",
              path: "notes.md",
              truncated: false,
              hunks: [
                {
                  oldStart: 1,
                  oldLines: 1,
                  newStart: 1,
                  newLines: 1,
                  lines: ["-world", "+magick"],
                },
              ],
            },
            error: null,
            createdAt: "2026-04-02T10:00:00.000Z",
            updatedAt: "2026-04-02T10:00:01.000Z",
          },
        ],
        pendingToolApproval: null,
      },
    ];

    render(
      <CommentSidebar
        {...baseProps}
        activeThreadId="thread_tool"
        threads={toolThreads}
      />,
    );

    fireEvent.click(screen.getByText("Details"));

    expect(screen.getByText("Patched notes.md")).toBeTruthy();
    const diffBlock = screen.getByText(
      (content) =>
        content.includes("--- notes.md") &&
        content.includes("+++ notes.md") &&
        content.includes("-world") &&
        content.includes("+magick"),
    );
    expect(diffBlock).toBeTruthy();
  });
});
