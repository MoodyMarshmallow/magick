import { create } from "zustand";
import {
  closeTabInWorkspace,
  createEmptyWorkspaceSession,
  createWorkspaceSessionWithDocument,
  focusTabInPane,
  hydrateDocumentDraft,
  markDocumentSaved,
  moveTabWithinWorkspace,
  openDocumentInWorkspace,
  setSplitRatio,
  splitPaneWithDocument,
  splitPaneWithTab,
  updateDocumentDraft,
} from "./workspaceSession";
import type {
  WorkspaceDocumentOpenTarget,
  WorkspaceDropPosition,
  WorkspaceSessionState,
} from "./workspaceSessionTypes";

const createIds = () => ({
  createPaneId: () => crypto.randomUUID().slice(0, 8),
  createSplitId: () => crypto.randomUUID().slice(0, 8),
  createTabId: () => crypto.randomUUID().slice(0, 8),
});

interface WorkspaceSessionStore extends WorkspaceSessionState {
  initialize: (documentId: string, title?: string) => void;
  openDocument: (
    documentId: string,
    target: WorkspaceDocumentOpenTarget,
    title?: string,
  ) => void;
  splitWithDocument: (
    documentId: string,
    targetPaneId: string,
    position: Exclude<WorkspaceDropPosition, "center">,
    title?: string,
  ) => void;
  splitWithTab: (
    tabId: string,
    targetPaneId: string,
    position: Exclude<WorkspaceDropPosition, "center">,
  ) => void;
  moveTab: (tabId: string, targetPaneId: string, targetIndex: number) => void;
  closeTab: (tabId: string) => void;
  focusTab: (paneId: string, tabId: string) => void;
  hydrateDocument: (
    documentId: string,
    title: string,
    markdown: string,
  ) => void;
  updateDraft: (documentId: string, markdown: string) => void;
  markSaved: (documentId: string, markdown: string) => void;
  updateSplitRatio: (splitPaneId: string, ratio: number) => void;
}

export const useWorkspaceSessionStore = create<WorkspaceSessionStore>(
  (set) => ({
    ...createEmptyWorkspaceSession(),
    initialize: (documentId, title) =>
      set((state) =>
        state.rootPane
          ? state
          : createWorkspaceSessionWithDocument(
              title
                ? { documentId, title, ids: createIds() }
                : { documentId, ids: createIds() },
            ),
      ),
    openDocument: (documentId, target, title) =>
      set((state) =>
        openDocumentInWorkspace(
          title
            ? {
                state,
                documentId,
                target,
                ids: createIds(),
                title,
              }
            : {
                state,
                documentId,
                target,
                ids: createIds(),
              },
        ),
      ),
    splitWithDocument: (documentId, targetPaneId, position, title) =>
      set((state) =>
        splitPaneWithDocument(
          title
            ? {
                state,
                documentId,
                targetPaneId,
                position,
                ids: createIds(),
                title,
              }
            : {
                state,
                documentId,
                targetPaneId,
                position,
                ids: createIds(),
              },
        ),
      ),
    splitWithTab: (tabId, targetPaneId, position) =>
      set((state) =>
        splitPaneWithTab({
          state,
          sourceTabId: tabId,
          targetPaneId,
          position,
          ids: createIds(),
        }),
      ),
    moveTab: (tabId, targetPaneId, targetIndex) =>
      set((state) =>
        moveTabWithinWorkspace({ state, tabId, targetPaneId, targetIndex }),
      ),
    closeTab: (tabId) => set((state) => closeTabInWorkspace({ state, tabId })),
    focusTab: (paneId, tabId) =>
      set((state) => focusTabInPane(state, paneId, tabId)),
    hydrateDocument: (documentId, title, markdown) =>
      set((state) =>
        hydrateDocumentDraft({ state, documentId, title, markdown }),
      ),
    updateDraft: (documentId, markdown) =>
      set((state) => updateDocumentDraft({ state, documentId, markdown })),
    markSaved: (documentId, markdown) =>
      set((state) => markDocumentSaved({ state, documentId, markdown })),
    updateSplitRatio: (splitPaneId, ratio) =>
      set((state) => setSplitRatio({ state, splitPaneId, ratio })),
  }),
);
