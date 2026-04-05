import type { ProviderAuthState } from "@magick/contracts/provider";
import type { ServerPushEnvelope } from "@magick/contracts/ws";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { CommentSidebar } from "../features/comments/components/CommentSidebar";
import { chatClient } from "../features/comments/data/chatClient";
import { useCommentUiStore } from "../features/comments/state/commentUiStore";
import {
  type CommentThread,
  projectThreadEvent,
} from "../features/comments/state/threadProjector";
import { WorkspaceSurface } from "../features/workspace/components/WorkspaceSurface";
import { localWorkspaceFileClient } from "../features/workspace/data/localWorkspaceFileClient";
import { applyWorkspaceFileEvent } from "../features/workspace/data/workspaceFileEvents";
import {
  clampLeftSidebarWidth,
  clampRightSidebarWidth,
} from "../features/workspace/layout/sidebarResize";
import { useWorkspaceSessionStore } from "../features/workspace/state/workspaceSessionStore";
import type { WorkspaceDragItem } from "../features/workspace/state/workspaceSessionTypes";
import { FileTree } from "../features/workspace/tree/FileTree";
import {
  collectWorkspaceFilePaths,
  findFirstWorkspaceFilePath,
  reconcileExpandedDirectoryIds,
} from "../features/workspace/tree/fileTreeState";

type ResizeSide = "left" | "right";

const defaultWorkspaceId = "workspace_default";
const defaultProviderKey = "codex";

interface ResizeState {
  readonly side: ResizeSide;
}

export function AppShell() {
  const queryClient = useQueryClient();
  const resizeStateRef = useRef<ResizeState | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const [dragItem, setDragItem] = useState<WorkspaceDragItem | null>(null);
  const [expandedTreeItemIds, setExpandedTreeItemIds] = useState<string[]>([]);
  const [leftRailWidth, setLeftRailWidth] = useState(272);
  const [rightRailWidth, setRightRailWidth] = useState(384);
  const [threads, dispatch] = useReducer(
    projectThreadEvent,
    [] as readonly CommentThread[],
  );
  const [providerAuthByKey, setProviderAuthByKey] = useState<
    Record<string, ProviderAuthState>
  >({});
  const { activeThreadId, setActiveThreadId } = useCommentUiStore();
  const focusedDocumentId = useWorkspaceSessionStore((state) =>
    state.focusedTabId
      ? (state.tabsById[state.focusedTabId]?.documentId ?? null)
      : null,
  );
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    document.body.classList.toggle("is-workspace-dragging", dragItem !== null);

    return () => {
      document.body.classList.remove("is-workspace-dragging");
    };
  }, [dragItem]);

  const fileBootstrapQuery = useQuery({
    queryKey: ["workspace-files-bootstrap"],
    queryFn: () => localWorkspaceFileClient.getWorkspaceBootstrap(),
    refetchInterval: localWorkspaceFileClient.supportsPushWorkspaceEvents
      ? false
      : 2000,
  });

  const threadBootstrapQuery = useQuery({
    queryKey: ["workspace-thread-bootstrap"],
    queryFn: () =>
      chatClient.getBootstrap({
        workspaceId: defaultWorkspaceId,
        ...(activeThreadId ? { threadId: activeThreadId } : {}),
      }),
  });

  useEffect(() => {
    if (!fileBootstrapQuery.data) {
      return;
    }

    setExpandedTreeItemIds((currentExpandedIds) => [
      ...reconcileExpandedDirectoryIds({
        tree: fileBootstrapQuery.data.tree,
        expandedIds: currentExpandedIds,
        activeFilePath: focusedDocumentId,
      }),
    ]);
  }, [fileBootstrapQuery.data, focusedDocumentId]);

  useEffect(() => {
    if (!fileBootstrapQuery.data) {
      return;
    }

    const activeFilePaths = new Set(
      collectWorkspaceFilePaths(fileBootstrapQuery.data.tree),
    );
    const workspaceState = useWorkspaceSessionStore.getState();
    for (const [tabId, tab] of Object.entries(workspaceState.tabsById)) {
      if (!activeFilePaths.has(tab.documentId)) {
        workspaceState.closeTab(tabId);
      }
    }
  }, [fileBootstrapQuery.data]);

  useEffect(() => {
    return localWorkspaceFileClient.onWorkspaceEvent((event) => {
      void applyWorkspaceFileEvent(queryClient, event);
    });
  }, [queryClient]);

  useEffect(() => {
    if (!threadBootstrapQuery.data) {
      return;
    }

    dispatch({
      type: "snapshot.loaded",
      threads: threadBootstrapQuery.data.threads,
      activeThread: threadBootstrapQuery.data.activeThread,
    });
    setProviderAuthByKey(threadBootstrapQuery.data.providerAuth);
    if (
      activeThreadIdRef.current &&
      !threadBootstrapQuery.data.threads.some(
        (thread) => thread.threadId === activeThreadIdRef.current,
      )
    ) {
      setActiveThreadId(null);
    }
  }, [threadBootstrapQuery.data, setActiveThreadId]);

  useEffect(() => {
    return chatClient.subscribe((event: ServerPushEnvelope) => {
      if (event.channel === "orchestration.domainEvent") {
        dispatch({
          type: "domain.event",
          threadId: event.threadId,
          event: event.event,
        });
        return;
      }

      if (event.channel === "thread.deleted") {
        if (event.workspaceId !== defaultWorkspaceId) {
          return;
        }

        dispatch({
          type: "thread.deleted",
          threadId: event.threadId,
        });
        if (activeThreadIdRef.current === event.threadId) {
          setActiveThreadId(null);
        }
        return;
      }

      if (event.channel === "provider.authStateChanged") {
        setProviderAuthByKey((current) => ({
          ...current,
          [event.auth.providerKey]: event.auth,
        }));
      }
    });
  }, [setActiveThreadId]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      if (resizeState.side === "left") {
        setLeftRailWidth(
          clampLeftSidebarWidth({
            viewportWidth: window.innerWidth,
            nextWidth: event.clientX,
            rightSidebarWidth: rightRailWidth,
          }),
        );
        return;
      }

      setRightRailWidth(
        clampRightSidebarWidth({
          viewportWidth: window.innerWidth,
          nextWidth: window.innerWidth - event.clientX,
          leftSidebarWidth: leftRailWidth,
        }),
      );
    };

    const handlePointerUp = () => {
      clearResizeState();
    };

    const handlePointerCancel = () => {
      clearResizeState();
    };

    const handleWindowBlur = () => {
      clearResizeState();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [leftRailWidth, rightRailWidth]);

  const handleSelectThread = (threadId: string) => {
    void chatClient.openThread(threadId).then((thread) => {
      dispatch({
        type: "thread.loaded",
        thread,
      });
    });
    setActiveThreadId(threadId);
  };

  const codexAuth = providerAuthByKey[defaultProviderKey] ?? null;
  const isLoggedIn = codexAuth?.account != null;
  const isLoginPending = codexAuth?.activeLoginId != null;

  const clearResizeState = () => {
    resizeStateRef.current = null;
    document.body.classList.remove("is-resizing-sidebars");
  };

  const handleResizeStart = (
    event: ReactPointerEvent<HTMLDivElement>,
    side: ResizeSide,
  ) => {
    resizeStateRef.current = { side };
    document.body.classList.add("is-resizing-sidebars");
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  if (fileBootstrapQuery.isLoading || threadBootstrapQuery.isLoading) {
    return (
      <div className="app-shell app-shell--loading">Loading Magick...</div>
    );
  }

  if (
    fileBootstrapQuery.isError ||
    !fileBootstrapQuery.data ||
    threadBootstrapQuery.isError ||
    !threadBootstrapQuery.data
  ) {
    return (
      <div className="app-shell app-shell--loading">
        Failed to load the document workspace.
      </div>
    );
  }

  const shellStyle = {
    "--left-rail-width": `${leftRailWidth}px`,
    "--right-rail-width": `${rightRailWidth}px`,
  } as CSSProperties;

  return (
    <main className="app-shell app-shell--resizable" style={shellStyle}>
      <aside className="left-rail">
        {/* <header className="masthead">
          <div className="masthead__sigil" aria-hidden="true">
            <MoonStar size={18} />
            <Asterisk size={18} />
          </div>
          <div>
            <p className="eyebrow">Magick</p>
            <h1>Digital review chamber</h1>
            <p className="masthead__copy">
              A raw document console where every comment opens a durable thread.
            </p>
          </div>
        </header> */}

        {/* <AuthStatus /> */}

        <header className="rail-header">
          <button
            className="flat-button rail-header__button"
            disabled={isLoggedIn || isLoginPending}
            onClick={async () => {
              await chatClient.startLogin(defaultProviderKey);
            }}
            type="button"
          >
            {isLoggedIn ? "logged in" : "log in"}
          </button>
        </header>

        <section className="sidebar-section rail-section">
          <FileTree
            activeFilePath={focusedDocumentId}
            expandedIds={expandedTreeItemIds}
            onExpandedIdsChange={setExpandedTreeItemIds}
            onOpenFile={(documentId) => {
              useWorkspaceSessionStore
                .getState()
                .openDocument(documentId, { paneId: null, duplicate: false });
            }}
            onStartDragFile={(documentId) => {
              setDragItem(documentId ? { type: "document", documentId } : null);
            }}
            tree={fileBootstrapQuery.data.tree}
          />
        </section>
      </aside>

      <div
        aria-hidden="true"
        className="sidebar-resizer sidebar-resizer--left"
        onLostPointerCapture={clearResizeState}
        onPointerCancel={clearResizeState}
        onPointerDown={(event) => handleResizeStart(event, "left")}
        onPointerUp={clearResizeState}
      />

      <section className="workspace">
        <WorkspaceSurface
          dragItem={dragItem}
          initialDocumentId={findFirstWorkspaceFilePath(
            fileBootstrapQuery.data.tree,
          )}
          onDragItemChange={setDragItem}
        />
      </section>

      <div
        aria-hidden="true"
        className="sidebar-resizer sidebar-resizer--right"
        onLostPointerCapture={clearResizeState}
        onPointerCancel={clearResizeState}
        onPointerDown={(event) => handleResizeStart(event, "right")}
        onPointerUp={clearResizeState}
      />

      <CommentSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        onActivateThread={handleSelectThread}
        onCreateThread={async () => {
          const thread = await chatClient.createThread({
            workspaceId: defaultWorkspaceId,
            providerKey: defaultProviderKey,
          });
          dispatch({
            type: "thread.loaded",
            thread,
          });
          setActiveThreadId(thread.threadId);
        }}
        onDeleteThread={async (threadId: string) => {
          await chatClient.deleteThread(threadId);
          dispatch({
            type: "thread.deleted",
            threadId,
          });
          if (activeThreadIdRef.current === threadId) {
            setActiveThreadId(null);
          }
        }}
        onRenameThread={async (threadId: string, title: string) => {
          const thread = await chatClient.renameThread(threadId, title);
          dispatch({
            type: "thread.loaded",
            thread,
          });
        }}
        onShowLedger={() => setActiveThreadId(null)}
        onSendReply={async (threadId: string, message: string) => {
          await chatClient.sendThreadMessage(threadId, message);
          setActiveThreadId(threadId);
        }}
        onToggleResolved={async (threadId: string) => {
          const thread = threads.find(
            (candidate) => candidate.threadId === threadId,
          );
          const updatedThread =
            thread?.status === "resolved"
              ? await chatClient.reopenThread(threadId)
              : await chatClient.resolveThread(threadId);
          dispatch({
            type: "thread.loaded",
            thread: updatedThread,
          });
        }}
      />
    </main>
  );
}
