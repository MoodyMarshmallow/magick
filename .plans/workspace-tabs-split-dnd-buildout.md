## Summary

Add a workspace session system to the frontend that supports multiple open Markdown documents, tabbed editing, split-screen panes, and full drag-and-drop interactions for tab reordering and pane placement. The result should feel like a local desktop editor rather than a single-document page shell, while staying maintainable and predictable under future growth.

## Motivation

The current renderer is still fundamentally single-document:

- one `activeDocumentId`
- one `markdown` buffer
- one editor instance in the center pane
- one hard-coded central workspace layout

That structure is now too limiting for the desktop/local-first direction. A local workspace should let users keep several Markdown files open, compare documents side by side, and move them around fluidly without feeling like they are constantly leaving and reopening one editor.

This change should improve:

- multi-document workflows such as drafting, comparing, and copying between files
- desktop-tool credibility by behaving more like an editor and less like a single-view page
- future extensibility for session persistence, pinned tabs, file previews, and richer workspace behaviors
- maintainability by moving workspace composition concerns into a dedicated session model instead of continuing to expand `AppShell`

This also fits the repo priorities in `AGENTS.md`:

- predictable state should be favored over ad hoc local UI mutations
- maintainability improves if tab, split, and drag behavior live in one explicit workspace model
- correctness matters because drag/drop, split collapse, and active-pane targeting can easily drift into inconsistent state if they are not modeled centrally

## Scope

This plan covers:

- a workspace session state model for open documents, panes, tabs, and focus
- a tab strip for each document pane in the main workspace
- recursive split panes in the center workspace area
- drag-and-drop for tab reorder, cross-pane moves, and split-target drops
- pane resizing for center splits
- file-tree behavior that opens documents into the focused pane/tab context
- test coverage for pane-tree logic, tab movement, and drag/drop state transitions

This plan does not include:

- drag-and-drop from the file tree directly into split targets in the first pass
- pinned tabs, tab groups, tab history, or tab search in the first pass
- persisting workspace session layout on disk in the first pass
- arbitrary floating windows or detached panes
- a mobile-specific tab or split UX beyond preserving the current stacked responsive layout

## Proposed Changes

### Product Direction

- Treat the center workspace as a document session system rather than a single editor.
- Keep the left file tree as the document-open entry point.
- Keep the right sidebar as a workspace-global chat pane for now, independent of document tabs, since chats are already being decoupled from files.
- Make the focused center pane the target for file-open actions from the tree.

### Core State Model

- Introduce a dedicated workspace session store under `apps/web/src/features/workspace/state/`.
- Move tab, pane, and focus state out of `AppShell` and into that store.
- Keep persisted document payloads in React Query or a similar fetch layer; do not duplicate canonical file contents into the pane tree itself.
- Model tabs as global session entities referenced by panes, rather than embedding full document state into each pane node.

Suggested shape:

- `WorkspaceTab`
  - `id`
  - `documentId`
  - `title`
  - `isDirty`
  - `draftMarkdown | null`
- `WorkspaceLeafPane`
  - `id`
  - `tabIds`
  - `activeTabId`
- `WorkspaceSplitPane`
  - `id`
  - `direction: "horizontal" | "vertical"`
  - `first`
  - `second`
  - `ratio`
- `WorkspacePaneNode = WorkspaceLeafPane | WorkspaceSplitPane`
- `WorkspaceSessionState`
  - `rootPane`
  - `tabsById`
  - `focusedPaneId`
  - `focusedTabId`

Recommended v1 rule:

- a single document may be opened in multiple tabs and panes at once
- all open instances of the same document must share one live draft state and stay synchronized in real time
- opening a file from the tree should reuse an existing open tab, preferring the most recently focused matching tab

This keeps the workspace flexible for side-by-side comparison while still avoiding uncontrolled duplicate draft state.

### Pane Tree Architecture

- Represent split layouts as a recursive tree instead of an array of columns.
- Use split nodes to support nested layouts and predictable collapse behavior.
- When a pane becomes empty, collapse it and promote the remaining sibling.
- Keep split ratios explicit in state so center-pane resizing is deterministic and testable.

This tree model should support:

- one-pane workspace
- two-pane split
- nested splits for three or more visible panes
- future workspace persistence without redesigning the shape later

### Tab System

- Add a tab strip at the top of each leaf pane.
- Each tab should support:
  - active state
  - dirty state
  - close
  - reorder within the pane
  - move into another pane
- A leaf pane should render one editor host for its active tab only.
- Closing the active tab should activate a neighbor predictably.
- If a pane loses its last tab, remove the pane and normalize the split tree.

Suggested components:

- `WorkspaceShell`
- `PaneGrid`
- `WorkspacePane`
- `DocumentTabs`
- `DocumentTab`
- `DocumentEditorHost`
- `PaneResizer`

### Drag and Drop

- Use `dnd-kit` for tab drag-and-drop in the renderer.
- Support these interactions in v1:
  - reorder tabs within a pane
  - move a tab from one pane to another pane
  - drop into another pane's tab strip to merge
  - drop onto left, right, top, or bottom edge of a pane to create a split
  - drag files from the left tree into tab strips and split targets
- Add a clear drag overlay and explicit drop zones so users can predict the resulting placement.
- Preserve keyboard-accessible drag support if the chosen `dnd-kit` sensor setup makes that practical.

Recommended drop model:

- center target: merge into target pane tab strip
- left target: create split, new tab on left
- right target: create split, new tab on right
- top target: create split, new tab on top
- bottom target: create split, new tab on bottom

### File Tree Integration

- Clicking a file in the tree should open it in the focused pane.
- If no pane is focused, open into the most recently focused pane, or the only pane if there is just one.
- If the document is already open, reuse the most recently focused matching tab instead of opening a duplicate from the tree.
- Keep tree expansion state separate from workspace tab state.
- Tree drag/drop should use the same drop-target model as tab drag/drop.

### Editor and Draft Ownership

- Remove the single global `markdown` buffer from `AppShell` in favor of per-tab draft ownership.
- Each tab should own its current in-memory draft for the associated document.
- Persist saves per document id, not per pane.
- Prefer shared document draft state per tab, not multiple conflicting drafts for the same document.

Recommended v1 behavior:

- each document id owns one shared in-memory draft state regardless of how many panes or tabs currently show it
- all visible instances of the same document should update in real time from that shared draft state
- saves are debounced per document
- switching panes or tabs should never discard unsaved draft content silently

### Right Sidebar Behavior

- Keep the right sidebar workspace-global in the first pass.
- Do not make chat state pane-scoped yet.
- Avoid coupling the new center-pane workspace work to a simultaneous chat-pane refactor.
- If later needed, pane-scoped chat focus can be layered on top of the workspace session model after tabs and splits are stable.

This keeps the first implementation narrow and avoids coupling two large state migrations together.

### Suggested Module Layout

- `apps/web/src/features/workspace/state/workspaceSessionTypes.ts`
- `apps/web/src/features/workspace/state/workspaceSessionStore.ts`
- `apps/web/src/features/workspace/state/workspaceSessionSelectors.ts`
- `apps/web/src/features/workspace/state/workspaceSession.test.ts`
- `apps/web/src/features/workspace/components/WorkspaceShell.tsx`
- `apps/web/src/features/workspace/components/PaneGrid.tsx`
- `apps/web/src/features/workspace/components/WorkspacePane.tsx`
- `apps/web/src/features/workspace/components/DocumentTabs.tsx`
- `apps/web/src/features/workspace/components/DocumentTab.tsx`
- `apps/web/src/features/workspace/components/DocumentEditorHost.tsx`
- `apps/web/src/features/workspace/components/PaneDropOverlay.tsx`
- `apps/web/src/features/workspace/components/PaneResizer.tsx`
- `apps/web/src/features/workspace/dnd/*`

### Suggested Implementation Phases

- Phase 1: extract a workspace session store and support one pane with multiple tabs
- Phase 2: replace the single central editor with leaf-pane editor hosts driven by the workspace store
- Phase 3: add recursive split panes and center-pane resize behavior
- Phase 4: add tab reorder and cross-pane drag/drop
- Phase 5: add split-target drag/drop and empty-pane collapse normalization
- Phase 6: harden focus behavior, keyboard interactions, and test coverage
- Phase 7: optionally persist workspace session layout after the interaction model proves stable

### Confirmed V1 Decisions

- a document may be opened in multiple panes or tabs at once
- edits to all open instances of the same document must synchronize in real time
- all four split directions are supported in the first pass
- opening a file from the tree should reuse an existing open tab, preferring the most recently focused match
- workspace layout persistence is deferred until after the interaction model is stable
- drag/drop should support both tabs and left-tree files in the first pass

## Risks

- If tab and split state remains in `AppShell`, the workspace logic will become brittle and difficult to test.
- If duplicate document views are allowed without one shared draft source, save and draft behavior will become inconsistent across panes.
- Drag/drop and pane-resize sensors can interfere with each other if their hit regions and pointer ownership are not designed carefully.
- Deeply nested pane trees can become difficult to reason about if pane collapse rules are not explicit and well-tested.
- If the right sidebar is made pane-aware during the same change, the scope may grow enough to make the first implementation unstable.
- If workspace session persistence is introduced too early, the team may lock in weak interaction semantics and then have to migrate them later.

## Validation

- Unit tests should cover pane-tree split helpers, tab reorder and move helpers, empty-pane collapse behavior, focus reconciliation, and drop-target resolution.
- Unit tests should also cover shared-draft synchronization across multiple open instances of the same document.
- Component tests should cover opening files into the focused pane, switching tabs, closing active tabs, rendering nested splits, and resizing panes.
- Drag-and-drop tests should cover reordering tabs, moving tabs between panes, dropping on split targets, and dragging files from the tree into both tab strips and split targets.
- Integration tests should cover opening multiple documents, splitting the workspace, moving tabs around, and ensuring unsaved drafts are preserved across pane and tab switches.
- Integration tests should also verify that opening the same document in multiple panes keeps all editor instances visually synchronized.
- End-to-end checks should cover a realistic desktop workflow: open several Markdown files, create a split, drag tabs between panes, resize panes, and confirm the resulting layout behaves predictably.
- Required repo validation commands remain `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.

## Completion Criteria

- The center workspace supports multiple open Markdown files in tabs.
- Users can split the center workspace into multiple panes and resize those panes.
- Tabs can be reordered within a pane and moved between panes with drag-and-drop.
- Files can be dragged from the left tree into panes and split targets.
- Dropping a tab on pane edges creates new splits predictably.
- The same document can be visible in multiple panes at once, with synchronized live edits across all open instances.
- Empty panes collapse cleanly without corrupting the pane tree.
- File-tree opens target the focused pane and reuse the most recently focused existing tab when applicable.
- The new workspace session logic is centralized, testable, and no longer dependent on a single `activeDocumentId` + one global editor buffer.
- All required validation commands pass for implementation work: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
