import type { ProviderAuthState } from "@magick/contracts/provider";
import type { ServerPushEnvelope } from "@magick/contracts/ws";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
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
  collectWorkspaceTreePaths,
  findFirstWorkspaceFilePath,
  reconcileExpandedDirectoryIds,
} from "../features/workspace/tree/fileTreeState";

type ResizeSide = "left" | "right";

const defaultWorkspaceId = "workspace_default";
const defaultProviderKey = "codex";
const draftThreadId = "draft:new-chat";

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
  const loginPollRef = useRef<number | null>(null);
  const loginWindowRef = useRef<Window | null>(null);
  const { activeThreadId, setActiveThreadId } = useCommentUiStore();
  const draftThread: CommentThread = {
    threadId: draftThreadId,
    title: "New chat",
    status: "open",
    runtimeState: "idle",
    updatedAt: new Date(0).toISOString(),
    messages: [],
    toolActivities: [],
    pendingToolApproval: null,
  };
  const sidebarThreads =
    activeThreadId === draftThreadId ? [draftThread, ...threads] : threads;
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
  const fileTreeKey = fileBootstrapQuery.data
    ? collectWorkspaceTreePaths(fileBootstrapQuery.data.tree).join("|")
    : "workspace-tree";

  const threadBootstrapQuery = useQuery({
    queryKey: ["workspace-thread-bootstrap"],
    queryFn: () =>
      chatClient.getBootstrap({
        workspaceId: defaultWorkspaceId,
        ...(activeThreadId && activeThreadId !== draftThreadId
          ? { threadId: activeThreadId }
          : {}),
      }),
    refetchInterval: 2000,
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
      activeThreadIdRef.current !== draftThreadId &&
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
        if (
          event.auth.providerKey === defaultProviderKey &&
          event.auth.login.status !== "pending"
        ) {
          if (loginPollRef.current !== null) {
            window.clearInterval(loginPollRef.current);
            loginPollRef.current = null;
          }
          loginWindowRef.current = null;
        }
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
  const loginState = codexAuth?.login;
  const isLoginPending = loginState?.status === "pending";
  const showSidebarLogin = !isLoggedIn;

  const clearPendingLoginWatcher = useCallback(() => {
    if (loginPollRef.current !== null) {
      window.clearInterval(loginPollRef.current);
      loginPollRef.current = null;
    }
    loginWindowRef.current = null;
  }, []);

  useEffect(() => clearPendingLoginWatcher, [clearPendingLoginWatcher]);

  const handleAuthButtonClick = async () => {
    if (isLoggedIn) {
      clearPendingLoginWatcher();
      await chatClient.logout(defaultProviderKey);
      await queryClient.invalidateQueries({
        queryKey: ["workspace-thread-bootstrap"],
      });
      return;
    }

    if (loginState?.status === "pending" && loginState.loginId) {
      await chatClient.cancelLogin(defaultProviderKey, loginState.loginId);
      return;
    }

    const { loginId, popup } = await chatClient.startLogin(defaultProviderKey);
    loginWindowRef.current = popup;
    if (loginPollRef.current !== null) {
      window.clearInterval(loginPollRef.current);
    }

    loginPollRef.current = window.setInterval(() => {
      if (!loginWindowRef.current || !loginWindowRef.current.closed) {
        return;
      }

      clearPendingLoginWatcher();
      void chatClient
        .cancelLogin(defaultProviderKey, loginId)
        .catch(() => undefined)
        .finally(() => {
          void queryClient.invalidateQueries({
            queryKey: ["workspace-thread-bootstrap"],
          });
        });
    }, 500);
  };

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

        <header className="rail-header">
          <button
            className="flat-button rail-header__button"
            onClick={() => {
              void handleAuthButtonClick();
            }}
            type="button"
          >
            {isLoggedIn ? "logout" : isLoginPending ? "cancel login" : "login"}
          </button>
        </header>

        <section className="sidebar-section rail-section">
          <FileTree
            activeFilePath={focusedDocumentId}
            expandedIds={expandedTreeItemIds}
            key={fileTreeKey}
            onExpandedIdsChange={setExpandedTreeItemIds}
            onCreateDirectory={async (directoryPath) => {
              await localWorkspaceFileClient.createDirectory(directoryPath);
              await queryClient.invalidateQueries({
                queryKey: ["workspace-files-bootstrap"],
              });
            }}
            onCreateFile={async (directoryPath) => {
              const createdFile =
                await localWorkspaceFileClient.createFile(directoryPath);
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: ["workspace-files-bootstrap"],
                }),
                queryClient.invalidateQueries({
                  queryKey: ["document", createdFile.filePath],
                }),
              ]);
              useWorkspaceSessionStore
                .getState()
                .openDocument(createdFile.filePath, {
                  paneId: null,
                  duplicate: false,
                });
            }}
            onDeleteDirectory={async (directoryPath) => {
              const deletedEntry =
                await localWorkspaceFileClient.deleteDirectory(directoryPath);
              for (const deletedFilePath of deletedEntry.deletedFilePaths) {
                useWorkspaceSessionStore
                  .getState()
                  .closeDocument(deletedFilePath);
              }
              await queryClient.invalidateQueries({
                queryKey: ["workspace-files-bootstrap"],
              });
            }}
            onDeleteFile={async (filePath) => {
              const deletedEntry =
                await localWorkspaceFileClient.deleteFile(filePath);
              for (const deletedFilePath of deletedEntry.deletedFilePaths) {
                useWorkspaceSessionStore
                  .getState()
                  .closeDocument(deletedFilePath);
              }
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: ["workspace-files-bootstrap"],
                }),
                queryClient.invalidateQueries({
                  queryKey: ["document", filePath],
                }),
              ]);
            }}
            onOpenFile={(documentId) => {
              useWorkspaceSessionStore
                .getState()
                .openDocument(documentId, { paneId: null, duplicate: false });
            }}
            onRenameDirectory={async (directoryPath, nextName) => {
              const renamedDirectory =
                await localWorkspaceFileClient.renameDirectory(
                  directoryPath,
                  nextName,
                );
              for (const filePathChange of renamedDirectory.filePathChanges) {
                useWorkspaceSessionStore
                  .getState()
                  .renameDocument(
                    filePathChange.previousFilePath,
                    filePathChange.filePath,
                  );
              }
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: ["workspace-files-bootstrap"],
                }),
                ...renamedDirectory.filePathChanges.flatMap(
                  (filePathChange) => [
                    queryClient.invalidateQueries({
                      queryKey: ["document", filePathChange.previousFilePath],
                    }),
                    queryClient.invalidateQueries({
                      queryKey: ["document", filePathChange.filePath],
                    }),
                  ],
                ),
              ]);
            }}
            onRenameFile={async (filePath, nextName) => {
              const renamedFile = await localWorkspaceFileClient.renameFile(
                filePath,
                nextName,
              );
              useWorkspaceSessionStore
                .getState()
                .renameDocument(
                  renamedFile.previousFilePath,
                  renamedFile.filePath,
                );
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: ["workspace-files-bootstrap"],
                }),
                queryClient.invalidateQueries({
                  queryKey: ["document", renamedFile.previousFilePath],
                }),
                queryClient.invalidateQueries({
                  queryKey: ["document", renamedFile.filePath],
                }),
              ]);
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

      {showSidebarLogin ? (
        <aside className="comment-sidebar comment-sidebar--auth-gate">
          <button
            className="comment-sidebar__login-gate"
            onClick={() => {
              void handleAuthButtonClick();
            }}
            type="button"
          >
            {isLoginPending ? "cancel login" : "login"}
          </button>
        </aside>
      ) : (
        <CommentSidebar
          threads={sidebarThreads}
          activeThreadId={activeThreadId}
          activeThreadIsDraft={activeThreadId === draftThreadId}
          onActivateThread={handleSelectThread}
          onCreateThread={async () => {
            setActiveThreadId(draftThreadId);
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
            if (threadId === draftThreadId) {
              const thread = await chatClient.createThread({
                workspaceId: defaultWorkspaceId,
                providerKey: defaultProviderKey,
              });
              dispatch({
                type: "thread.loaded",
                thread,
              });
              setActiveThreadId(thread.threadId);
              await chatClient.sendThreadMessage(thread.threadId, message);
              const refreshedThread = await chatClient.openThread(
                thread.threadId,
              );
              dispatch({
                type: "thread.loaded",
                thread: refreshedThread,
              });
              return;
            }

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
      )}
    </main>
  );
}
