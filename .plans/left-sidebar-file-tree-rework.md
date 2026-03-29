## Summary

Rework the left sidebar into a collapsible file navigator modeled after VSCode and Obsidian, with expandable folders, clear active-file state, and local-workspace semantics that fit Magick's desktop-first direction.

## Motivation

The current left sidebar is a flat document list, which is too limited for a desktop app that stores files locally. A dropdown-style tree will better match user expectations for navigating folders, nested notes, and workspace structure. It also aligns with the recent desktop/local-first direction: users should feel like they are browsing a real workspace on disk, not switching between a few synthetic app records.

This change should improve:

- discoverability of local files and folders
- scalability as the workspace grows beyond a couple of documents
- consistency with desktop writing and coding tools
- future support for file actions like create, rename, move, and reveal in folder

## Scope

This plan covers:

- the left sidebar UI and interaction model
- the data shape needed to represent folders and nested files
- renderer-side state for expanded/collapsed tree nodes
- desktop/local API changes required to expose a tree instead of a flat list

This plan does not include:

- drag-and-drop reordering or moving files
- context menus for file operations
- fuzzy search, recent files, or tabs
- multi-root workspaces in the first pass

## Proposed Changes

- Use `@headless-tree/core` and `@headless-tree/react` as the implementation foundation for the file navigator.
- Prefer Headless Tree over a batteries-included visual tree because Magick needs a highly custom renderer that matches the current flat digital-magick aesthetic without fighting library DOM or opinionated styling.
- Treat Headless Tree as the source of tree behavior and accessibility, while Magick continues to own node rendering, spacing, active states, icons, and section structure.
- Replace the flat `documents` list returned to the renderer with a hierarchical workspace tree that distinguishes folders and files.
- Add a shared tree node contract, for example:
  - `type: "directory" | "file"`
  - `id`
  - `name`
  - `path`
  - `children?`
  - file metadata such as `documentId` and `threadCount` for file nodes
- Extend the local desktop workspace service so it can derive a stable tree from the local workspace directory rather than returning only flat summaries.
- Keep the renderer's active document state separate from the file tree expansion state, but let Headless Tree own as much expansion/focus/keyboard state as practical.
- Add local UI state for:
  - active file/document id
  - optionally hovered tree node id
- Refactor the left sidebar into explicit tree components, likely something like:
  - `FileTree`
  - `FileTreeNode`
  - `FileTreeDirectoryRow`
  - `FileTreeFileRow`
- Add a tree adapter layer that converts Magick workspace data into the item model Headless Tree expects.
- Keep this adapter pure and well-tested so filesystem shape changes do not leak directly into renderer components.
- Use collapsible rows with a small chevron or disclosure triangle for directories.
- Keep file rows visually flatter and simpler than folder rows so the tree remains readable at depth.
- Support these core interactions:
  - click folder to expand/collapse
  - click file to open document
  - preserve expansion state while switching files
  - preserve active file highlight clearly
- Ensure the tree can render nested folders recursively without duplicating indentation logic in multiple places; rely on Headless Tree item metadata for depth/indent rather than hand-rolling recursive spacing rules.
- Keep styling aligned with the current digital-magick direction: flat surfaces, restrained linework, low-noise hover states, and clear active-file emphasis.
- If the current seeded local workspace is still synthetic, update it so the left sidebar can demonstrate at least one nested folder path.

### Headless Tree Integration Notes

- Start with a narrow Headless Tree feature set:
  - expansion/collapse
  - focus and keyboard navigation
  - active-file selection sync
- Do not enable drag/drop, rename, or search in the first pass unless the supporting workspace operations already exist.
- Use Headless Tree's flat render model to keep the DOM simple and compatible with the current sidebar styling.
- Keep Magick's document-open action as the source of truth when a file node is activated; tree selection should reflect app state, not replace it.
- If Headless Tree introduces too much conceptual overhead in the first implementation, constrain usage to a thin wrapper component so the rest of the sidebar does not become library-shaped.

## Risks

- If the tree contract is too tied to the current seeded workspace shape, it will become brittle once real filesystem discovery is added.
- Headless Tree is beta, so API churn or rough edges are possible.
- Tree integration can become hard to maintain if the Headless Tree adapter, renderer components, and app selection state are not clearly separated.
- Deeply nested trees can feel visually noisy if indentation, hover states, and active states are not carefully controlled.
- Folder expansion state can feel frustrating if it resets on every document reload or workspace refresh.

## Validation

- Unit tests should cover tree-shaping helpers, any path-to-tree transformation logic, and the Headless Tree adapter layer.
- Build tests bottom-up: test pure tree builders first, then tree adapter helpers, then expansion/selection helpers, then component behavior.
- Component tests should cover:
  - expanding and collapsing directories
  - opening a file from nested folders
  - preserving active-file state
  - preserving expanded state across file switches
- Add at least one integration-oriented test around the Headless Tree wrapper so library-driven node activation and Magick document selection stay in sync.
- End-to-end checks should verify that the left sidebar behaves like a file navigator rather than a flat picker.
- Required repo validation commands remain `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.

## Completion Criteria

- The left sidebar renders a hierarchical file tree instead of a flat document list.
- Users can expand/collapse folders and open nested files.
- Active file state is clearly shown and remains stable while navigating the tree.
- Tree expansion state is managed predictably and does not reset unnecessarily.
- The desktop/local data layer exposes a file tree contract cleanly enough to support future file operations.
- All required validation commands pass: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
