## Summary

Replace the current synthetic local workspace model with a real local-directory-backed file system integration for the left file tree and central editor. The frontend should navigate an actual workspace directory, open and save real files through the desktop runtime, and use filesystem-derived file identity instead of seeded document records. This plan covers the remaining integration work outside the Codex sidebar and chat transport path.

## Motivation

The current renderer already looks like a local workspace application, but the file layer underneath it is still synthetic:

- `workspaceClient` currently returns a fabricated browser tree in web mode
- `LocalWorkspaceService` seeds example documents into a controlled directory instead of representing a user-selected workspace
- the file tree still relies on seeded document ids rather than a clear local file identity model

That makes the left rail and editor feel more real than they actually are. To make the workspace fully functional, file navigation and editing must correspond to a real local directory on disk, with the desktop runtime owning filesystem access and the renderer acting as a thin client over typed preload APIs.

## Scope

This plan covers:

- `apps/desktop` workspace selection, workspace persistence, filesystem access, and preload APIs for files
- `packages/shared` contracts needed to represent a real local workspace tree and file payloads
- `apps/web` changes needed to open, save, and track real files in the file tree and editor
- integration seams between the local file client and the separately planned Codex sidebar chat client

This plan does not include:

- wiring the right sidebar to Codex or backend chat transport
- provider auth flows
- backend thread persistence changes except where a workspace identity seam is needed for future chat integration

## Proposed Changes

### Replace the seeded workspace model with a real workspace root

- Add a real workspace selection flow in the desktop runtime so the user can choose a local directory.
- Persist the current or last-opened workspace root in desktop app settings.
- Restore that workspace automatically on startup when the saved directory still exists.
- Treat the selected directory as the workspace root rather than generating a special `documents/` area owned by Magick.

### Build the file tree from the real filesystem

- Replace the seeded document list and synthetic tree generation path with tree derivation from the selected workspace directory.
- Continue to use the existing local tree node shape as a base where it still fits, but update it if necessary so it reflects actual file paths and directory structure cleanly.
- Keep the tree sorted predictably and stable across refreshes.
- Define the first-pass policy for non-Markdown files explicitly. Options include:
  - show only Markdown files
  - show all files but only allow opening supported text files
  - show unsupported files in a disabled state
- Preserve current UI expectations for nested folders, expansion state, and active-file highlighting.

### Move to file-path-based identity

- Refactor the renderer away from synthetic document ids as the primary identity for openable workspace content.
- Prefer workspace-relative file path as the primary identity for tabs, file tree selection, and editor open or save operations.
- If a stable internal id is still useful, derive it directly from the local path rather than keeping a separate seeded document registry.
- Update workspace session and tab state so file identity is stable across reloads and consistent with the real filesystem.

### Narrow the desktop preload surface to filesystem work

- Refactor `MagickDesktopApi` and the current desktop IPC handlers so local workspace APIs focus on file responsibilities such as:
  - get current workspace metadata
  - get file tree
  - open file
  - save file
  - optionally reveal or refresh workspace state
- Remove fake thread send and thread toggle behavior from the local workspace service. That responsibility belongs to the separate Codex sidebar plan.
- Keep all path validation, normalization, and root-boundary enforcement in desktop main rather than the renderer.

### Support real editor open and save flows

- Update `WorkspaceSurface` and related file-loading code to open real files through the local workspace client.
- Preserve the current editor save behavior, but have it write through to the real filesystem instead of a seeded in-memory document store.
- Ensure the open or save payload includes enough metadata for a reliable editor title and path display.
- Decide and document how save conflicts or external edits are handled in the first pass. At minimum, the system should avoid silently overwriting out-of-date content without detection.

### Support external workspace changes

- Add a workspace refresh or file-watch path so the renderer can respond when files are added, removed, renamed, or changed outside Magick.
- Preserve expanded directories and active tab state where possible when the tree refreshes.
- Handle missing files gracefully if an open file is deleted or moved externally.

### Keep the frontend data layer explicitly split

- Replace the current one-size-fits-all `workspaceClient` abstraction with a local workspace file client that is separate from chat transport.
- Compose the file client alongside the future chat client in `AppShell`, but do not merge them back into one generic abstraction.
- Keep the renderer’s file state derived from preload-backed workspace data, not from backend chat bootstrap.

### Suggested module work

- `packages/shared/src/localWorkspace.ts`
  - narrow the contract toward workspace and file payloads
  - remove thread-focused responsibilities that are moving to backend chat contracts
- `apps/desktop/src/main/localWorkspaceService.ts`
  - replace seeded document logic with real workspace scanning and file I/O
- `apps/desktop/src/main/main.ts`
  - register file-oriented IPC handlers for the selected workspace
- `apps/desktop/src/preload/index.ts`
  - expose a file-focused desktop API to the renderer
- `apps/web/src/features/workspace/`
  - update file tree, open-document, and save-document flows to use real file identities
- `apps/web/src/app/AppShell.tsx`
  - bootstrap the file tree from the local workspace file client independently from chat bootstrap

## Risks

- Moving from seeded document ids to file-path-based identity will likely require broad renderer updates in tabs, file tree state, and open-document handling.
- External file edits introduce overwrite and refresh risks if conflict handling is underspecified.
- Filesystem scanning and watch behavior can become platform-sensitive if path normalization and event handling are not carefully bounded.
- If the desktop API remains too broad, the renderer may stay coupled to runtime details instead of clean file operations.

## Validation

- Unit tests should cover path normalization, tree derivation, file identity mapping, and file open or save helpers.
- Desktop integration tests should cover:
  - opening a workspace directory
  - building the file tree from nested folders
  - opening a file
  - saving a file
  - reacting to missing or externally changed files where supported
- Frontend tests should cover file tree rendering, active file selection, and open-tab behavior using path-based file identity.
- Playwright checks should verify both extracted DOM or text state and targeted screenshots for:
  - the left file tree structure
  - opening a nested file
  - saving content and observing the editor update
  - handling at least one real workspace refresh path if implemented
- Required implementation validation commands remain `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.

## Completion Criteria

- The left file tree reflects a real local workspace directory instead of synthetic seeded data.
- Opening and saving a file reads and writes the actual local file on disk.
- The renderer uses a filesystem-derived file identity consistently across the tree, tabs, and editor.
- The desktop preload surface is focused on local workspace and file operations rather than mixed file-and-chat behavior.
- The local file client is clearly separated from the future Codex chat client.
