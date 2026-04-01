import { useQuery } from "@tanstack/react-query";
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  type LucideIcon,
  Pilcrow,
  Quote,
  Strikethrough,
} from "lucide-react";
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
import {
  type SelectionState,
  useCommentUiStore,
} from "../features/comments/state/commentUiStore";
import {
  type CommentThread,
  projectThreadEvent,
} from "../features/comments/state/threadProjector";
import {
  type EditorCommandName,
  type EditorFormatState,
  type EditorSelectionState,
  EditorSurface,
  type EditorSurfaceHandle,
} from "../features/document/components/EditorSurface";
import {
  clampLeftSidebarWidth,
  clampRightSidebarWidth,
} from "../features/workspace/layout/sidebarResize";
import { FileTree } from "../features/workspace/tree/FileTree";
import {
  findFirstWorkspaceDocumentId,
  reconcileExpandedDirectoryIds,
} from "../features/workspace/tree/fileTreeState";

type ResizeSide = "left" | "right";

interface ResizeState {
  readonly side: ResizeSide;
}

const defaultEditorFormatState: EditorFormatState = {
  paragraph: true,
  heading1: false,
  heading2: false,
  bulletList: false,
  orderedList: false,
  blockquote: false,
  bold: false,
  italic: false,
  strike: false,
  code: false,
};

const editorToolbarActions: readonly {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly commandName: EditorCommandName;
  readonly isActive: (state: EditorFormatState) => boolean;
}[] = [
  {
    label: "Paragraph",
    icon: Pilcrow,
    commandName: "setParagraph",
    isActive: (state) => state.paragraph,
  },
  {
    label: "Heading 1",
    icon: Heading1,
    commandName: "toggleHeading1",
    isActive: (state) => state.heading1,
  },
  {
    label: "Heading 2",
    icon: Heading2,
    commandName: "toggleHeading2",
    isActive: (state) => state.heading2,
  },
  {
    label: "Bold",
    icon: Bold,
    commandName: "toggleBold",
    isActive: (state) => state.bold,
  },
  {
    label: "Italic",
    icon: Italic,
    commandName: "toggleItalic",
    isActive: (state) => state.italic,
  },
  {
    label: "Strike",
    icon: Strikethrough,
    commandName: "toggleStrike",
    isActive: (state) => state.strike,
  },
  {
    label: "Bullet List",
    icon: List,
    commandName: "toggleBulletList",
    isActive: (state) => state.bulletList,
  },
  {
    label: "Ordered List",
    icon: ListOrdered,
    commandName: "toggleOrderedList",
    isActive: (state) => state.orderedList,
  },
  {
    label: "Quote",
    icon: Quote,
    commandName: "toggleBlockquote",
    isActive: (state) => state.blockquote,
  },
  {
    label: "Inline Code",
    icon: Code2,
    commandName: "toggleCode",
    isActive: (state) => state.code,
  },
];

export function AppShell() {
  const editorRef = useRef<EditorSurfaceHandle | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [expandedTreeItemIds, setExpandedTreeItemIds] = useState<string[]>([]);
  const [editorFormatState, setEditorFormatState] = useState<EditorFormatState>(
    defaultEditorFormatState,
  );
  const [leftRailWidth, setLeftRailWidth] = useState(272);
  const [rightRailWidth, setRightRailWidth] = useState(384);
  const [threads, dispatch] = useReducer(
    projectThreadEvent,
    [] as readonly CommentThread[],
  );
  const { activeThreadId, setActiveThreadId, setSelection } =
    useCommentUiStore();

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const bootstrapQuery = useQuery({
    queryKey: ["workspace-bootstrap"],
    queryFn: () => workspaceClient.getWorkspaceBootstrap(),
  });

  const documentQuery = useQuery({
    enabled: activeDocumentId !== null,
    queryKey: ["document", activeDocumentId],
    queryFn: async () => {
      if (!activeDocumentId) {
        throw new Error("No active document selected.");
      }

      return workspaceClient.openDocument(activeDocumentId);
    },
  });

  useEffect(() => {
    if (!bootstrapQuery.data || activeDocumentId) {
      return;
    }

    setActiveDocumentId(findFirstWorkspaceDocumentId(bootstrapQuery.data.tree));
  }, [activeDocumentId, bootstrapQuery.data]);

  useEffect(() => {
    if (!bootstrapQuery.data) {
      return;
    }

    setExpandedTreeItemIds((currentExpandedIds) => [
      ...reconcileExpandedDirectoryIds({
        tree: bootstrapQuery.data.tree,
        expandedIds: currentExpandedIds,
        activeDocumentId,
      }),
    ]);
  }, [activeDocumentId, bootstrapQuery.data]);

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
    if (!documentQuery.data) {
      return;
    }

    setMarkdown(documentQuery.data.markdown);
  }, [documentQuery.data]);

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

  const activeDocumentTitle = documentQuery.data?.title ?? "Loading document";

  const handleSelectionChange = (
    nextSelection: EditorSelectionState | null,
  ) => {
    const mappedSelection: SelectionState | null = nextSelection
      ? {
          text: nextSelection.text,
          threadId: null,
        }
      : null;
    setSelection(mappedSelection);
  };

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

  if (
    bootstrapQuery.isLoading ||
    (activeDocumentId !== null && documentQuery.isLoading)
  ) {
    return (
      <div className="app-shell app-shell--loading">Loading Magick...</div>
    );
  }

  if (bootstrapQuery.isError || !bootstrapQuery.data || documentQuery.isError) {
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
            activeDocumentId={activeDocumentId}
            expandedIds={expandedTreeItemIds}
            onExpandedIdsChange={setExpandedTreeItemIds}
            onOpenDocument={setActiveDocumentId}
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
        <section className="workspace__canvas">
          <div className="workspace__frame">
            <div
              className="workspace__toolbar"
              role="toolbar"
              aria-label="Text editing options"
            >
              {editorToolbarActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    aria-label={action.label}
                    className={`workspace__toolbar-button${
                      action.isActive(editorFormatState) ? " is-active" : ""
                    }`}
                    key={action.commandName}
                    onClick={() =>
                      editorRef.current?.runCommand(action.commandName)
                    }
                    type="button"
                  >
                    <Icon size={15} />
                  </button>
                );
              })}
            </div>
            <div className="workspace__document-scroll">
              <div
                className="workspace__document-title"
                title={activeDocumentTitle}
              >
                {activeDocumentTitle}
              </div>
              <EditorSurface
                ref={editorRef}
                markdown={markdown}
                onFormatStateChange={setEditorFormatState}
                onMarkdownChange={(nextMarkdown) => {
                  setMarkdown(nextMarkdown);
                  if (activeDocumentId) {
                    void workspaceClient.saveDocument(
                      activeDocumentId,
                      nextMarkdown,
                    );
                  }
                }}
                onSelectionChange={handleSelectionChange}
              />
            </div>
          </div>
        </section>
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
