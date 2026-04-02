import type {
  WorkspaceDocumentDraft,
  WorkspaceDocumentOpenTarget,
  WorkspaceDropPosition,
  WorkspaceLeafPane,
  WorkspacePaneId,
  WorkspacePaneNode,
  WorkspaceSessionState,
  WorkspaceSplitDirection,
  WorkspaceSplitPane,
  WorkspaceTab,
  WorkspaceTabId,
} from "./workspaceSessionTypes";

export interface WorkspaceIdFactory {
  createPaneId: () => WorkspacePaneId;
  createSplitId: () => string;
  createTabId: () => WorkspaceTabId;
}

const clampRatio = (value: number): number =>
  Math.min(Math.max(value, 0.2), 0.8);

const createLeafPane = (
  id: WorkspacePaneId,
  tabId: WorkspaceTabId,
): WorkspaceLeafPane => ({
  type: "leaf",
  id,
  tabIds: [tabId],
  activeTabId: tabId,
});

const createTab = (id: WorkspaceTabId, documentId: string): WorkspaceTab => ({
  id,
  documentId,
});

const isLeafPane = (node: WorkspacePaneNode): node is WorkspaceLeafPane =>
  node.type === "leaf";

const findPane = (
  node: WorkspacePaneNode | null,
  paneId: WorkspacePaneId,
): WorkspaceLeafPane | null => {
  if (!node) {
    return null;
  }

  if (isLeafPane(node)) {
    return node.id === paneId ? node : null;
  }

  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
};

const findPaneContainingTab = (
  node: WorkspacePaneNode | null,
  tabId: WorkspaceTabId,
): WorkspaceLeafPane | null => {
  if (!node) {
    return null;
  }

  if (isLeafPane(node)) {
    return node.tabIds.includes(tabId) ? node : null;
  }

  return (
    findPaneContainingTab(node.first, tabId) ??
    findPaneContainingTab(node.second, tabId)
  );
};

const mapLeafPane = (
  node: WorkspacePaneNode,
  paneId: WorkspacePaneId,
  updater: (pane: WorkspaceLeafPane) => WorkspacePaneNode,
): WorkspacePaneNode => {
  if (isLeafPane(node)) {
    return node.id === paneId ? updater(node) : node;
  }

  return {
    ...node,
    first: mapLeafPane(node.first, paneId, updater),
    second: mapLeafPane(node.second, paneId, updater),
  };
};

const replacePane = (
  node: WorkspacePaneNode,
  paneId: WorkspacePaneId,
  replacement: WorkspacePaneNode,
): WorkspacePaneNode => {
  if (isLeafPane(node)) {
    return node.id === paneId ? replacement : node;
  }

  return {
    ...node,
    first: replacePane(node.first, paneId, replacement),
    second: replacePane(node.second, paneId, replacement),
  };
};

const removeTabFromPane = (
  pane: WorkspaceLeafPane,
  tabId: WorkspaceTabId,
): WorkspaceLeafPane => {
  const nextTabIds = pane.tabIds.filter((candidate) => candidate !== tabId);
  const nextActiveTabId =
    pane.activeTabId === tabId ? (nextTabIds.at(-1) ?? null) : pane.activeTabId;

  return {
    ...pane,
    tabIds: nextTabIds,
    activeTabId: nextActiveTabId,
  };
};

const normalizeTree = (node: WorkspacePaneNode): WorkspacePaneNode | null => {
  if (isLeafPane(node)) {
    return node.tabIds.length > 0 ? node : null;
  }

  const first = normalizeTree(node.first);
  const second = normalizeTree(node.second);

  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  return {
    ...node,
    first,
    second,
  };
};

const withTabFocused = (
  state: WorkspaceSessionState,
  paneId: WorkspacePaneId,
  tabId: WorkspaceTabId,
): WorkspaceSessionState => {
  const tab = state.tabsById[tabId];
  if (!tab) {
    return state;
  }

  return {
    ...state,
    focusedPaneId: paneId,
    focusedTabId: tabId,
    lastFocusedTabIdByDocumentId: {
      ...state.lastFocusedTabIdByDocumentId,
      [tab.documentId]: tabId,
    },
  };
};

const ensureDraftRecord = (
  draftsByDocumentId: WorkspaceSessionState["draftsByDocumentId"],
  documentId: string,
  title = "Loading document",
): WorkspaceSessionState["draftsByDocumentId"] => {
  if (draftsByDocumentId[documentId]) {
    return draftsByDocumentId;
  }

  return {
    ...draftsByDocumentId,
    [documentId]: {
      title,
      markdown: "",
      savedMarkdown: "",
      isLoaded: false,
    },
  };
};

const getAnyOpenTabIdForDocument = (
  tabsById: WorkspaceSessionState["tabsById"],
  documentId: string,
): WorkspaceTabId | null => {
  for (const tab of Object.values(tabsById)) {
    if (tab.documentId === documentId) {
      return tab.id;
    }
  }

  return null;
};

export const createEmptyWorkspaceSession = (): WorkspaceSessionState => ({
  rootPane: null,
  tabsById: {},
  draftsByDocumentId: {},
  lastFocusedTabIdByDocumentId: {},
  focusedPaneId: null,
  focusedTabId: null,
});

export const createWorkspaceSessionWithDocument = (args: {
  documentId: string;
  title?: string;
  ids: WorkspaceIdFactory;
}): WorkspaceSessionState => {
  const tabId = args.ids.createTabId();
  const paneId = args.ids.createPaneId();

  return {
    rootPane: createLeafPane(paneId, tabId),
    tabsById: {
      [tabId]: createTab(tabId, args.documentId),
    },
    draftsByDocumentId: ensureDraftRecord({}, args.documentId, args.title),
    lastFocusedTabIdByDocumentId: {
      [args.documentId]: tabId,
    },
    focusedPaneId: paneId,
    focusedTabId: tabId,
  };
};

export const getFocusedDocumentId = (
  state: WorkspaceSessionState,
): string | null => {
  if (!state.focusedTabId) {
    return null;
  }

  return state.tabsById[state.focusedTabId]?.documentId ?? null;
};

export const focusTabInPane = (
  state: WorkspaceSessionState,
  paneId: WorkspacePaneId,
  tabId: WorkspaceTabId,
): WorkspaceSessionState => {
  if (!state.rootPane) {
    return state;
  }

  const pane = findPane(state.rootPane, paneId);
  if (!pane || !pane.tabIds.includes(tabId)) {
    return state;
  }

  return withTabFocused(
    {
      ...state,
      rootPane: mapLeafPane(state.rootPane, paneId, (currentPane) => ({
        ...currentPane,
        activeTabId: tabId,
      })),
    },
    paneId,
    tabId,
  );
};

export const openDocumentInWorkspace = (args: {
  state: WorkspaceSessionState;
  documentId: string;
  title?: string;
  target: WorkspaceDocumentOpenTarget;
  ids: WorkspaceIdFactory;
}): WorkspaceSessionState => {
  const { state, documentId, target, ids } = args;

  if (!state.rootPane) {
    return createWorkspaceSessionWithDocument(
      args.title
        ? {
            documentId,
            title: args.title,
            ids,
          }
        : {
            documentId,
            ids,
          },
    );
  }

  if (!target.duplicate) {
    const existingTabId = state.lastFocusedTabIdByDocumentId[documentId];
    if (existingTabId) {
      const pane = findPaneContainingTab(state.rootPane, existingTabId);
      if (pane) {
        return focusTabInPane(state, pane.id, existingTabId);
      }
    }
  }

  const tabId = ids.createTabId();
  const targetPaneId = target.paneId ?? state.focusedPaneId;
  const pane = targetPaneId ? findPane(state.rootPane, targetPaneId) : null;
  const resolvedPaneId = pane?.id ?? findFirstLeafPaneId(state.rootPane);
  if (!resolvedPaneId) {
    return state;
  }

  const nextState = {
    ...state,
    tabsById: {
      ...state.tabsById,
      [tabId]: createTab(tabId, documentId),
    },
    draftsByDocumentId: ensureDraftRecord(
      state.draftsByDocumentId,
      documentId,
      args.title,
    ),
    rootPane: mapLeafPane(state.rootPane, resolvedPaneId, (currentPane) => ({
      ...currentPane,
      tabIds: [...currentPane.tabIds, tabId],
      activeTabId: tabId,
    })),
  };

  return withTabFocused(nextState, resolvedPaneId, tabId);
};

export const closeTabInWorkspace = (args: {
  state: WorkspaceSessionState;
  tabId: WorkspaceTabId;
}): WorkspaceSessionState => {
  const { state, tabId } = args;
  const closedTab = state.tabsById[tabId];
  if (!state.rootPane || !closedTab) {
    return state;
  }

  const sourcePane = findPaneContainingTab(state.rootPane, tabId);
  if (!sourcePane) {
    return state;
  }

  const nextRootPane = normalizeTree(
    mapLeafPane(state.rootPane, sourcePane.id, (pane) =>
      removeTabFromPane(pane, tabId),
    ),
  );
  const { [tabId]: _removed, ...nextTabsById } = state.tabsById;
  const nextLastFocusedTabIdByDocumentId = {
    ...state.lastFocusedTabIdByDocumentId,
  };

  if (nextLastFocusedTabIdByDocumentId[closedTab.documentId] === tabId) {
    const remainingTabId = getAnyOpenTabIdForDocument(
      nextTabsById,
      closedTab.documentId,
    );
    if (remainingTabId) {
      nextLastFocusedTabIdByDocumentId[closedTab.documentId] = remainingTabId;
    } else {
      delete nextLastFocusedTabIdByDocumentId[closedTab.documentId];
    }
  }

  const nextState: WorkspaceSessionState = {
    ...state,
    rootPane: nextRootPane,
    tabsById: nextTabsById,
    lastFocusedTabIdByDocumentId: nextLastFocusedTabIdByDocumentId,
  };

  if (!nextRootPane) {
    return {
      ...createEmptyWorkspaceSession(),
      draftsByDocumentId: nextState.draftsByDocumentId,
      lastFocusedTabIdByDocumentId: nextState.lastFocusedTabIdByDocumentId,
    };
  }

  const nextFocusedPane = nextState.focusedPaneId
    ? findPane(nextRootPane, nextState.focusedPaneId)
    : null;
  const fallbackPane = nextFocusedPane ?? findFirstLeafPane(nextRootPane);
  const fallbackTabId = fallbackPane?.activeTabId ?? null;
  return {
    ...nextState,
    focusedPaneId: fallbackPane?.id ?? null,
    focusedTabId: fallbackTabId,
  };
};

export const moveTabWithinWorkspace = (args: {
  state: WorkspaceSessionState;
  tabId: WorkspaceTabId;
  targetPaneId: WorkspacePaneId;
  targetIndex: number;
}): WorkspaceSessionState => {
  const { state, tabId, targetPaneId, targetIndex } = args;
  if (!state.rootPane) {
    return state;
  }

  const sourcePane = findPaneContainingTab(state.rootPane, tabId);
  const targetPane = findPane(state.rootPane, targetPaneId);
  if (!sourcePane || !targetPane) {
    return state;
  }

  const sourceTabIds = sourcePane.tabIds.filter(
    (candidate) => candidate !== tabId,
  );
  const sourceIndex = sourcePane.tabIds.indexOf(tabId);
  const nextTargetIndex =
    sourcePane.id === targetPane.id &&
    sourceIndex !== -1 &&
    sourceIndex < targetIndex
      ? targetIndex - 1
      : targetIndex;
  const insertionIndex = Math.min(
    Math.max(nextTargetIndex, 0),
    sourcePane.id === targetPane.id
      ? sourceTabIds.length
      : targetPane.tabIds.length,
  );
  const nextTargetTabIds = [
    ...(sourcePane.id === targetPane.id ? sourceTabIds : targetPane.tabIds),
  ];
  nextTargetTabIds.splice(insertionIndex, 0, tabId);

  let nextRootPane = mapLeafPane(state.rootPane, sourcePane.id, (pane) =>
    sourcePane.id === targetPane.id
      ? {
          ...pane,
          tabIds: nextTargetTabIds,
          activeTabId: tabId,
        }
      : removeTabFromPane(pane, tabId),
  );

  if (sourcePane.id !== targetPane.id) {
    nextRootPane = mapLeafPane(nextRootPane, targetPane.id, (pane) => ({
      ...pane,
      tabIds: nextTargetTabIds,
      activeTabId: tabId,
    }));
  }

  const normalizedRootPane = normalizeTree(nextRootPane);
  if (!normalizedRootPane) {
    return state;
  }

  return withTabFocused(
    {
      ...state,
      rootPane: normalizedRootPane,
    },
    targetPaneId,
    tabId,
  );
};

const directionForDropPosition = (
  position: WorkspaceDropPosition,
): WorkspaceSplitDirection =>
  position === "left" || position === "right" ? "vertical" : "horizontal";

const createSplitLeafForTab = (
  ids: WorkspaceIdFactory,
  tabId: WorkspaceTabId,
): WorkspaceLeafPane => createLeafPane(ids.createPaneId(), tabId);

export const splitPaneWithTab = (args: {
  state: WorkspaceSessionState;
  sourceTabId: WorkspaceTabId;
  targetPaneId: WorkspacePaneId;
  position: Exclude<WorkspaceDropPosition, "center">;
  ids: WorkspaceIdFactory;
}): WorkspaceSessionState => {
  const { state, sourceTabId, targetPaneId, position, ids } = args;
  if (!state.rootPane) {
    return state;
  }

  const sourcePane = findPaneContainingTab(state.rootPane, sourceTabId);
  const targetPane = findPane(state.rootPane, targetPaneId);
  if (!sourcePane || !targetPane) {
    return state;
  }

  if (sourcePane.id === targetPane.id && sourcePane.tabIds.length === 1) {
    return state;
  }

  const newPane = createSplitLeafForTab(ids, sourceTabId);
  const targetAfterRemoval =
    sourcePane.id === targetPane.id
      ? removeTabFromPane(targetPane, sourceTabId)
      : targetPane;

  const replacement: WorkspaceSplitPane = {
    type: "split",
    id: ids.createSplitId(),
    direction: directionForDropPosition(position),
    first:
      position === "left" || position === "top" ? newPane : targetAfterRemoval,
    second:
      position === "left" || position === "top" ? targetAfterRemoval : newPane,
    ratio: 0.5,
  };

  let nextRootPane = mapLeafPane(state.rootPane, sourcePane.id, (pane) =>
    removeTabFromPane(pane, sourceTabId),
  );
  nextRootPane = replacePane(nextRootPane, targetPaneId, replacement);
  const normalizedRootPane = normalizeTree(nextRootPane);
  if (!normalizedRootPane) {
    return state;
  }

  return withTabFocused(
    {
      ...state,
      rootPane: normalizedRootPane,
    },
    newPane.id,
    sourceTabId,
  );
};

export const splitPaneWithDocument = (args: {
  state: WorkspaceSessionState;
  documentId: string;
  title?: string;
  targetPaneId: WorkspacePaneId;
  position: Exclude<WorkspaceDropPosition, "center">;
  ids: WorkspaceIdFactory;
}): WorkspaceSessionState => {
  const { state, documentId, title, targetPaneId, position, ids } = args;
  if (!state.rootPane) {
    return createWorkspaceSessionWithDocument(
      title ? { documentId, title, ids } : { documentId, ids },
    );
  }

  const targetPane = findPane(state.rootPane, targetPaneId);
  if (!targetPane) {
    return state;
  }

  const tabId = ids.createTabId();
  const newPane = createSplitLeafForTab(ids, tabId);
  const replacement: WorkspaceSplitPane = {
    type: "split",
    id: ids.createSplitId(),
    direction: directionForDropPosition(position),
    first: position === "left" || position === "top" ? newPane : targetPane,
    second: position === "left" || position === "top" ? targetPane : newPane,
    ratio: 0.5,
  };

  const nextState: WorkspaceSessionState = {
    ...state,
    tabsById: {
      ...state.tabsById,
      [tabId]: createTab(tabId, documentId),
    },
    draftsByDocumentId: ensureDraftRecord(
      state.draftsByDocumentId,
      documentId,
      title,
    ),
    rootPane: replacePane(state.rootPane, targetPaneId, replacement),
  };

  return withTabFocused(nextState, newPane.id, tabId);
};

export const setSplitRatio = (args: {
  state: WorkspaceSessionState;
  splitPaneId: string;
  ratio: number;
}): WorkspaceSessionState => {
  const { state } = args;
  const updateRatio = (node: WorkspacePaneNode): WorkspacePaneNode => {
    if (isLeafPane(node)) {
      return node;
    }

    return {
      ...node,
      ratio: node.id === args.splitPaneId ? clampRatio(args.ratio) : node.ratio,
      first: updateRatio(node.first),
      second: updateRatio(node.second),
    };
  };

  return state.rootPane
    ? {
        ...state,
        rootPane: updateRatio(state.rootPane),
      }
    : state;
};

export const hydrateDocumentDraft = (args: {
  state: WorkspaceSessionState;
  documentId: string;
  title: string;
  markdown: string;
}): WorkspaceSessionState => {
  const currentDraft = args.state.draftsByDocumentId[args.documentId];
  const nextDraft: WorkspaceDocumentDraft = currentDraft
    ? {
        title: args.title,
        savedMarkdown: args.markdown,
        markdown:
          currentDraft.isLoaded &&
          currentDraft.markdown !== currentDraft.savedMarkdown
            ? currentDraft.markdown
            : args.markdown,
        isLoaded: true,
      }
    : {
        title: args.title,
        markdown: args.markdown,
        savedMarkdown: args.markdown,
        isLoaded: true,
      };

  return {
    ...args.state,
    draftsByDocumentId: {
      ...args.state.draftsByDocumentId,
      [args.documentId]: nextDraft,
    },
  };
};

export const updateDocumentDraft = (args: {
  state: WorkspaceSessionState;
  documentId: string;
  markdown: string;
}): WorkspaceSessionState => {
  const currentDraft = args.state.draftsByDocumentId[args.documentId];
  if (!currentDraft || currentDraft.markdown === args.markdown) {
    return args.state;
  }

  return {
    ...args.state,
    draftsByDocumentId: {
      ...args.state.draftsByDocumentId,
      [args.documentId]: {
        ...currentDraft,
        markdown: args.markdown,
      },
    },
  };
};

export const markDocumentSaved = (args: {
  state: WorkspaceSessionState;
  documentId: string;
  markdown: string;
}): WorkspaceSessionState => {
  const currentDraft = args.state.draftsByDocumentId[args.documentId];
  if (!currentDraft) {
    return args.state;
  }

  if (currentDraft.markdown !== args.markdown) {
    return args.state;
  }

  return {
    ...args.state,
    draftsByDocumentId: {
      ...args.state.draftsByDocumentId,
      [args.documentId]: {
        ...currentDraft,
        markdown: args.markdown,
        savedMarkdown: args.markdown,
      },
    },
  };
};

export const findFirstLeafPane = (
  node: WorkspacePaneNode | null,
): WorkspaceLeafPane | null => {
  if (!node) {
    return null;
  }

  return isLeafPane(node) ? node : findFirstLeafPane(node.first);
};

export const findFirstLeafPaneId = (
  node: WorkspacePaneNode | null,
): WorkspacePaneId | null => findFirstLeafPane(node)?.id ?? null;
