## Summary

Connect the right chat sidebar to the real Codex-backed backend flow instead of the current demo or desktop-local placeholder path. The sidebar should render from backend-authored bootstrap data and streamed domain events, while the backend contracts should be adjusted to fit the UI Magick actually has: archived vs active chats, live runtime state, auth state, capabilities, and Codex-specific context hooks that are still expressed through provider-neutral contracts.

## Motivation

Magick already has most of the backend pieces needed for real Codex chat:

- `apps/server` owns provider auth, Codex HTTP transport, thread orchestration, persistence, replay, and WebSocket delivery
- `apps/web` already has a usable right sidebar and thread rendering flow
- `apps/desktop` can expose runtime configuration to the renderer

The problem is that the current sidebar is not connected to that backend. It still renders from `workspaceClient`, which in practice comes from demo data or the desktop-local `LocalWorkspaceService`. That local service stores fake thread state and emits fake AI replies, so the frontend is shaped like a real chat UI but behaves like a mock.

There is also a contract mismatch between the current sidebar model and the backend model:

- the sidebar expects chats to be `open` or `resolved`
- the backend thread model currently tracks `idle`, `running`, `interrupted`, and `failed`

If we wire the frontend directly to the current backend shape without resolving that mismatch, the sidebar will stay awkward and fragile. The Codex integration should be updated to match the frontend’s actual needs before the UI is fully linked.

## Scope

This plan covers:

- `apps/web` chat and sidebar data flow changes needed to consume real backend bootstrap and stream data
- `packages/contracts` updates required to better fit the current sidebar UX
- `apps/server` transport and orchestration changes needed to expose sidebar-friendly thread state, auth state, and Codex capabilities
- desktop/runtime plumbing needed to point the renderer at the real backend transport

This plan does not include:

- replacing the local file tree with a real filesystem-backed tree
- real file open/save integration in the editor
- a workspace-directory picker flow
- broad refactors of the document workspace outside the seams needed for chat context

## Proposed Changes

### Make the sidebar backend-authored

- Replace the current thread methods and thread subscription path inside `workspaceClient` with a dedicated chat transport client built around `@magick/contracts/ws`.
- Update `AppShell` so sidebar bootstrap no longer comes from `workspaceClient.getWorkspaceBootstrap().threads`.
- Introduce a real chat bootstrap sequence that uses backend commands such as:
  - `app.bootstrap`
  - `thread.list`
  - `thread.open`
  - `thread.create`
  - `thread.sendMessage`
  - `thread.stopTurn`
  - `thread.retryTurn`
  - provider auth commands already exposed by the server
- Consume `orchestration.domainEvent` push messages as the source of truth for thread updates instead of local reducer events produced by the demo client.

### Split archive state from runtime state

- Update the shared backend chat contracts so a thread can express both:
  - resolution state for the sidebar ledger, such as `open | resolved`
  - runtime state for active turns, such as `idle | running | interrupted | failed`
- Keep these as separate concepts throughout the backend and frontend rather than overloading one status field.
- Update thread summaries and thread view models so the sidebar can correctly show:
  - archived vs active chats
  - running state while a turn is streaming
  - interrupted and failed state without implying the thread is archived

### Add backend archive or resolve support

- Extend the backend command and event model to support resolving and reopening chats, because the current sidebar already has that behavior and the backend currently does not.
- Persist archive or resolve state in the backend source of truth rather than keeping it as a renderer-only affordance.
- Update thread repository snapshots and summaries so list queries can filter cleanly between open and resolved threads.

### Improve bootstrap for frontend use

- Expand `app.bootstrap` so the frontend receives the data it actually needs in one place:
  - thread summaries
  - active thread if requested
  - provider auth state for Codex
  - provider capabilities
  - transport or replay state if appropriate for the initial load
- Stop returning `capabilities: null` when the backend can already determine them from the provider adapter.
- Make bootstrap sufficient for the sidebar to render a stable first frame without immediately issuing a chain of follow-up reads.

### Push auth state changes to the frontend

- Add a server push path for provider auth lifecycle changes so the renderer does not need to poll or infer state after login starts.
- Cover at least these transitions:
  - login started
  - login completed
  - login cancelled
  - token refresh failed or auth expired
  - logout completed
- Replace the placeholder auth UI with a real backend-driven auth state surface that is visible in or near the sidebar.

### Expose sidebar-friendly thread metadata

- Extend thread summaries to include the fields the sidebar will naturally want without reconstructing them client-side from incomplete data, such as:
  - latest activity timestamp
  - a last-message snippet or equivalent preview text
  - provider key
  - resolution state
  - runtime state
  - optionally whether the thread is currently blocked on auth or unavailable provider state
- Keep the contract provider-neutral even though Codex is the first implementation.

### Keep Codex-specific power behind provider-neutral seams

- Preserve the provider-agnostic orchestration core, but add UI-relevant Codex affordances through capabilities or explicit optional fields instead of leaking Codex payloads into the frontend.
- If the frontend needs file-aware context for Codex later, add explicit context inputs to thread creation or send-message commands rather than letting the UI improvise its own prompt shaping.
- Revisit `supportsToolCalls` and other capabilities so the backend only advertises what the frontend can actually observe or control.

### Renderer and desktop integration seam

- Expose the backend connection information to the renderer through desktop preload or environment configuration.
- In desktop mode, start or configure the backend runtime before the renderer chat client connects.
- In web development mode, continue supporting an explicit external backend URL.
- Keep chat transport separate from local file transport even if both are composed in `AppShell`.

### Suggested module work

- `packages/contracts/src/chat.ts`
  - split resolution state from runtime state
  - add archive or resolve commands and events
  - extend summary and thread view data for sidebar needs
- `packages/contracts/src/ws.ts`
  - enrich bootstrap responses and add any needed auth push envelope types
- `apps/server/src/transport/wsServer.ts`
  - return real capabilities and auth state
  - support new resolve or reopen commands
  - publish auth changes if added as pushes
- `apps/server/src/application/threadOrchestrator.ts`
  - persist and expose archive or resolve state
- `apps/server/src/persistence/threadRepository.ts`
  - persist thread resolution and richer summary metadata
- `apps/web/src/app/AppShell.tsx`
  - replace workspace-client thread bootstrap with real chat bootstrap
- `apps/web/src/features/comments/` or a renamed chat feature area
  - add a WebSocket-backed client and reducer path for real backend state

## Risks

- Splitting resolution state from runtime state will touch contracts, snapshots, reducers, and sidebar rendering at the same time.
- If the bootstrap contract grows without discipline, it can become an inconsistent grab bag rather than a stable frontend boundary.
- Auth push events can create duplicate or out-of-order UI transitions if they are not defined clearly relative to request responses.
- Preserving provider-neutral contracts while adding sidebar-friendly Codex behavior requires discipline; it is easy to accidentally leak Codex-specific assumptions into base models.

## Validation

- Unit tests should cover contract reducers, new archive or resolve event handling, auth state transitions, and thread-summary projection.
- Server tests should cover bootstrap responses, auth command flow, auth push flow if added, archive or resolve commands, and thread list filtering by resolution state.
- Frontend tests should cover sidebar rendering for:
  - open vs resolved threads
  - running vs idle threads
  - auth-required states
  - streamed message updates
- Playwright checks should verify both extracted DOM or text state and targeted screenshots for:
  - initial sidebar bootstrap
  - auth status presentation
  - opening a thread
  - sending a message and observing streaming output
  - resolving and reopening a thread
- Required implementation validation commands remain `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.

## Completion Criteria

- The right sidebar no longer depends on demo-thread data or desktop-local fake replies.
- The renderer receives thread data, auth state, and capabilities from the real backend transport.
- The backend exposes both resolution state and runtime state in a way that fits the sidebar UX cleanly.
- Resolving and reopening chats works through persisted backend state rather than local UI-only state.
- Codex auth state is visible and updates predictably in the frontend.
- Streaming Codex replies appear in the sidebar through the real orchestration and push path.
