## Summary

This is an initial buildout for Magick, which will be a bare-bones chat interface with Codex app-server integration. No fancy features.

## Motivation

We want to start with the core experience of Magick. Users would spend the vast majority of their time in the chat, so starting with this part also makes the most sense. The idea is to build out this basic functionality in such a way that all future add-on feaatures can be incorporated into this expeerience with minimal refactoring of the codebase. i.e. the code should keepe extensibility and long-term maintainability as a core principle.

## Scope

The whole project

## Proposed Changes

### Principles

1. Performance is mandatory—We should be doing everything in our power to make sure funcitonality remains the same in high-throughput situations.
2. Not minimalism, but balance—We're not aiming to be as barebones as physically possible, but we are looking to make the UI/UX simple and effortless. Everthing has to feel snappy. Navigating through menus should feel effortless. Users shouldn't be stuck finding small buttons or waiting for long animations. Prefer to use less embellishments than more, we can always add more later.
3. Clear hierachy—All important information to the average user should be easily accessible, with more important information being more accessible or more visible than less important information. Keep in mind we're NOT designing for highly technical users, but rather everyday users who are a bit tech savvy (someone your mom would think is techy, but a software engineer wouldn't).

### Tech stack

- Bun workspaces and Turbo for the monorepo so web, server, contracts, and shared runtime code can evolve independently without sacrificing fast local iteration.
- React in `apps/web` with Vite, TanStack Router, and TanStack Query. We should avoid Next.js here because the core product is an always-on client chat surface, and SSR-specific framework complexity does not materially help the first buildout.
- Zustand for ephemeral client UI state only, such as selected thread, composer draft, panel state, and scroll intent. Authoritative transcript state should come from the server event stream rather than ad hoc client stores.
- SQLite owned by `apps/server` for persistence. The server should be the only layer writing chat history, provider session state, and replay checkpoints.
- Tailwind with a lightweight token layer built on CSS variables so the first pass stays fast to build without drifting into inconsistent styling.
- Vitest for unit and integration tests, and Playwright for end-to-end flow coverage.

### Application architecture

- The central chat flow should be built around one event pipeline: the client sends a typed command, the server validates it and persists the resulting state transition, Codex app-server produces runtime updates, the server normalizes those updates into domain events, and the client renders only from that domain event stream.
- `apps/server` should own WebSocket transport, Codex app-server lifecycle management, provider/session orchestration, SQLite persistence, and replay after reconnect.
- `apps/web` should own routing, layout, transcript rendering, composer interactions, and reducing pushed domain events into renderable thread state.
- `packages/contracts` should define schema-first command payloads, push-event payloads, thread/session models, and persistence-safe types. This package should remain schema-only.
- `packages/shared` should contain reusable runtime utilities such as ids, timestamps, retry helpers, and projector helpers exposed through explicit subpath exports rather than a barrel.

### Chat flow and data model

- The initial command surface should cover `app.bootstrap`, `thread.list`, `thread.open`, `thread.create`, `thread.sendMessage`, `thread.stopTurn`, `thread.retryTurn`, and `thread.resume`.
- The initial push surface should stay minimal: connection state updates plus one authoritative domain event channel for chat/runtime updates.
- Each persisted event should include at minimum an event id, thread id, provider session id, monotonic sequence number, timestamp, type, and typed payload.
- SQLite should use an append-only event log for chat history, with lightweight snapshot tables only for faster thread list and resume performance.
- The minimum persisted entities should be workspaces, provider sessions, threads, thread events, and thread snapshots.
- Raw Codex protocol events should not be treated as the UI contract. The server should translate them into Magick domain events that stay stable even if provider-specific payloads evolve.
- The web app should project those domain events into a thread view model that contains transcript items, in-flight turn state, failure state, unread status, and summary metadata.
- One active turn per thread should be enforced initially. Queueing or parallel turns can be added later if the event model still holds up.

### Initial UX scope

- The first pass should focus on a thread list, active transcript, composer, send/stop controls, basic thread header metadata, and clear empty/loading/reconnecting/error states.
- Auto-scroll should follow new output by default but immediately yield when the user scrolls upward so long streams do not fight the user.
- The UI should preserve partial assistant output when a turn fails or is interrupted so visible progress never disappears.
- Nonessential secondary surfaces such as advanced settings panels, tool-specific inspectors, and multi-pane workspace workflows should be deferred until the core chat loop is reliable.

## Risks

- If the app renders directly from transport payloads instead of stable domain events, future chat features will require invasive refactors and reconnect behavior will become fragile.
- Replay and recovery add complexity early. If event ordering, deduplication, or checkpointing are underspecified, browser refreshes and transient disconnects will create transcript corruption that is difficult to debug.
- Streaming throughput can overwhelm the UI if token deltas are pushed too frequently or if the transcript reducer performs too much work on every update.
- Codex app-server lifecycle handling is a reliability risk. Unexpected process exits, resume mismatches, or stale sessions can make the chat feel nondeterministic unless the server is the single authority for session state.
- SQLite schema decisions can become constraining if they optimize only for the first UI instead of replay, recovery, and future event types.
- Allowing too much client-owned authoritative state will make it difficult to guarantee correctness under refresh, reconnect, or multi-tab usage.

## Validation

- Unit tests should cover event schemas, the thread projector, persistence mappers, and any logic that translates raw Codex/runtime payloads into Magick domain events.
- Integration tests should cover the server-side command-to-event flow, SQLite persistence, replay on reconnect, and session recovery when Codex app-server disconnects unexpectedly.
- End-to-end tests should cover the core user flows: open or create a thread, send a message, observe streaming output, interrupt a turn, refresh mid-stream, reconnect, and resume without losing persisted content.
- Logging should be structured and scoped by identifiers such as thread id, provider session id, and connection id so failures in transport, persistence, and provider orchestration can be traced without guesswork.
- Logging verbosity should be configurable so local debugging can be detailed while normal development and production usage remain readable.
- Before implementation work is considered validated, `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test` should all pass.

## Completion Criteria

- The chat flow is implemented around one server-authored event pipeline rather than scattered local UI state paths.
- The system supports the core bare-bones chat loop: bootstrap, thread listing, thread creation/opening, message send, assistant streaming, interrupt, retry, and resume.
- Chat history and session state persist through `apps/server` in SQLite, and a browser refresh or reconnect can rebuild the visible transcript from persisted events.
- The web app renders from projected domain state instead of directly from provider transport payloads.
- Failure states for disconnects, interruptions, and provider crashes are visible and recoverable rather than silently dropping the user back to an empty or inconsistent chat state.
- All required validation commands from `AGENTS.md` pass: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
