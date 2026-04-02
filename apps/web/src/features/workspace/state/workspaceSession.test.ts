import {
  closeTabInWorkspace,
  createWorkspaceSessionWithDocument,
  focusTabInPane,
  getFocusedDocumentId,
  hydrateDocumentDraft,
  markDocumentSaved,
  moveTabWithinWorkspace,
  openDocumentInWorkspace,
  splitPaneWithDocument,
  splitPaneWithTab,
  updateDocumentDraft,
} from "./workspaceSession";

const createIds = () => {
  let pane = 0;
  let tab = 0;
  let split = 0;

  return {
    createPaneId: () => `pane_${++pane}`,
    createSplitId: () => `split_${++split}`,
    createTabId: () => `tab_${++tab}`,
  };
};

describe("workspaceSession", () => {
  it("creates an initial session with one focused document", () => {
    const session = createWorkspaceSessionWithDocument({
      documentId: "doc_1",
      title: "Doc 1",
      ids: createIds(),
    });

    expect(getFocusedDocumentId(session)).toBe("doc_1");
    expect(session.rootPane).toMatchObject({
      type: "leaf",
      activeTabId: "tab_1",
      tabIds: ["tab_1"],
    });
  });

  it("reuses an existing tab for tree-open when the document is already open", () => {
    const ids = createIds();
    const initial = createWorkspaceSessionWithDocument({
      documentId: "doc_1",
      ids,
    });
    const withSecondDoc = openDocumentInWorkspace({
      state: initial,
      documentId: "doc_2",
      target: { paneId: initial.focusedPaneId, duplicate: false },
      ids,
    });
    const reused = openDocumentInWorkspace({
      state: withSecondDoc,
      documentId: "doc_1",
      target: { paneId: withSecondDoc.focusedPaneId, duplicate: false },
      ids,
    });

    expect(Object.keys(reused.tabsById)).toHaveLength(2);
    expect(reused.focusedTabId).toBe("tab_1");
  });

  it("allows duplicate document views when explicitly opened as duplicates", () => {
    const ids = createIds();
    const initial = createWorkspaceSessionWithDocument({
      documentId: "doc_1",
      ids,
    });

    const duplicated = splitPaneWithDocument({
      state: initial,
      documentId: "doc_1",
      targetPaneId: initial.focusedPaneId ?? "pane_missing",
      position: "right",
      ids,
    });

    expect(
      Object.values(duplicated.tabsById).map((tab) => tab.documentId),
    ).toEqual(["doc_1", "doc_1"]);
    expect(duplicated.rootPane).toMatchObject({ type: "split" });
  });

  it("moves tabs across panes and focuses the moved tab", () => {
    const ids = createIds();
    const initial = createWorkspaceSessionWithDocument({
      documentId: "doc_1",
      ids,
    });
    const withSecondDoc = openDocumentInWorkspace({
      state: initial,
      documentId: "doc_2",
      target: { paneId: initial.focusedPaneId, duplicate: false },
      ids,
    });
    const split = splitPaneWithTab({
      state: withSecondDoc,
      sourceTabId: "tab_2",
      targetPaneId: initial.focusedPaneId ?? "pane_missing",
      position: "right",
      ids,
    });
    const root = split.rootPane;
    if (!root || root.type !== "split" || root.second.type !== "leaf") {
      throw new Error("Expected split leaf pane.");
    }

    const moved = moveTabWithinWorkspace({
      state: split,
      tabId: "tab_1",
      targetPaneId: root.second.id,
      targetIndex: 1,
    });
    expect(moved.rootPane).toMatchObject({
      type: "leaf",
      tabIds: ["tab_2", "tab_1"],
    });
    expect(moved.focusedTabId).toBe("tab_1");
  });

  it("reorders tabs within the same pane by insertion edge", () => {
    const ids = createIds();
    const initial = createWorkspaceSessionWithDocument({
      documentId: "doc_1",
      ids,
    });
    const withSecondDoc = openDocumentInWorkspace({
      state: initial,
      documentId: "doc_2",
      target: { paneId: initial.focusedPaneId, duplicate: false },
      ids,
    });
    const withThirdDoc = openDocumentInWorkspace({
      state: withSecondDoc,
      documentId: "doc_3",
      target: { paneId: initial.focusedPaneId, duplicate: false },
      ids,
    });

    const moved = moveTabWithinWorkspace({
      state: withThirdDoc,
      tabId: "tab_1",
      targetPaneId: initial.focusedPaneId ?? "pane_missing",
      targetIndex: 3,
    });

    expect(moved.rootPane).toMatchObject({
      type: "leaf",
      tabIds: ["tab_2", "tab_3", "tab_1"],
    });
  });

  it("moves a dragged tab into a new split without duplicating it", () => {
    const ids = createIds();
    const initial = createWorkspaceSessionWithDocument({
      documentId: "doc_1",
      ids,
    });
    const withSecondDoc = openDocumentInWorkspace({
      state: initial,
      documentId: "doc_2",
      target: { paneId: initial.focusedPaneId, duplicate: false },
      ids,
    });
    const split = splitPaneWithDocument({
      state: withSecondDoc,
      documentId: "doc_3",
      targetPaneId: initial.focusedPaneId ?? "pane_missing",
      position: "right",
      ids,
    });
    const root = split.rootPane;
    if (!root || root.type !== "split" || root.second.type !== "leaf") {
      throw new Error("Expected split leaf pane.");
    }

    const moved = splitPaneWithTab({
      state: split,
      sourceTabId: "tab_1",
      targetPaneId: root.second.id,
      position: "bottom",
      ids,
    });

    const collectLeafTabIds = (
      node: NonNullable<typeof moved.rootPane>,
    ): string[] =>
      node.type === "leaf"
        ? [...node.tabIds]
        : [...collectLeafTabIds(node.first), ...collectLeafTabIds(node.second)];

    if (!moved.rootPane) {
      throw new Error("Expected moved workspace root pane.");
    }

    const movedTabIds = collectLeafTabIds(moved.rootPane).filter(
      (tabId) => tabId === "tab_1",
    );

    expect(movedTabIds).toHaveLength(1);
  });

  it("collapses empty panes when the last tab is closed", () => {
    const ids = createIds();
    const initial = createWorkspaceSessionWithDocument({
      documentId: "doc_1",
      ids,
    });
    const split = splitPaneWithDocument({
      state: initial,
      documentId: "doc_2",
      targetPaneId: initial.focusedPaneId ?? "pane_missing",
      position: "right",
      ids,
    });
    const closed = closeTabInWorkspace({
      state: split,
      tabId: split.focusedTabId ?? "tab_missing",
    });

    expect(closed.rootPane).toMatchObject({
      type: "leaf",
      tabIds: ["tab_1"],
    });
  });

  it("shares one draft across multiple open views of the same document", () => {
    const ids = createIds();
    const initial = createWorkspaceSessionWithDocument({
      documentId: "doc_1",
      ids,
    });
    const duplicated = splitPaneWithDocument({
      state: initial,
      documentId: "doc_1",
      targetPaneId: initial.focusedPaneId ?? "pane_missing",
      position: "bottom",
      ids,
    });
    const hydrated = hydrateDocumentDraft({
      state: duplicated,
      documentId: "doc_1",
      title: "Doc 1",
      markdown: "first",
    });
    const updated = updateDocumentDraft({
      state: hydrated,
      documentId: "doc_1",
      markdown: "second",
    });

    expect(updated.draftsByDocumentId.doc_1?.markdown).toBe("second");
    expect(
      Object.values(updated.tabsById).filter(
        (tab) => tab.documentId === "doc_1",
      ),
    ).toHaveLength(2);
  });

  it("ignores stale save completions once the draft has newer edits", () => {
    const ids = createIds();
    const initial = createWorkspaceSessionWithDocument({
      documentId: "doc_1",
      ids,
    });
    const hydrated = hydrateDocumentDraft({
      state: initial,
      documentId: "doc_1",
      title: "Doc 1",
      markdown: "initial",
    });
    const edited = updateDocumentDraft({
      state: hydrated,
      documentId: "doc_1",
      markdown: "newer draft",
    });

    const saved = markDocumentSaved({
      state: edited,
      documentId: "doc_1",
      markdown: "initial",
    });

    expect(saved.draftsByDocumentId.doc_1).toMatchObject({
      markdown: "newer draft",
      savedMarkdown: "initial",
    });
  });

  it("keeps the last-focused document tab mapped to another open duplicate on close", () => {
    const ids = createIds();
    const initial = createWorkspaceSessionWithDocument({
      documentId: "doc_1",
      ids,
    });
    const duplicated = splitPaneWithDocument({
      state: initial,
      documentId: "doc_1",
      targetPaneId: initial.focusedPaneId ?? "pane_missing",
      position: "right",
      ids,
    });

    const closed = closeTabInWorkspace({
      state: duplicated,
      tabId: duplicated.focusedTabId ?? "tab_missing",
    });
    const reopened = openDocumentInWorkspace({
      state: closed,
      documentId: "doc_1",
      target: { paneId: closed.focusedPaneId, duplicate: false },
      ids,
    });

    expect(Object.keys(reopened.tabsById)).toHaveLength(1);
    expect(reopened.focusedTabId).toBe(
      closed.lastFocusedTabIdByDocumentId.doc_1,
    );
  });
});
