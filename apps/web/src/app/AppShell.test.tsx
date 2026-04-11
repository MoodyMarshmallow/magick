// @vitest-environment jsdom

import type { ThreadViewModel } from "@magick/contracts/chat";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { chatClient } from "../features/comments/data/chatClient";
import { useCommentUiStore } from "../features/comments/state/commentUiStore";
import { localWorkspaceFileClient } from "../features/workspace/data/localWorkspaceFileClient";
import { AppShell } from "./AppShell";

const threadSummary = {
  threadId: "thread_1",
  workspaceId: "workspace_default",
  providerKey: "codex",
  title: "Backend chat",
  resolutionState: "open",
  runtimeState: "idle",
  latestSequence: 1,
  latestActivityAt: "2026-04-09T00:00:00.000Z",
  updatedAt: "2026-04-09T00:00:00.000Z",
} as const;

const idleLoginState = {
  status: "idle",
  loginId: null,
  authUrl: null,
  startedAt: null,
  expiresAt: null,
  error: null,
} as const;

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
    cancelLogin: vi.fn(),
    logout: vi.fn(),
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

const renamedThread: ThreadViewModel = {
  ...createdThread,
  title: "Generated title",
  updatedAt: "2026-04-09T00:00:01.000Z",
};

describe("AppShell", () => {
  beforeEach(() => {
    vi.useRealTimers();
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
          account: {
            type: "chatgpt",
            email: "user@example.com",
            planType: null,
          },
          login: idleLoginState,
        },
      },
    });
    vi.mocked(chatClient.createThread).mockResolvedValue(createdThread);
    vi.mocked(chatClient.openThread).mockResolvedValue(renamedThread);
    vi.mocked(chatClient.sendThreadMessage).mockResolvedValue(undefined);
    vi.mocked(chatClient.startLogin).mockResolvedValue({
      loginId: "login_1",
      popup: null,
    });
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
      expect(chatClient.openThread).toHaveBeenCalledWith("thread_created");
    });

    expect(
      vi.mocked(chatClient.createThread).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(chatClient.sendThreadMessage).mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      vi.mocked(chatClient.sendThreadMessage).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(chatClient.openThread).mock.invocationCallOrder[0] ?? 0,
    );

    await screen.findByRole("button", { name: "Generated title" });
  });

  it("shows a full sidebar login gate when Codex auth is missing", async () => {
    vi.mocked(chatClient.getBootstrap).mockResolvedValueOnce({
      threads: [],
      activeThread: null,
      providerAuth: {
        codex: {
          providerKey: "codex",
          requiresOpenaiAuth: true,
          account: null,
          login: idleLoginState,
        },
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>,
    );

    expect(
      (await screen.findAllByRole("button", { name: "login" })).length,
    ).toBe(2);
    expect(screen.queryByLabelText("Create new chat")).toBeNull();
  });

  it("shows logout when Codex auth is present and logs out on click", async () => {
    vi.mocked(chatClient.getBootstrap).mockResolvedValueOnce({
      threads: [],
      activeThread: null,
      providerAuth: {
        codex: {
          providerKey: "codex",
          requiresOpenaiAuth: true,
          account: {
            type: "chatgpt",
            email: "user@example.com",
            planType: null,
          },
          login: idleLoginState,
        },
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>,
    );

    const logoutButton = await screen.findByRole("button", { name: "logout" });
    fireEvent.click(logoutButton);

    await waitFor(() => {
      expect(chatClient.logout).toHaveBeenCalledWith("codex");
    });
  });

  it("cancels a pending login when retrying login from a signed-out pending state", async () => {
    vi.mocked(chatClient.getBootstrap).mockResolvedValueOnce({
      threads: [],
      activeThread: null,
      providerAuth: {
        codex: {
          providerKey: "codex",
          requiresOpenaiAuth: true,
          account: null,
          login: {
            status: "pending",
            loginId: "login_1",
            authUrl: "https://chatgpt.com/login",
            startedAt: "2026-04-09T00:00:00.000Z",
            expiresAt: "2026-04-09T00:05:00.000Z",
            error: null,
          },
        },
      },
    });
    vi.mocked(chatClient.startLogin).mockResolvedValueOnce({
      loginId: "login_2",
      popup: null,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>,
    );

    const cancelButtons = await screen.findAllByRole("button", {
      name: "cancel login",
    });
    const cancelButton = cancelButtons[0];
    if (!cancelButton) {
      throw new Error("Expected cancel login button.");
    }
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(chatClient.cancelLogin).toHaveBeenCalledWith("codex", "login_1");
      expect(chatClient.startLogin).not.toHaveBeenCalled();
    });
  });

  it("reconciles the visible chat list back to backend bootstrap state", async () => {
    vi.mocked(chatClient.getBootstrap)
      .mockResolvedValueOnce({
        threads: [threadSummary],
        activeThread: null,
        providerAuth: {
          codex: {
            providerKey: "codex",
            requiresOpenaiAuth: true,
            account: {
              type: "chatgpt",
              email: "user@example.com",
              planType: null,
            },
            login: idleLoginState,
          },
        },
      })
      .mockResolvedValue({
        threads: [],
        activeThread: null,
        providerAuth: {
          codex: {
            providerKey: "codex",
            requiresOpenaiAuth: true,
            account: {
              type: "chatgpt",
              email: "user@example.com",
              planType: null,
            },
            login: idleLoginState,
          },
        },
      });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: "Open Backend chat" });

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["workspace-thread-bootstrap"],
      });
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Open Backend chat" }),
      ).toBeNull();
    });
  });
});
