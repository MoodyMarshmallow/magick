## Summary

Reframe Magick from a browser-first web app into a local desktop application built with an Electron-style shell, a React renderer, and local-first persistence for files, documents, threads, and app state. The app should keep the rich editor and thread-based workflow from the reference plan, but run entirely on the user machine with predictable local storage, offline-tolerant behavior, and clear boundaries between renderer UI, desktop runtime, and persistence services.

## Motivation

The reference plan is still useful for one core idea: a controlled editor surface with hidden persistence artifacts and attached discussion threads. The major change is deployment and ownership. Instead of treating the product like a hosted web app backed by a remote server, the desktop app should own its own filesystem access, local metadata, thread history, and provider sessions on the machine where the user runs it.

That direction better matches the product goals and repo priorities:

- local files and local threads reduce operational complexity and make behavior easier to reason about
- desktop ownership makes persistence, recovery, and workspace navigation feel more natural for a writing and productivity tool
- correctness and durability improve when file writes, thread metadata, and provider session state are coordinated in one local runtime
- maintainability improves if the UI stays a renderer client while filesystem, SQLite, and provider secrets stay outside the renderer boundary

The reference repos remain useful, but as directional inputs only. OpenCode and CodexMonitor are especially helpful for desktop shell patterns, multi-pane workspace UX, and keeping the UI separate from transport/runtime details.

## Scope

This plan covers:

- a desktop application shell, likely `apps/desktop`, using Electron or an Electron-equivalent architecture
- a React renderer reused from or extracted out of the current `apps/web` UI
- local-first persistence for Markdown files, thread history, document metadata, workspace indexes, and app settings
- a secure bridge between renderer and local runtime for filesystem, database, and provider operations
- preserving thread-linked editor flows while removing the assumption of a remote server-backed web client

This plan does not include:

- cloud sync as a requirement for the first desktop pass
- real-time multi-user collaboration
- background daemons or multi-machine state reconciliation
- a full migration away from the existing server code on day one if reuse through local embedding is materially simpler

## Proposed Changes

### Product and Architecture Direction

- Introduce a dedicated desktop shell, preferably `apps/desktop`, with three layers:
  - `main` process for native windowing, filesystem access, database access, provider integration, and secure storage
  - `preload` bridge for narrow, typed IPC APIs exposed to the renderer
  - `renderer` React application for the editor, file tree, threads, and workspace UX
- Keep the renderer as close as possible to a normal React app so design iteration remains fast and future portability stays possible.
- Move all direct file, database, credential, and provider calls out of the renderer. The renderer should talk only to typed IPC contracts.
- Prefer a local-first architecture over a localhost web server unless reusing the existing orchestration runtime inside the desktop process is clearly the lowest-risk migration path.

### Local Persistence Model

- Store documents as real Markdown files on disk so the user owns their content directly.
- Store thread history, document indexes, thread-to-document linkage, settings, and other mutable metadata in a local SQLite database.
- Use stable local thread ids and persist them in document anchor directives when exact text linkage is still needed.
- Store app settings and lightweight UI preferences separately from document/thread content so accidental UI corruption does not threaten user data.
- Use explicit write paths and transaction boundaries so saving a document and saving its related thread metadata cannot silently drift apart.

### File and Thread Ownership

- Treat files and threads as local workspace data, not remote entities.
- Each document should have a stable local document id plus a real file path.
- Each thread should belong to exactly one local document and should be queryable by document id without scanning all files.
- If the editor continues to use hidden inline anchors, those anchors should reference local thread ids, not remote backend ids.
- Thread messages should remain append-only records in local storage so recovery, auditability, and replay stay easy to debug.

### Runtime and Provider Integration

- Keep provider credentials, auth refresh tokens, and local provider session state in the desktop runtime, not the renderer.
- If existing provider orchestration from `apps/server` can be embedded or extracted into reusable services, prefer that over rewriting complex provider logic in the renderer.
- Use promises/plain TypeScript by default for local persistence, file operations, and desktop orchestration, following `AGENTS.md`.
- Only keep Effect in streaming/runtime boundaries where it is already central and materially useful.
- Design the local provider runtime so the renderer sees typed events and thread updates, not provider-specific transport details.

### Suggested Package and App Layout

- `apps/desktop` for Electron main/preload/window lifecycle
- `apps/desktop/src/main` for native app startup, IPC registration, local services, and secure storage wiring
- `apps/desktop/src/preload` for typed renderer bridge APIs
- `apps/web` or a shared renderer package for the React UI, depending on whether the renderer is best kept in place or extracted into a shared package
- `packages/shared` for reusable local domain logic such as thread projection, file indexing helpers, and local persistence mappers
- `packages/contracts` for IPC-safe schemas and shared type contracts where they still add value outside the browser/WebSocket world

### Data Access and Security Boundaries

- Disable direct Node access from the renderer and expose only a small preload API surface.
- Define explicit operations such as:
  - open workspace
  - list files
  - read document
  - save document
  - list threads for document
  - append thread message
  - resolve/reopen thread
  - run provider action
- Validate all renderer-to-runtime payloads with shared schemas before they hit the filesystem or database.
- Treat filesystem paths as untrusted inputs and normalize them in the main process before use.

### UI Direction

- Keep the current digital-magick renderer direction, but adapt it to a desktop workspace rather than a browser page.
- Use a left rail for local file navigation, a central editor surface for document content, and a right rail for document-scoped threads.
- Replace any remaining remote/web wording with local workspace language such as files, folders, workspace, thread history, and saved state.
- Ensure thread lists are document-scoped by default, with thread expansion and reply flows staying local-first.
- Preserve the editor-thread linkage model only if it is still materially useful; if quote-free generic threads prove better for the product, keep the desktop architecture flexible enough to simplify the editor model later.

### Migration Strategy

- Phase 1: establish `apps/desktop`, window boot, preload bridge, and renderer boot using the existing React UI
- Phase 2: replace demo/browser-only data sources with local filesystem and SQLite-backed services
- Phase 3: move thread, document, and settings persistence fully local and verify crash/restart recovery
- Phase 4: integrate provider runtime through local main-process services with typed renderer events
- Phase 5: harden desktop packaging, migrations, error recovery, and data backup/export paths

## Risks

- Electron can accumulate security and IPC complexity quickly if the renderer is allowed to reach native APIs directly.
- Mixing raw Markdown files with separate thread metadata introduces consistency risk if save operations are not coordinated carefully.
- Reusing too much browser/WebSocket-oriented code without adapting the abstractions can leave the desktop app with awkward local architecture.
- Local databases require migration discipline; schema churn without versioned migrations will make upgrades fragile.
- Desktop packaging, signing, and path differences across macOS, Linux, and Windows can become a drag if not planned early.

## Validation

- Unit tests should cover local document parsing/serialization, path normalization, SQLite repository behavior, IPC request validation, thread projection, and failure/recovery flows.
- Build tests bottom-up: start with local helpers and repositories, then preload contracts, then higher-level orchestration.
- Desktop integration tests should cover workspace open, document read/write, thread creation and reply persistence, restart recovery, and failed writes.
- End-to-end tests should cover opening a local workspace, editing a file, creating or opening a thread, replying in that thread, closing the app, reopening it, and confirming data is preserved locally.
- Packaging verification should cover at least one packaged desktop build path before calling the project complete.
- Required repo validation commands remain `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.

## Completion Criteria

- A desktop shell exists and can launch the Magick renderer locally.
- Files, threads, and related metadata are persisted locally without requiring a remote server.
- The renderer talks to typed local APIs instead of directly touching filesystem or credential logic.
- Opening a document, editing it, opening a thread, replying, and reopening the app all work with preserved local state.
- Persistence boundaries are clear: Markdown files live on disk, mutable metadata lives in a local database, and secrets remain outside the renderer.
- The architecture stays maintainable and testable, with local services extracted cleanly rather than embedded ad hoc inside UI components.
- All required validation commands pass for implementation work: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
