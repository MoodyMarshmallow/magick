import { useQuery } from "@tanstack/react-query";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { CommentSidebar } from "../features/comments/components/CommentSidebar";
import { workspaceClient } from "../features/comments/data/workspaceClient";
import { useCommentUiStore } from "../features/comments/state/commentUiStore";
import {
  type CommentThread,
  projectThreadEvent,
} from "../features/comments/state/threadProjector";
import { WorkspaceSurface } from "../features/workspace/components/WorkspaceSurface";
import {
  clampLeftSidebarWidth,
  clampRightSidebarWidth,
} from "../features/workspace/layout/sidebarResize";
import { useWorkspaceSessionStore } from "../features/workspace/state/workspaceSessionStore";
import type { WorkspaceDragItem } from "../features/workspace/state/workspaceSessionTypes";
import { FileTree } from "../features/workspace/tree/FileTree";
import {
  findFirstWorkspaceDocumentId,
  reconcileExpandedDirectoryIds,
} from "../features/workspace/tree/fileTreeState";

type ResizeSide = "left" | "right";

interface ResizeState {
  readonly side: ResizeSide;
}

export function AppShell() {
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

  const bootstrapQuery = useQuery({
    queryKey: ["workspace-bootstrap"],
    queryFn: () => workspaceClient.getWorkspaceBootstrap(),
  });

  useEffect(() => {
    if (!bootstrapQuery.data) {
      return;
    }

    setExpandedTreeItemIds((currentExpandedIds) => [
      ...reconcileExpandedDirectoryIds({
        tree: bootstrapQuery.data.tree,
        expandedIds: currentExpandedIds,
        activeDocumentId: focusedDocumentId,
      }),
    ]);
  }, [bootstrapQuery.data, focusedDocumentId]);

  useEffect(() => {
    if (!bootstrapQuery.data) {
      return;
    }

    dispatch({
      type: "snapshot.loaded",
      threads: bootstrapQuery.data.threads,
    });
    if (!activeThreadIdRef.current) {
      setActiveThreadId(bootstrapQuery.data.threads[0]?.threadId ?? null);
    }
  }, [bootstrapQuery.data, setActiveThreadId]);

  useEffect(() => {
    return workspaceClient.subscribe((event) => {
      dispatch(event);
    });
  }, []);

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
    setActiveThreadId(threadId);
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

  if (bootstrapQuery.isLoading) {
    return (
      <div className="app-shell app-shell--loading">Loading Magick...</div>
    );
  }

  if (bootstrapQuery.isError || !bootstrapQuery.data) {
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

        <section className="sidebar-section rail-section">
          <FileTree
            activeDocumentId={focusedDocumentId}
            expandedIds={expandedTreeItemIds}
            onExpandedIdsChange={setExpandedTreeItemIds}
            onOpenDocument={(documentId) => {
              useWorkspaceSessionStore
                .getState()
                .openDocument(documentId, { paneId: null, duplicate: false });
            }}
            onStartDragDocument={(documentId) => {
              setDragItem(documentId ? { type: "document", documentId } : null);
            }}
            tree={bootstrapQuery.data.tree}
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
          initialDocumentId={findFirstWorkspaceDocumentId(
            bootstrapQuery.data.tree,
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
        onSendReply={async (threadId: string, message: string) => {
          await workspaceClient.sendThreadMessage(threadId, message);
          setActiveThreadId(threadId);
        }}
        onToggleResolved={async (threadId: string) => {
          await workspaceClient.toggleThreadResolved(threadId);
        }}
      />
    </main>
  );
}
