## Summary

Build the frontend for Magick's initial central chat experience around a server-authored event stream, with a UI that remains simple for users while staying resilient to reconnects, streaming updates, and future provider growth.

## Motivation

The frontend will be where users spend nearly all of their time, but it should not become the place where authoritative chat logic lives. If the UI grows around transport payloads, provider-specific assumptions, or scattered local state, even small backend changes will force expensive frontend rewrites. We should instead build the web app as a thin but robust projection layer over typed domain events, so future providers and future chat features can be added without destabilizing the core experience.

## Scope

This plan covers `apps/web` responsibilities needed for the initial chat experience, including bootstrap, routing, thread selection, transcript rendering, composer behavior, streaming updates, reconnect UX, and client-side state boundaries.

## Proposed Changes

### Architecture goals

- The frontend should render from server-authored domain events and read models rather than directly from provider payloads or ad hoc client-managed transcript state.
- The UI should feel fast and calm under long streams, reconnects, and failures, without hiding important state transitions from the user.
- Client state should be narrowly scoped: local UI concerns stay local, while thread history, turn progression, and session recovery remain server-authored.
- Provider differences should be surfaced through capabilities and thread/session metadata, not through provider-specific branching throughout components.

### App structure

- `apps/web` should use React with Vite for the app shell, TanStack Router for route structure, and TanStack Query for bootstrap and non-streaming server data.
- Zustand should be used only for ephemeral UI state such as selected thread id, composer draft, scroll-follow mode, panel visibility, optimistic input disablement, and connection banners.
- A dedicated client-side event reducer or projector should turn sequenced domain events into a renderable thread view model.
- Shared event and command schemas should come from `packages/contracts`, while any projector or utility logic shared with the server should come from explicit subpaths in `packages/shared`.

### Route and layout model

- The initial route structure should be intentionally small: an app shell, a thread list sidebar, and a main chat route keyed by thread id.
- The app shell should bootstrap connection state, account or provider metadata needed for the current workspace, and the initial thread list.
- Selecting a thread should hydrate from a server-provided snapshot or replay result rather than reconstructing state from client cache alone.
- The layout should support desktop-first usage but remain functional on smaller screens by collapsing the sidebar into a temporary surface rather than introducing a separate mobile architecture.

### Client data ownership

- TanStack Query should own bootstrap requests, thread list fetches, settings or provider metadata fetches, and any non-streaming read endpoints.
- The WebSocket event pipeline should own active transcript updates, in-flight turn state, reconnect catch-up, and live thread summary updates.
- Zustand should not hold canonical transcript arrays. It should only hold transient UI state that can be safely lost and recomputed.
- Components should render from a thread view model derived by a pure reducer so replay, testing, and future feature growth remain manageable.

### Thread view model

- The frontend should maintain a normalized view model per open thread containing ordered transcript items, active turn metadata, latest sequence number, error or interruption state, provider/session status, and unread markers where relevant.
- Transcript items should be typed by UI intent rather than provider origin, such as user message, assistant message, system status item, interruption notice, or recoverable error item.
- Streaming assistant output should update a stable in-progress transcript item rather than constantly inserting new list items.
- The reducer should tolerate replayed and duplicated events so reconnect logic does not cause visible duplication.

### WebSocket client flow

- The client should open one persistent WebSocket connection per browser tab and use typed request and push envelopes from `packages/contracts`.
- On initial connect, the app should bootstrap the thread list and active thread state using explicit command responses rather than implicit local assumptions.
- On reconnect, the client should report the last acknowledged sequence for the active thread so the server can replay missing events before live updates resume.
- The WebSocket layer should expose explicit connection states such as connecting, connected, reconnecting, replaying, degraded, and disconnected so the UI can reflect them clearly.
- The event client should batch or schedule reducer updates when streaming volume is high so the browser render loop stays responsive.

### Transcript rendering

- The transcript should render a simple ordered list with stable keys derived from domain ids rather than array indexes or transport event ordering alone.
- Assistant streaming should appear in place with incremental text updates, and partial output should remain visible if the turn fails or is interrupted.
- The UI should clearly distinguish between message content and system/runtime status updates without overwhelming the user with low-level provider noise.
- Large transcripts should be designed with virtualization readiness in mind even if full virtualization is deferred initially.

### Composer and turn controls

- The composer should support draft editing, send, disabled or busy states, and interrupt for the currently active turn.
- Draft text should remain stable across transient reconnects and thread switches when practical, but draft persistence should stay secondary to transcript correctness.
- Send behavior should be conservative: once a turn is active, the default state should block another send until the current turn completes or is interrupted.
- Retry should be modeled as a clear user action on a failed or interrupted turn rather than an implicit client-side resend.

### Initial UX states

- The first pass should explicitly design empty, loading, reconnecting, replaying, interrupted, failed, and disconnected states instead of treating them as edge cases.
- Reconnect or replay banners should be visible but unobtrusive, and they should not destroy the current transcript while recovery is in progress.
- Auto-scroll should follow new output only while the user is at or near the bottom. Manual upward scroll should suspend follow mode until the user returns to the latest content.
- The thread list should reflect basic thread metadata such as title, provider, last activity, and whether a thread is currently running.

### Provider-aware but provider-neutral UI

- The UI should not assume Codex-specific runtime affordances as universal. Provider differences should be communicated through capabilities exposed by the backend.
- Capability-gated controls such as interrupt, resume, or future attachments should render only when the current provider session supports them.
- Provider-specific advanced surfaces should be deferred until there is a proven cross-provider pattern or a deliberately isolated provider-specific panel.

### Suggested module layout

- `apps/web/src/app/AppShell.tsx`
- `apps/web/src/features/chat/routes.tsx`
- `apps/web/src/features/chat/state/chatUiStore.ts`
- `apps/web/src/features/chat/state/threadEventReducer.ts`
- `apps/web/src/features/chat/components/ThreadList.tsx`
- `apps/web/src/features/chat/components/Transcript.tsx`
- `apps/web/src/features/chat/components/Composer.tsx`
- `apps/web/src/features/chat/components/ConnectionBanner.tsx`
- `apps/web/src/features/chat/hooks/useChatSocket.ts`
- `apps/web/src/features/chat/hooks/useThreadViewModel.ts`

## Risks

- If transcript state is split across WebSocket handlers, Zustand stores, query caches, and component-local arrays, the UI will become difficult to reason about and replay bugs will multiply.
- Rendering each streaming delta as a separate expensive state update can make the app feel slow even if backend throughput is good.
- Reconnect and replay states may become confusing if the UI hides too much detail or, conversely, exposes transport noise that ordinary users do not understand.
- Overfitting the UI to Codex-specific capabilities would undermine future provider support even if the backend remains abstract.
- Aggressive optimistic UI behavior could conflict with the server-authored event model and create temporary states that are hard to reconcile after reconnect.

## Validation

- Unit tests should cover the thread event reducer, transcript item mapping, capability-gated UI branching, scroll-follow behavior, and connection state mapping.
- Component tests should cover transcript streaming updates, failure states, interruption states, and reconnect banners without relying on real provider runtimes.
- Integration tests should cover the WebSocket client flow, including initial bootstrap, replay after reconnect, and duplicate event tolerance.
- End-to-end tests should cover thread creation, sending a message, observing streaming output, interrupting a turn, refreshing mid-stream, reconnecting, and resuming without transcript loss.
- Performance checks should verify that long streaming responses do not degrade typing responsiveness, scroll behavior, or general render smoothness.
- Required project validation commands should pass before implementation is considered complete: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.

## Completion Criteria

- The web app renders the central chat flow from backend-authored domain state rather than raw provider events or scattered local transcript state.
- The UI supports the initial chat workflow: thread list, thread open or create, transcript rendering, composer send, assistant streaming, interrupt, retry, and resume-aware recovery states.
- Reconnect and replay are visible, predictable, and do not cause transcript duplication or loss of already persisted output.
- Provider differences are handled through capability-driven UI behavior rather than hardcoded Codex assumptions across components.
- The frontend state model is cleanly separated between ephemeral UI state and authoritative chat projection state.
- All required validation commands from `AGENTS.md` pass: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
