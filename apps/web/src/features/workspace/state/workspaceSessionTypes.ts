export type WorkspacePaneId = string;
export type WorkspaceTabId = string;
export type WorkspaceSplitDirection = "horizontal" | "vertical";
export type WorkspaceDropPosition =
  | "center"
  | "left"
  | "right"
  | "top"
  | "bottom";

export interface WorkspaceTab {
  readonly id: WorkspaceTabId;
  readonly documentId: string;
}

export interface WorkspaceLeafPane {
  readonly type: "leaf";
  readonly id: WorkspacePaneId;
  readonly tabIds: readonly WorkspaceTabId[];
  readonly activeTabId: WorkspaceTabId | null;
}

export interface WorkspaceSplitPane {
  readonly type: "split";
  readonly id: string;
  readonly direction: WorkspaceSplitDirection;
  readonly first: WorkspacePaneNode;
  readonly second: WorkspacePaneNode;
  readonly ratio: number;
}

export type WorkspacePaneNode = WorkspaceLeafPane | WorkspaceSplitPane;

export interface WorkspaceDocumentDraft {
  readonly title: string;
  readonly markdown: string;
  readonly savedMarkdown: string;
  readonly isLoaded: boolean;
}

export interface WorkspaceSessionState {
  readonly rootPane: WorkspacePaneNode | null;
  readonly tabsById: Readonly<Record<WorkspaceTabId, WorkspaceTab>>;
  readonly draftsByDocumentId: Readonly<Record<string, WorkspaceDocumentDraft>>;
  readonly lastFocusedTabIdByDocumentId: Readonly<
    Record<string, WorkspaceTabId>
  >;
  readonly focusedPaneId: WorkspacePaneId | null;
  readonly focusedTabId: WorkspaceTabId | null;
}

export interface WorkspaceDocumentOpenTarget {
  readonly paneId: WorkspacePaneId | null;
  readonly duplicate: boolean;
}

export interface WorkspaceTreeDragItem {
  readonly type: "document";
  readonly documentId: string;
}

export interface WorkspaceTabDragItem {
  readonly type: "tab";
  readonly tabId: WorkspaceTabId;
}

export type WorkspaceDragItem = WorkspaceTreeDragItem | WorkspaceTabDragItem;
