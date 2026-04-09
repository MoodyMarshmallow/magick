// @vitest-environment jsdom

import type { ThreadViewModel } from "@magick/contracts/chat";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { chatClient } from "../features/comments/data/chatClient";
import { useCommentUiStore } from "../features/comments/state/commentUiStore";
import { localWorkspaceFileClient } from "../features/workspace/data/localWorkspaceFileClient";
import { AppShell } from "./AppShell";

vi.mock("../features/workspace/components/WorkspaceSurface", () => ({
  WorkspaceSurface: () => <div data-testid="workspace-surface" />,
}));

vi.mock("../features/workspace/tree/FileTree", () => ({
  FileTree: () => <div data-testid="file-tree" />,
}));

vi.mock("../features/workspace/data/localWorkspaceFileClient", () => ({
  localWorkspaceFileClient: {
    supportsPushWorkspaceEvents: false,
    getWorkspaceBootstrap: vi.fn(),
    onWorkspaceEvent: vi.fn(() => () => undefined),
  },
}));

vi.mock("../features/comments/data/chatClient", () => ({
  chatClient: {
    getBootstrap: vi.fn(),
    createThread: vi.fn(),
    openThread: vi.fn(),
    deleteThread: vi.fn(),
    renameThread: vi.fn(),
    sendThreadMessage: vi.fn(),
    resolveThread: vi.fn(),
    reopenThread: vi.fn(),
    startLogin: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  },
}));

const createdThread: ThreadViewModel = {
  threadId: "thread_created",
  workspaceId: "workspace_default",
  providerKey: "codex",
  providerSessionId: "session_created",
  title: "New chat",
  resolutionState: "open",
  runtimeState: "idle",
  messages: [],
  toolActivities: [],
  pendingToolApproval: null,
  activeTurnId: null,
  latestSequence: 0,
  lastError: null,
  lastUserMessageAt: null,
  lastAssistantMessageAt: null,
  latestActivityAt: "2026-04-09T00:00:00.000Z",
  updatedAt: "2026-04-09T00:00:00.000Z",
};

describe("AppShell", () => {
  beforeEach(() => {
    useCommentUiStore.setState(useCommentUiStore.getInitialState());

    vi.mocked(localWorkspaceFileClient.getWorkspaceBootstrap).mockResolvedValue(
      {
        workspaceRoot: "/workspace",
        tree: [],
      },
    );

    vi.mocked(chatClient.getBootstrap).mockResolvedValue({
      threads: [],
      activeThread: null,
      providerAuth: {
        codex: {
          providerKey: "codex",
          requiresOpenaiAuth: true,
          account: null,
          activeLoginId: null,
        },
      },
    });
    vi.mocked(chatClient.createThread).mockResolvedValue(createdThread);
    vi.mocked(chatClient.sendThreadMessage).mockResolvedValue(undefined);
  });

  it("creates a new thread only when the first draft message is sent", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>,
    );

    await screen.findByLabelText("Create new chat");

    fireEvent.click(screen.getByLabelText("Create new chat"));

    expect(chatClient.createThread).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Write a response")).toBeTruthy();

    const composer = screen.getByPlaceholderText("Write a response");
    fireEvent.change(composer, { target: { value: "First draft message" } });
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => {
      expect(chatClient.createThread).toHaveBeenCalledWith({
        workspaceId: "workspace_default",
        providerKey: "codex",
      });
      expect(chatClient.sendThreadMessage).toHaveBeenCalledWith(
        "thread_created",
        "First draft message",
      );
    });

    expect(
      vi.mocked(chatClient.createThread).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(chatClient.sendThreadMessage).mock.invocationCallOrder[0] ?? 0,
    );
  });
});
