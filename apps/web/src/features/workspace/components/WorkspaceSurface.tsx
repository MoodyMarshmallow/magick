import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type WheelEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { appIconSize } from "../../../app/appIconSize";
import { workspaceClient } from "../../comments/data/workspaceClient";
import {
  type SelectionState,
  useCommentUiStore,
} from "../../comments/state/commentUiStore";
import {
  type EditorCommandName,
  type EditorFormatState,
  type EditorHeadingLevel,
  type EditorSelectionState,
  EditorSurface,
  type EditorSurfaceHandle,
} from "../../document/components/EditorSurface";
import { useWorkspaceSessionStore } from "../state/workspaceSessionStore";
import type {
  WorkspaceDragItem,
  WorkspaceDropPosition,
  WorkspaceLeafPane,
  WorkspacePaneNode,
  WorkspaceSplitPane,
  WorkspaceTabId,
} from "../state/workspaceSessionTypes";
import { WorkspaceHeadingControl } from "./WorkspaceHeadingControl";
import { resolveBodyPaneSnap, resolveTabStripSnap } from "./workspacePaneSnap";
import { isNoopTabInsertion } from "./workspaceTabInsertion";
import {
  defaultEditorFormatState,
  editorToolbarActions,
} from "./workspaceToolbarConfig";

interface WorkspaceSurfaceProps {
  readonly initialDocumentId: string | null;
  readonly dragItem: WorkspaceDragItem | null;
  readonly onDragItemChange: (item: WorkspaceDragItem | null) => void;
}

interface WorkspaceOverlayRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly variant: "tab-insert" | "split-top";
}

const isLeavingForChild = (event: DragEvent<HTMLElement>): boolean => {
  const nextTarget = event.relatedTarget;
  return nextTarget instanceof Node && event.currentTarget.contains(nextTarget);
};

interface DocumentEditorHostProps {
  readonly documentId: string;
  readonly paneId: string;
  readonly registerEditor: (
    paneId: string,
    editor: EditorSurfaceHandle | null,
  ) => void;
  readonly onFormatStateChange: (
    paneId: string,
    state: EditorFormatState,
  ) => void;
}

function DocumentEditorHost({
  documentId,
  paneId,
  registerEditor,
  onFormatStateChange,
}: DocumentEditorHostProps) {
  const editorRef = useRef<EditorSurfaceHandle | null>(null);
  const draft = useWorkspaceSessionStore(
    (state) => state.draftsByDocumentId[documentId] ?? null,
  );
  const hydrateDocument = useWorkspaceSessionStore(
    (state) => state.hydrateDocument,
  );
  const updateDraft = useWorkspaceSessionStore((state) => state.updateDraft);
  const markSaved = useWorkspaceSessionStore((state) => state.markSaved);
  const setSelection = useCommentUiStore((state) => state.setSelection);

  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => workspaceClient.openDocument(documentId),
  });

  useEffect(() => {
    registerEditor(paneId, editorRef.current);
    return () => {
      registerEditor(paneId, null);
    };
  }, [paneId, registerEditor]);

  useEffect(() => {
    if (!documentQuery.data) {
      return;
    }

    hydrateDocument(
      documentId,
      documentQuery.data.title,
      documentQuery.data.markdown,
    );
  }, [documentId, documentQuery.data, hydrateDocument]);

  const markdown = draft?.markdown ?? documentQuery.data?.markdown ?? "";

  if (documentQuery.isLoading && !draft?.isLoaded) {
    return <div className="workspace-pane__loading">Loading document...</div>;
  }

  if (documentQuery.isError) {
    return (
      <div className="workspace-pane__loading">Failed to load document.</div>
    );
  }

  return (
    <EditorSurface
      ref={(editor) => {
        editorRef.current = editor;
        registerEditor(paneId, editor);
      }}
      markdown={markdown}
      onFormatStateChange={(state) => onFormatStateChange(paneId, state)}
      onMarkdownChange={(nextMarkdown) => {
        if (nextMarkdown === markdown) {
          return;
        }

        updateDraft(documentId, nextMarkdown);
        void workspaceClient.saveDocument(documentId, nextMarkdown).then(() => {
          markSaved(documentId, nextMarkdown);
        });
      }}
      onSelectionChange={(nextSelection: EditorSelectionState | null) => {
        const mappedSelection: SelectionState | null = nextSelection
          ? { text: nextSelection.text, threadId: null }
          : null;
        setSelection(mappedSelection);
      }}
    />
  );
}

function PaneResizer({
  splitPane,
}: { readonly splitPane: WorkspaceSplitPane }) {
  const updateSplitRatio = useWorkspaceSessionStore(
    (state) => state.updateSplitRatio,
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const parent = target.parentElement;
    if (!parent) {
      return;
    }

    containerRef.current = parent as HTMLDivElement;
    target.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const nextRatio =
        splitPane.direction === "vertical"
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height;
      updateSplitRatio(splitPane.id, nextRatio);
    };

    const clear = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
  };

  return (
    <div
      aria-hidden="true"
      className={`workspace-split__resizer workspace-split__resizer--${splitPane.direction}`}
      onPointerDown={handlePointerDown}
    />
  );
}

function WorkspaceLeafPaneView({
  pane,
  dragItem,
  onDragItemChange,
  registerEditor,
  onFormatStateChange,
  onTabInsertionOverlayChange,
}: {
  readonly pane: WorkspaceLeafPane;
  readonly dragItem: WorkspaceDragItem | null;
  readonly onDragItemChange: (item: WorkspaceDragItem | null) => void;
  readonly registerEditor: (
    paneId: string,
    editor: EditorSurfaceHandle | null,
  ) => void;
  readonly onFormatStateChange: (
    paneId: string,
    state: EditorFormatState,
  ) => void;
  readonly onTabInsertionOverlayChange: (
    overlay: WorkspaceOverlayRect | null,
  ) => void;
}) {
  const tabsById = useWorkspaceSessionStore((state) => state.tabsById);
  const draftsByDocumentId = useWorkspaceSessionStore(
    (state) => state.draftsByDocumentId,
  );
  const focusTab = useWorkspaceSessionStore((state) => state.focusTab);
  const closeTab = useWorkspaceSessionStore((state) => state.closeTab);
  const moveTab = useWorkspaceSessionStore((state) => state.moveTab);
  const openDocument = useWorkspaceSessionStore((state) => state.openDocument);
  const splitWithDocument = useWorkspaceSessionStore(
    (state) => state.splitWithDocument,
  );
  const splitWithTab = useWorkspaceSessionStore((state) => state.splitWithTab);
  const activeTab = pane.activeTabId ? tabsById[pane.activeTabId] : null;
  const activeDraft = activeTab
    ? draftsByDocumentId[activeTab.documentId]
    : null;
  const [dropPosition, setDropPosition] =
    useState<WorkspaceDropPosition | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);

  const getTabStripMetrics = (element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    const tabRects = Array.from(
      element.querySelectorAll<HTMLElement>(".workspace-tab"),
    ).map((tabElement) => {
      const tabRect = tabElement.getBoundingClientRect();
      return {
        left: tabRect.left - rect.left,
        right: tabRect.right - rect.left,
      };
    });

    return { rect, tabRects };
  };

  const getAllowedDropPosition = (
    item: WorkspaceDragItem,
    position: WorkspaceDropPosition,
  ): WorkspaceDropPosition | null => {
    if (item.type !== "tab") {
      return position;
    }

    const isTabInPane = pane.tabIds.includes(item.tabId);
    if (!isTabInPane) {
      return position;
    }

    return position;
  };

  const resolveTabInsertionOverlay = (args: {
    dragItem: WorkspaceDragItem;
    insertionIndex: number | undefined;
    markerLeft: number | undefined;
    tabStripElement: HTMLDivElement;
    tabStripRect: DOMRect;
  }): WorkspaceOverlayRect | null => {
    if (args.insertionIndex === undefined || args.markerLeft === undefined) {
      return null;
    }

    if (
      args.dragItem.type === "tab" &&
      isNoopTabInsertion({
        tabIds: pane.tabIds,
        draggedTabId: args.dragItem.tabId,
        insertionIndex: args.insertionIndex,
      })
    ) {
      const currentTabElement = args.tabStripElement.querySelector<HTMLElement>(
        `.workspace-tab[data-tab-id="${args.dragItem.tabId}"]`,
      );
      const currentTabRect = currentTabElement?.getBoundingClientRect();
      if (!currentTabRect) {
        return null;
      }

      return {
        left:
          args.insertionIndex === pane.tabIds.indexOf(args.dragItem.tabId)
            ? currentTabRect.left - 4
            : currentTabRect.right - 4,
        top:
          args.tabStripRect.top +
          (args.tabStripRect.height - args.tabStripRect.height * 1.1) / 2,
        width: 8,
        height: args.tabStripRect.height * 1.1,
        variant: "tab-insert",
      };
    }

    return {
      left: args.tabStripRect.left + args.markerLeft - 4,
      top:
        args.tabStripRect.top +
        (args.tabStripRect.height - args.tabStripRect.height * 1.1) / 2,
      width: 8,
      height: args.tabStripRect.height * 1.1,
      variant: "tab-insert",
    };
  };

  const commitPaneDrop = (
    item: WorkspaceDragItem,
    position: WorkspaceDropPosition,
    insertionIndex?: number,
  ) => {
    const allowedPosition = getAllowedDropPosition(item, position);
    if (!allowedPosition) {
      onTabInsertionOverlayChange(null);
      onDragItemChange(null);
      return;
    }

    if (item.type === "document") {
      onTabInsertionOverlayChange(null);
      if (allowedPosition === "center") {
        openDocument(item.documentId, {
          paneId: pane.id,
          duplicate: false,
          ...(insertionIndex === undefined
            ? {}
            : { targetIndex: insertionIndex }),
        });
      } else {
        splitWithDocument(item.documentId, pane.id, allowedPosition);
      }
      onDragItemChange(null);
      return;
    }

    if (allowedPosition === "center") {
      onTabInsertionOverlayChange(null);
      moveTab(item.tabId, pane.id, Number.MAX_SAFE_INTEGER);
    } else {
      splitWithTab(item.tabId, pane.id, allowedPosition);
    }
    onDragItemChange(null);
  };

  const handleTabStripWheel = (event: WheelEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth) {
      return;
    }

    const horizontalDelta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    if (horizontalDelta === 0) {
      return;
    }

    event.preventDefault();
    element.scrollLeft += horizontalDelta;
  };

  return (
    <section
      className={`workspace-pane${dropPosition ? ` is-drop-${dropPosition}` : ""}`}
    >
      <div
        className="workspace-pane__tabs"
        ref={tabStripRef}
        onWheel={handleTabStripWheel}
        onDragLeave={(event) => {
          if (isLeavingForChild(event)) {
            return;
          }
          setDropPosition(null);
          onTabInsertionOverlayChange(null);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragItem) {
            return;
          }
          const { rect, tabRects } = getTabStripMetrics(event.currentTarget);
          const snap = resolveTabStripSnap({
            rect: { width: rect.width, height: rect.height },
            pointerX: event.clientX - rect.left,
            pointerY: event.clientY - rect.top,
            stripScrollLeft: event.currentTarget.scrollLeft,
            tabRects,
          });
          const allowedPosition = getAllowedDropPosition(
            dragItem,
            snap.position,
          );
          setDropPosition(allowedPosition);

          if (snap.type === "split" && allowedPosition === "top") {
            onTabInsertionOverlayChange({
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height * 0.22,
              variant: "split-top",
            });
            return;
          }

          if (snap.type !== "insert" || allowedPosition !== "center") {
            onTabInsertionOverlayChange(null);
            return;
          }

          onTabInsertionOverlayChange(
            resolveTabInsertionOverlay({
              dragItem,
              insertionIndex: snap.insertionIndex,
              markerLeft: snap.markerLeft,
              tabStripElement: event.currentTarget,
              tabStripRect: rect,
            }),
          );
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!dragItem) {
            return;
          }
          const { rect, tabRects } = getTabStripMetrics(event.currentTarget);
          const snap = resolveTabStripSnap({
            rect: { width: rect.width, height: rect.height },
            pointerX: event.clientX - rect.left,
            pointerY: event.clientY - rect.top,
            stripScrollLeft: event.currentTarget.scrollLeft,
            tabRects,
          });
          const allowedPosition = getAllowedDropPosition(
            dragItem,
            snap.position,
          );
          if (!allowedPosition) {
            onDragItemChange(null);
            setDropPosition(null);
            onTabInsertionOverlayChange(null);
            return;
          }
          if (
            snap.type === "insert" &&
            allowedPosition === "center" &&
            dragItem.type === "tab"
          ) {
            if (snap.markerLeft === undefined) {
              onDragItemChange(null);
              setDropPosition(null);
              onTabInsertionOverlayChange(null);
              return;
            }

            const insertionIndex = snap.insertionIndex;
            if (insertionIndex === undefined) {
              onDragItemChange(null);
              setDropPosition(null);
              onTabInsertionOverlayChange(null);
              return;
            }
            if (
              !isNoopTabInsertion({
                tabIds: pane.tabIds,
                draggedTabId: dragItem.tabId,
                insertionIndex,
              })
            ) {
              moveTab(dragItem.tabId, pane.id, insertionIndex);
            }
            onDragItemChange(null);
            setDropPosition(null);
            onTabInsertionOverlayChange(null);
            return;
          }

          commitPaneDrop(dragItem, allowedPosition, snap.insertionIndex);
          setDropPosition(null);
          onTabInsertionOverlayChange(null);
        }}
      >
        {pane.tabIds.map((tabId, index) => {
          const tab = tabsById[tabId];
          if (!tab) {
            return null;
          }

          const draft = draftsByDocumentId[tab.documentId];
          const title = draft?.title ?? tab.documentId;
          const isActive = pane.activeTabId === tabId;

          return (
            <div
              className={`workspace-tab${isActive ? " is-active" : ""}`}
              data-tab-id={tabId}
              key={tabId}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!dragItem || dragItem.type !== "tab") {
                  return;
                }
                moveTab(dragItem.tabId, pane.id, index);
                onDragItemChange(null);
              }}
            >
              <button
                className="workspace-tab__button"
                draggable
                onClick={() => focusTab(pane.id, tabId)}
                onDragEnd={() => onDragItemChange(null)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  onDragItemChange({ type: "tab", tabId });
                }}
                type="button"
              >
                <span>{title}</span>
                {draft && draft.markdown !== draft.savedMarkdown ? (
                  <span className="workspace-tab__meta">*</span>
                ) : null}
              </button>
              <button
                aria-label={`Close ${title}`}
                className="workspace-tab__close"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tabId);
                }}
                type="button"
              >
                <X size={appIconSize} />
              </button>
            </div>
          );
        })}
      </div>

      <div
        className="workspace-pane__body"
        onDragLeave={(event) => {
          if (isLeavingForChild(event)) {
            return;
          }
          setDropPosition(null);
          onTabInsertionOverlayChange(null);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragItem) {
            return;
          }
          const tabStripElement = tabStripRef.current;
          const tabStripMetrics = tabStripElement
            ? getTabStripMetrics(tabStripElement)
            : null;
          if (!tabStripElement || !tabStripMetrics) {
            onTabInsertionOverlayChange(null);
            return;
          }

          const rect = event.currentTarget.getBoundingClientRect();
          const snap = resolveBodyPaneSnap({
            rect: { width: rect.width, height: rect.height },
            pointerX: event.clientX - tabStripMetrics.rect.left,
            pointerY: event.clientY - rect.top,
            stripScrollLeft: tabStripElement.scrollLeft,
            tabRects: tabStripMetrics.tabRects,
          });
          const allowedPosition = getAllowedDropPosition(
            dragItem,
            snap.position,
          );
          setDropPosition(allowedPosition);

          if (snap.type !== "insert" || allowedPosition !== "center") {
            onTabInsertionOverlayChange(null);
            return;
          }

          onTabInsertionOverlayChange(
            resolveTabInsertionOverlay({
              dragItem,
              insertionIndex: snap.insertionIndex,
              markerLeft: snap.markerLeft,
              tabStripElement,
              tabStripRect: tabStripMetrics.rect,
            }),
          );
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!dragItem) {
            return;
          }
          const tabStripElement = tabStripRef.current;
          const tabStripMetrics = tabStripElement
            ? getTabStripMetrics(tabStripElement)
            : null;
          if (!tabStripElement || !tabStripMetrics) {
            onTabInsertionOverlayChange(null);
            onDragItemChange(null);
            setDropPosition(null);
            return;
          }

          const rect = event.currentTarget.getBoundingClientRect();
          const snap = resolveBodyPaneSnap({
            rect: { width: rect.width, height: rect.height },
            pointerX: event.clientX - tabStripMetrics.rect.left,
            pointerY: event.clientY - rect.top,
            stripScrollLeft: tabStripElement.scrollLeft,
            tabRects: tabStripMetrics.tabRects,
          });
          const allowedPosition = getAllowedDropPosition(
            dragItem,
            snap.position,
          );

          onTabInsertionOverlayChange(null);
          if (!allowedPosition) {
            onDragItemChange(null);
            setDropPosition(null);
            return;
          }

          if (
            snap.type === "insert" &&
            allowedPosition === "center" &&
            dragItem.type === "tab"
          ) {
            const insertionIndex = snap.insertionIndex;
            if (
              insertionIndex !== undefined &&
              !isNoopTabInsertion({
                tabIds: pane.tabIds,
                draggedTabId: dragItem.tabId,
                insertionIndex,
              })
            ) {
              moveTab(dragItem.tabId, pane.id, insertionIndex);
            }
            onDragItemChange(null);
            setDropPosition(null);
            return;
          }

          commitPaneDrop(dragItem, allowedPosition, snap.insertionIndex);
          setDropPosition(null);
        }}
        onMouseDown={() => {
          if (pane.activeTabId) {
            focusTab(pane.id, pane.activeTabId);
          }
        }}
      >
        {activeTab ? (
          <>
            <div className="workspace__document-scroll">
              <div
                className="workspace__document-title"
                title={activeDraft?.title ?? activeTab.documentId}
              >
                {activeDraft?.title ?? activeTab.documentId}
              </div>
              <DocumentEditorHost
                documentId={activeTab.documentId}
                paneId={pane.id}
                registerEditor={registerEditor}
                onFormatStateChange={onFormatStateChange}
              />
            </div>
          </>
        ) : (
          <div className="workspace-pane__loading">No document open.</div>
        )}
      </div>
    </section>
  );
}

function WorkspacePaneNodeView({
  node,
  dragItem,
  onDragItemChange,
  registerEditor,
  onFormatStateChange,
  onTabInsertionOverlayChange,
}: {
  readonly node: WorkspacePaneNode;
  readonly dragItem: WorkspaceDragItem | null;
  readonly onDragItemChange: (item: WorkspaceDragItem | null) => void;
  readonly registerEditor: (
    paneId: string,
    editor: EditorSurfaceHandle | null,
  ) => void;
  readonly onFormatStateChange: (
    paneId: string,
    state: EditorFormatState,
  ) => void;
  readonly onTabInsertionOverlayChange: (
    overlay: WorkspaceOverlayRect | null,
  ) => void;
}) {
  if (node.type === "leaf") {
    return (
      <WorkspaceLeafPaneView
        dragItem={dragItem}
        onDragItemChange={onDragItemChange}
        onFormatStateChange={onFormatStateChange}
        onTabInsertionOverlayChange={onTabInsertionOverlayChange}
        pane={node}
        registerEditor={registerEditor}
      />
    );
  }

  const splitStyle = {
    ...(node.direction === "vertical"
      ? {
          gridTemplateColumns: `${node.ratio}fr 1px ${1 - node.ratio}fr`,
        }
      : {
          gridTemplateRows: `${node.ratio}fr 1px ${1 - node.ratio}fr`,
        }),
  } as CSSProperties;

  return (
    <div
      className={`workspace-split workspace-split--${node.direction}`}
      style={splitStyle}
    >
      <div className="workspace-split__panel workspace-split__panel--first">
        <WorkspacePaneNodeView
          dragItem={dragItem}
          node={node.first}
          onDragItemChange={onDragItemChange}
          onFormatStateChange={onFormatStateChange}
          onTabInsertionOverlayChange={onTabInsertionOverlayChange}
          registerEditor={registerEditor}
        />
      </div>
      <PaneResizer splitPane={node} />
      <div className="workspace-split__panel workspace-split__panel--second">
        <WorkspacePaneNodeView
          dragItem={dragItem}
          node={node.second}
          onDragItemChange={onDragItemChange}
          onFormatStateChange={onFormatStateChange}
          onTabInsertionOverlayChange={onTabInsertionOverlayChange}
          registerEditor={registerEditor}
        />
      </div>
    </div>
  );
}

export function WorkspaceSurface({
  initialDocumentId,
  dragItem,
  onDragItemChange,
}: WorkspaceSurfaceProps) {
  const rootPane = useWorkspaceSessionStore((state) => state.rootPane);
  const focusedPaneId = useWorkspaceSessionStore(
    (state) => state.focusedPaneId,
  );
  const initialize = useWorkspaceSessionStore((state) => state.initialize);
  const draftsByDocumentId = useWorkspaceSessionStore(
    (state) => state.draftsByDocumentId,
  );
  const tabsById = useWorkspaceSessionStore((state) => state.tabsById);
  const focusedTabId = useWorkspaceSessionStore((state) => state.focusedTabId);
  const openDocument = useWorkspaceSessionStore((state) => state.openDocument);

  const editorRefs = useRef(new Map<string, EditorSurfaceHandle | null>());
  const [formatByPaneId, setFormatByPaneId] = useState<
    Record<string, EditorFormatState>
  >({});
  const [tabInsertionOverlay, setTabInsertionOverlay] =
    useState<WorkspaceOverlayRect | null>(null);

  useEffect(() => {
    if (initialDocumentId) {
      initialize(initialDocumentId);
    }
  }, [initialDocumentId, initialize]);

  const focusedDocumentId = focusedTabId
    ? tabsById[focusedTabId]?.documentId
    : null;
  const focusedDraft = focusedDocumentId
    ? draftsByDocumentId[focusedDocumentId]
    : null;
  const activeFormatState =
    (focusedPaneId ? formatByPaneId[focusedPaneId] : undefined) ??
    defaultEditorFormatState;

  const handleRegisterEditor = (
    paneId: string,
    editor: EditorSurfaceHandle | null,
  ) => {
    editorRefs.current.set(paneId, editor);
  };

  const handleFormatStateChange = (
    paneId: string,
    state: EditorFormatState,
  ) => {
    setFormatByPaneId((current) => ({ ...current, [paneId]: state }));
  };

  const runFocusedEditorCommand = (
    commandName: EditorCommandName,
    options?: { readonly level?: EditorHeadingLevel },
  ) => {
    if (!focusedPaneId) {
      return;
    }

    editorRefs.current.get(focusedPaneId)?.runCommand(commandName, options);
  };

  if (!rootPane) {
    return <div className="workspace-pane__loading">Open a file to start.</div>;
  }

  return (
    <section className="workspace__canvas">
      <div className="workspace__frame workspace__frame--multi workspace__frame--toolbar">
        <div
          className="workspace__toolbar"
          role="toolbar"
          aria-label="Text editing options"
        >
          <WorkspaceHeadingControl
            activeHeadingLevel={activeFormatState.headingLevel}
            onCommand={runFocusedEditorCommand}
          />
          {editorToolbarActions.map(
            (action: (typeof editorToolbarActions)[number]) => {
              const Icon = action.icon;
              return (
                <button
                  aria-label={action.label}
                  className={`workspace__toolbar-button${
                    action.isActive(activeFormatState) ? " is-active" : ""
                  }`}
                  key={action.commandName}
                  onClick={() => runFocusedEditorCommand(action.commandName)}
                  type="button"
                >
                  <Icon size={appIconSize} />
                </button>
              );
            },
          )}
        </div>
      </div>
      <div className="workspace__frame workspace__frame--multi">
        <WorkspacePaneNodeView
          dragItem={dragItem}
          node={rootPane}
          onDragItemChange={onDragItemChange}
          onFormatStateChange={handleFormatStateChange}
          onTabInsertionOverlayChange={setTabInsertionOverlay}
          registerEditor={handleRegisterEditor}
        />
      </div>
      {tabInsertionOverlay ? (
        <div
          className={`workspace-overlay workspace-overlay--${tabInsertionOverlay.variant}`}
          style={{
            left: `${tabInsertionOverlay.left}px`,
            top: `${tabInsertionOverlay.top}px`,
            width: `${tabInsertionOverlay.width}px`,
            height: `${tabInsertionOverlay.height}px`,
          }}
        />
      ) : null}
    </section>
  );
}
