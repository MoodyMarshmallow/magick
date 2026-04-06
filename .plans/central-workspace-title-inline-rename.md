## Summary

Add inline rename to the central workspace document title so clicking the visible title switches it into an editable input. The interaction should follow the existing active-thread rename flow in the right sidebar, but keep the central workspace title typography and layout. The visible title should be the filename stem without its extension, with no prettifying or extra formatting. Renaming should update the underlying file name, treat blank input as a request to reuse the last known non-empty title when available, fall back to `untitled` only when no prior title exists, and resolve same-directory collisions by appending ` 1`, ` 2`, and so on while still allowing the same title to exist in different directories.

## Motivation

The central workspace currently displays the active document title as static text even though rename already exists in the file tree and in the right sidebar chat heading. That makes the main editing surface feel less direct than the surrounding UI.

Adding inline rename here improves:

- discoverability because the title itself becomes the obvious rename affordance
- consistency with the existing chat-heading rename interaction
- speed for the common case where the user wants to rename the document they are already editing
- predictability by keeping rename behavior anchored to the active file instead of requiring a trip back to the file tree

## Scope

This plan covers:

- inline editing for the active document title inside `WorkspaceSurface`
- wiring the rename through the existing local workspace file rename flow
- title-to-file-name normalization rules for blank input and same-directory collisions
- workspace session and query updates so open tabs keep pointing at the renamed file
- unit and component coverage for the new interaction and rename rules

This plan does not include:

- multi-file batch rename behavior
- changing how directory rename works
- a separate visible path editor for extensions or parent folders
- mobile-specific interaction tuning

## Proposed Changes

### Reuse the chat-heading inline edit pattern in the workspace title

- Update `apps/web/src/features/workspace/components/WorkspaceSurface.tsx` so the rendered `.workspace__document-title` becomes a button-like trigger when a document is active.
- Mirror the right-sidebar active-thread rename flow from `CommentSidebar.tsx`:
  - local `editingDocumentId` state
  - local draft value
  - focus-and-select on entry into edit mode
  - commit on blur
  - `Escape` cancels
  - `Enter` commits
- Keep the edit session scoped to the active document in the active pane so we do not introduce cross-pane rename state unless it becomes necessary.

### Keep workspace-title visual styling while editing

- Preserve the current central-title look from `.workspace__document-title` in `apps/web/src/app/styles.css`.
- Introduce a workspace-specific input class that reuses the structural behavior of `.thread-title-input` but swaps in the existing title typography:
  - `Alegreya`
  - heading font size
  - current padding, line-height, overflow, and background treatment
- Make the non-editing title look clickable without changing the established visual language too aggressively. A minimal button reset and subtle hover treatment should be enough.

### Treat the edited value as a file rename request

- On commit, call the existing file rename path rather than only mutating a draft title.
- Add an explicit rename callback into `WorkspaceSurface` or lift a small title-rename handler from `AppShell` into a reusable prop, following the same pattern already used for file-tree rename.
- Reuse the existing `localWorkspaceFileClient.renameFile(...)` path so desktop, dev, and browser fallback stay aligned.
- Continue updating workspace session state via `useWorkspaceSessionStore.getState().renameDocument(...)` so open tabs, focused tabs, and drafts move to the renamed path.

### Define title-to-file-name rules clearly

- The visible and editable title should be the filename stem without its parent path and without the trailing file extension.
- Example: `test.md` should display as `test`.
- Do not title-case, prettify, slugify, normalize separators, or otherwise transform the text for display.
- Preserve the current file extension during rename.
- Blank or whitespace-only input should resolve to the last known non-empty filename title before collision handling.
- If there is no prior non-empty filename title to reuse, blank or whitespace-only input should resolve to `untitled`.
- Same-directory duplicates should be resolved automatically:
  - `untitled`
  - `untitled 1`
  - `untitled 2`
- Duplicates in different directories should remain allowed because collision checks should stay sibling-scoped.
- Keep case-only rename support intact with the recently added same-entry handling.
- Edit-to-filename processing should only:
  - trim leading and trailing whitespace
  - reuse the last known non-empty title or `untitled` for blank results
  - append collision suffixes when a sibling already uses the same filename
- Other than those rules, preserve the user-entered text exactly.

### Centralize sibling-title collision resolution

- Today rename flows mostly reject sibling collisions. For this feature, title-driven rename needs a shared helper that can generate the next available sibling name instead of surfacing an avoidable error.
- Add a pure helper in the local workspace file layer that:
  - trims the requested title
  - falls back to the last known non-empty title when available
  - otherwise falls back to `untitled`
  - preserves extension
  - checks only sibling entries in the same directory
  - appends ` 1`, ` 2`, and so on until the target file name is free
- Apply that helper consistently across:
  - browser fallback logic in `apps/web/src/features/workspace/data/localWorkspaceFileClient.ts`
  - desktop filesystem logic in `apps/desktop/src/main/localWorkspaceService.ts`
  - dev-server logic if it has separate rename handling
- Keep the helper narrow and file-specific; directory rename behavior should stay unchanged unless there is a clear follow-up requirement.

### Reconcile display-title behavior

- Audit the current title source so the workspace title keeps matching the renamed file after commit.
- Remove the current title-formatting drift between desktop and browser fallback by making the display title equal to the filename stem used by the file layer.
- Prefer a single shared filename-display rule from the file path basename with the extension removed, without parent directories and without extra formatting.
- If needed, introduce a small shared utility for filename display and use it wherever file payloads are created or renamed.

### Suggested module touchpoints

- `apps/web/src/features/workspace/components/WorkspaceSurface.tsx`
  - add inline edit state and commit/cancel handling
- `apps/web/src/app/AppShell.tsx`
  - expose a reusable active-document rename handler if `WorkspaceSurface` should not call the client directly
- `apps/web/src/app/styles.css`
  - add workspace-title button/input styles based on the existing title styling
- `apps/web/src/features/workspace/data/localWorkspaceFileClient.ts`
  - add or reuse a sibling-name resolution helper in browser mode
- `apps/web/dev/localWorkspaceDevServer.ts`
  - align dev rename behavior if it performs its own filename sanitization or collision checks
- `apps/desktop/src/main/localWorkspaceService.ts`
  - add sibling collision auto-resolution for file rename while preserving extension and case-only rename safety

## Risks

- Existing title formatting paths may still be scattered across desktop and browser fallback, so switching to exact-filename display should be centralized rather than patched in one UI component only.
- Auto-resolving collisions is user-friendly, but it changes rename semantics from “fail on collision” to “pick the next available name,” so the behavior must be well tested and predictable.
- Inline rename in the workspace header can clash with pane focus, drag behavior, or editor focus if blur/commit timing is not handled carefully.
- If `WorkspaceSurface` reaches into too much app-level rename logic directly, the component can become harder to test.

## Validation

- Add pure tests first for the sibling-name resolution helper:
  - blank input reuses the last known non-empty title when present
  - blank input becomes `untitled` when no prior non-empty title exists
  - duplicate same-directory titles resolve to numbered variants
  - duplicates in different directories remain valid
  - extension is preserved
  - case-only rename of the same entry still succeeds
- Add tests proving edit-to-filename processing only trims surrounding whitespace and applies collision suffixing, without any other text transformation.
- Add tests for filename-display normalization so desktop, dev, and browser fallback all expose the same visible title for the same file path.
- Add desktop service tests for file rename collision auto-resolution in `apps/desktop/src/main/localWorkspaceService.test.ts`.
- Add browser fallback tests in `apps/web/src/features/workspace/data/localWorkspaceFileClient.test.ts` for the same rename rules.
- Add `WorkspaceSurface` component tests covering:
  - clicking the title enters edit mode
  - `Enter` commits
  - `Escape` cancels
  - blur commits
  - blank title renames to `untitled`
  - rename keeps the visible title and open tab aligned with the new file path
- If the changed area is visually sensitive, verify it with Playwright and capture a targeted screenshot under `.playwright-cli/`.
- Required repo validation commands remain `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.

## Completion Criteria

- Clicking the active document title in the central workspace enters inline rename mode.
- The editing control behaves like the existing chat-heading rename interaction for focus, blur, `Enter`, and `Escape`.
- The editing state uses the central workspace title styling rather than the sidebar mono title styling.
- The visible title exactly matches the filename stem used by the file layer, without the extension and without extra display formatting.
- Committing a blank title reuses the last known non-empty title when one exists.
- Committing a blank title falls back to `untitled` only when no prior non-empty title exists.
- Committing a colliding title in the same directory automatically resolves to `title 1`, `title 2`, and so on.
- The same title can still exist in different directories.
- Open workspace tabs and drafts remain attached to the renamed file path.
- All required validation commands pass: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
