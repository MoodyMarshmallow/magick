## Summary

Build `apps/web` as a document-centric frontend for Magick with a rich editing surface, anchored comments, and AI-assisted replies, while treating every comment as a first-class backend thread. The frontend should feel calm and polished, but the core architecture should stay server-authored, replay-safe, and maintainable under streaming, reconnects, and future provider growth.

## Motivation

The reference plan is directionally right about one important product idea: users should interact with a clean editor and comment sidebar, not with raw persistence artifacts. The part that should change for Magick is how comments are modeled. Instead of inventing a separate frontend comment system and syncing it later, each comment should map directly to a backend thread from the start.

That approach fits Magick's existing backend direction and the repo priorities in `AGENTS.md`:

- correctness and predictability matter more than clever local state
- the server should remain authoritative for thread state, replay, and recovery
- maintainability improves if comments and conversations share one thread model instead of two parallel systems
- future Codex features are easier to add when comment conversations already use the same transport, auth, and streaming foundations as the rest of the app

The reference repos reinforce this shape. CodexMonitor and OpenCode both benefit from clear thread ownership, durable recovery flows, and separation between transport logic and UI. T3 Code is also a good reminder to keep the first version narrow and coherent.

## Scope

This plan covers the initial frontend needed to support:

- a rich document editor backed by Markdown persistence with hidden anchor directives
- comment creation on selected text
- one backend thread per comment
- replying to a comment by sending messages into that same backend thread
- a sidebar that shows comment threads, streaming replies, and thread state
- typed bootstrap, WebSocket, replay, and reconnect handling
- provider auth and capability-aware UI entry points
- clear state boundaries, test coverage, and validation requirements

This plan does not include:

- full multi-user collaborative editing or CRDT-style concurrency
- broad provider-specific advanced panes before stable contracts exist
- speculative client-authored transcript state that competes with backend authority
- full Google Docs parity in the first pass

## Proposed Changes

### Business Logic

#### Core model

- Treat the document and the conversations as two related but distinct domains: the document stores content plus hidden comment anchors, while comment discussion lives in backend threads.
- Make the mapping one-to-one: one anchored comment span corresponds to one backend thread, and all replies on that comment are just additional messages in that backend thread.
- Use the backend `threadId` as the canonical identifier for the anchor whenever possible. That keeps document markup, sidebar state, and backend transport aligned around one id instead of requiring a separate comment id to thread id lookup layer.
- Keep the visible editing model separate from the persisted Markdown string. Users should edit rich content, not anchor syntax.

#### Document persistence and anchor representation

- Persist Markdown with hidden paired directives around commented spans.
- Prefer a syntax that can carry the backend thread id directly, for example `::comment-start[thread_123]{}` and `::comment-end[thread_123]{}`.
- Parse those directives into protected invisible boundary nodes or metadata in the editor model.
- Serialize them back to Markdown without exposing them during normal editing.
- Reject or repair obviously invalid anchor structure instead of silently saving corrupt markup.

#### Comment-to-thread workflow

- On "Add comment", the frontend should create the backend thread first, then insert the anchor pair using that returned `threadId`, then send the initial comment body as the first message in that thread.
- The initial thread creation payload should include document-specific metadata such as `documentId`, selected text, and a compact quote or preview so the backend can return useful thread summaries for the sidebar.
- Replying to a comment should never create a new conversation object on the client. It should call the normal backend send-message flow for that existing `threadId`.
- Resolving, reopening, or otherwise managing a comment should be modeled as backend thread state or metadata, not as a separate frontend-only comment status system.

#### Required backend-facing contract shape

- Extend thread creation so the backend can distinguish ordinary chat threads from document-comment threads.
- Add thread metadata for document comments, at minimum: `documentId`, `anchorText` or preview text, and room for future anchored range metadata.
- Ensure bootstrap and thread list reads can return document-scoped thread summaries so the frontend can render comments for the current document without fetching unrelated conversations.
- Keep replies, streaming deltas, retries, and reconnect behavior on the same thread transport that Magick already uses for chat.
- If thread projection logic is needed on both server and client, extract a pure shared helper into `packages/shared` rather than duplicating reducer logic.

#### Frontend state ownership

- Keep three explicit state layers:
  - editor document state in TipTap or ProseMirror
  - backend-thread projection state derived from snapshots plus domain events
  - ephemeral UI state such as active sidebar thread, hover state, open panels, and unsent drafts
- Do not create a separate canonical `CommentThread` store in the frontend if the backend thread already exists. The frontend may keep lightweight view indexes, but backend thread state remains authoritative.
- Centralize WebSocket request and push handling so React components do not parse envelopes or own replay logic.
- Treat replay and duplicate events as normal conditions that the frontend reducer must tolerate.

#### Editor and interaction architecture

- Use React with Vite and TypeScript for the app shell.
- Use TipTap with custom ProseMirror extensions for hidden anchors, highlight rendering, and selection-to-thread commands.
- Use TanStack Router for a small route model and TanStack Query for non-streaming bootstrap reads where useful.
- Use Zustand only for ephemeral UI concerns, not for canonical thread transcripts.
- Encapsulate editor commands close to the extension layer, including: create comment thread from selection, insert anchor pair for thread id, focus thread, scroll to anchor, serialize document, parse document, and validate anchors.

#### Runtime and failure handling

- Build one typed WebSocket client that owns connection state, request correlation, reconnect backoff, and replay coordination.
- On reconnect, resume open comment threads with sequence-aware replay rather than assuming the local sidebar is current.
- Keep transport states explicit but calm in the UI: connecting, connected, reconnecting, replaying, degraded, and disconnected.
- Design all comment-thread flows so partial streaming output remains visible if a run is interrupted or fails.
- Prevent direct editing that would orphan only one side of an anchor pair; either reject, repair, or intentionally remove the full comment span.

#### Suggested module layout and phases

- Suggested module layout:
  - `apps/web/src/app/AppShell.tsx`
  - `apps/web/src/app/router.tsx`
  - `apps/web/src/features/document/components/EditorSurface.tsx`
  - `apps/web/src/features/document/editor/anchorExtension.ts`
  - `apps/web/src/features/document/editor/commentHighlightExtension.ts`
  - `apps/web/src/features/document/editor/commentCommands.ts`
  - `apps/web/src/features/comments/components/CommentSidebar.tsx`
  - `apps/web/src/features/comments/components/CommentThreadPanel.tsx`
  - `apps/web/src/features/comments/state/threadProjector.ts`
  - `apps/web/src/features/comments/state/commentUiStore.ts`
  - `apps/web/src/features/providers/components/AuthStatus.tsx`
  - `apps/web/src/lib/ws/client.ts`
- Suggested phases:
  - Phase 1: scaffold `apps/web`, app shell, routing, design tokens, and typed transport client
  - Phase 2: implement Markdown parse or serialize pipeline and hidden anchor editor behavior
  - Phase 3: implement create-comment flow where every new comment creates a backend thread and anchors the selected text with that `threadId`
  - Phase 4: implement sidebar replies, streaming output, reconnect, replay, and thread focus or scroll interactions
  - Phase 5: harden copy or paste, anchor repair, long-document performance, and component plus integration tests

### UI

#### Layout and navigation

- The main layout should feel closer to a focused writing tool than a raw chat console.
- Use three primary regions on desktop:
  - a left sidebar for document navigation and file context
  - a central editor surface for writing and reading
  - a right sidebar for comment threads and replies
- On smaller screens, collapse sidebars into drawers instead of building a separate mobile product structure.

#### Editor presentation

- The editor should render normal prose without exposing anchor syntax.
- Commented spans should use subtle highlight states for idle, hover, selected, and resolved conditions.
- Creating a comment should feel immediate: select text, click comment, thread appears in the sidebar, and the anchored span becomes visibly associated with that thread.
- Clicking highlighted text should focus the corresponding backend thread in the sidebar. Clicking a thread in the sidebar should scroll and focus the anchored text in the document.

#### Comment sidebar

- Each sidebar item should represent a backend thread, not a local-only comment object.
- A thread panel should show:
  - author and timestamp
  - anchored text preview
  - ordered messages and replies
  - streaming assistant output when active
  - resolve or reopen affordances when supported by the backend model
- AI-authored replies should be visually distinct but restrained.

#### Interaction style

- Keep the interface minimal, quiet, and readable. It should not feel like a terminal transcript pasted into a browser.
- Favor stable panels, strong typography, and restrained color over noisy chrome.
- Surface failures and reconnects clearly, but do not let transport status dominate the editor.
- Design for long documents and many comments without making the sidebar or editor feel crowded.

#### Future-facing UI boundaries

- Leave room for future capabilities such as rewrite suggestions, tool output, approvals, or artifact previews, but keep them behind capability flags and isolated panels.
- Do not overload the initial document view with too many secondary controls.
- Preserve a single mental model: comments are anchored document discussions, and each discussion is a backend thread.

## Risks

- If the frontend keeps a separate canonical comment model in parallel with backend threads, the app will drift into duplicate state and difficult recovery bugs.
- If thread ids are not embedded cleanly in document anchors, document-to-thread lookup will become fragile and expensive to maintain.
- If the backend does not expose document-comment metadata on thread summaries, the sidebar will need wasteful extra reads or brittle local caches.
- If anchor protection logic is weak, normal editing can silently corrupt comment structure.
- If streaming updates rerender too much of the editor or sidebar, the app will feel sluggish on long documents or long AI replies.

## Validation

- Unit tests should cover anchor parsing, serialization, anchor-pair validation, selection-to-thread command logic, replay-safe thread projection, and duplicate event handling.
- Component tests should cover comment creation, highlight selection, sidebar reply flow, interrupted or failed runs, and reconnect banners.
- Integration tests should cover document bootstrap, comment-thread creation, reply streaming, reconnect with replay, and thread-to-anchor focus behavior.
- End-to-end tests should cover selecting text, creating a comment, verifying that a backend thread is created, replying inside that thread, refreshing mid-stream, reconnecting, and recovering without duplicate replies or broken anchors.
- Performance checks should verify that long documents, large comment lists, and streaming replies do not degrade typing, scrolling, or selection responsiveness.
- Required repo validation commands for implementation work remain `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.

## Completion Criteria

- `apps/web` exists with a maintainable structure for the editor, comments, transport, and provider auth concerns.
- The editor persists hidden anchors in Markdown while keeping them invisible and protected in the UI.
- Every newly created comment produces a backend thread, and every reply to that comment is sent through that same backend thread.
- The sidebar renders backend thread state, including streaming replies and recovery states, rather than a separate frontend-only comment model.
- Reconnect and replay behavior is explicit, predictable, and free from visible duplication or corrupted anchor state.
- Any shared projection logic is extracted cleanly into `packages/shared` or intentionally kept server-owned with a thin frontend adaptation layer.
- All required validation commands pass for the implementation: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
