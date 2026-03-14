## Summary

Build the server-side foundation for Magick's central chat flow as a provider-agnostic orchestration system, with Codex as the first provider adapter but not the defining architecture.

## Motivation

The backend will determine whether Magick stays reliable as the product expands. If the first implementation bakes Codex-specific assumptions into transport, persistence, or domain contracts, future support for alternative providers will require a rewrite of the chat core. We should instead establish a clean orchestration layer that can support both stateful providers with native server-side resume and stateless providers where Magick reconstructs context from persisted events.

## Scope

This plan covers `apps/server`, `packages/contracts`, and `packages/shared` responsibilities needed for the backend half of the initial chat system, including transport, orchestration, persistence, provider integration boundaries, replay, and recovery.

## Proposed Changes

### Architecture goals

- The backend should be organized around one provider-agnostic chat orchestration core that accepts typed commands, persists domain events, manages provider sessions, and publishes sequenced updates to clients.
- The server should treat provider runtimes as interchangeable adapters behind stable interfaces. Codex should be the first implementation, not the implicit contract.
- Server-owned persistence should be the source of truth for chat history, session recovery metadata, and replay state.
- The backend should explicitly support two provider classes: stateful providers with native resume semantics and stateless providers where Magick rebuilds the turn context from stored thread history.

### Package boundaries

- `apps/server` should own transport, application services, provider runtime coordination, SQLite access, and projections used for bootstrap and replay.
- `packages/contracts` should define schema-first command payloads, domain events, WebSocket envelopes, provider capability models, and persistence payload types. It should remain schema-only.
- `packages/shared` should hold runtime-safe helpers shared by server and web, such as ids, timestamps, retry utilities, domain projector helpers, and generic error formatting.

### Server layers

- `transport`: WebSocket connection lifecycle, command routing, request validation, replay handshake, connection health, and push fanout.
- `application`: command handlers, thread orchestration, turn lifecycle policy, session recovery, and provider capability branching.
- `providers`: provider registry plus concrete adapters such as Codex, each isolated behind a common runtime interface.
- `persistence`: SQLite repositories, event store, snapshot store, transaction helpers, and migration management.
- `projections`: pure reducers and read-model builders for thread state, thread list summaries, and provider/session status.
- `observability`: structured logging, metrics hooks, correlation ids, and operational diagnostics.

### Provider abstraction model

- Introduce a `ProviderRegistry` that resolves provider implementations from a stable `providerKey`.
- Introduce a `ProviderAdapter` interface responsible for session creation, session resume, capability reporting, and provider-specific error normalization.
- Introduce a `ProviderSessionHandle` runtime interface responsible for starting turns, interrupting turns, disposing resources, and exposing normalized provider event streams.
- Introduce a `ProviderCapabilities` model that advertises whether a provider supports native resume, interrupt, attachments, approvals, tool calls, and multi-turn server-side sessions.
- Introduce a `ResumeStrategy` branch in orchestration so the server can either resume an existing provider-side thread/session or rebuild the request context from Magick's persisted event history when native resume is unavailable.

### Command and event model

- The initial command surface should include `app.bootstrap`, `thread.list`, `thread.open`, `thread.create`, `thread.sendMessage`, `thread.stopTurn`, `thread.retryTurn`, and `thread.resume`.
- The backend should normalize all runtime activity into provider-neutral domain events such as `thread.created`, `message.user.created`, `turn.started`, `turn.delta`, `turn.completed`, `turn.interrupted`, `turn.failed`, `provider.session.started`, `provider.session.disconnected`, and `provider.session.recovered`.
- Provider adapters may emit lower-level normalized provider events internally, but the persisted source of truth should be Magick domain events rather than raw provider payloads.
- Each domain event should include at minimum an event id, thread id, provider session id, sequence number, occurred-at timestamp, event type, and typed payload.
- Event sequence numbers should be monotonic per thread so replay, deduplication, and client catch-up remain deterministic.

### Persistence model

- SQLite should be the only persistent store in the first buildout and should be owned entirely by `apps/server`.
- Chat history should be recorded in an append-only `thread_events` table that can fully reconstruct a thread after process restart, browser refresh, or reconnect.
- The server should maintain lightweight read-model tables or snapshot tables for fast thread list loading and thread bootstrap without sacrificing replay correctness.
- The minimum initial persisted entities should be `workspaces`, `provider_sessions`, `threads`, `thread_events`, `thread_snapshots`, and optionally `connection_checkpoints` if replay acknowledgements need durable storage.
- `provider_sessions` should store provider identity, workspace binding, status, native provider references when available, and capability metadata known at session creation time.
- If raw provider payloads are useful for diagnostics, they should be stored separately as debug artifacts and never treated as the primary UI or replay contract.

### Thread and turn orchestration

- A `ThreadOrchestrator` application service should own the end-to-end command flow for each thread.
- For `thread.sendMessage`, the orchestrator should persist the user message event first, select the active provider session, choose the correct resume strategy, start the provider turn, and persist each resulting domain event before fanout.
- The orchestrator should enforce one active turn per thread for the initial build. Queueing and parallel turns should remain future work.
- Interrupts should produce an explicit terminal event path rather than relying on transport-side cancellation semantics.
- Retries should be modeled as new turns referencing prior failed or interrupted turns rather than mutating existing event history.
- Resume behavior should be deterministic: stateful providers resume via provider-native ids, while stateless providers reconstruct the prompt/context window from persisted thread history and provider settings.

### Replay and recovery

- The WebSocket protocol should support reconnect with the client's last acknowledged thread sequence so the server can replay missing events before resuming live updates.
- Replayed events and live events should use the same envelope and ordering guarantees so the client does not need divergent code paths for recovery.
- If the provider process exits unexpectedly, the server should mark the session disconnected, persist the failure state, and expose a recoverable session path instead of silently dropping the turn.
- The backend should deduplicate repeated provider or transport events using event ids, sequence guards, or provider-native correlation ids where available.
- Recovery should prioritize correctness over eagerness; the server should avoid resuming live streaming until it has confirmed replay boundaries.

### Codex adapter strategy

- Codex integration should live entirely under a dedicated provider module, with no Codex JSON-RPC types leaking into generic contracts.
- The Codex adapter should translate app-server lifecycle concepts, turn streaming callbacks, interrupts, and resume metadata into Magick's provider-neutral runtime interfaces.
- Any Codex-specific event richness that does not fit the initial cross-provider contract should be preserved behind optional capability-gated extensions rather than promoted into the base model prematurely.
- The backend should include a fake provider adapter for testing orchestration, replay, and failure handling without depending on Codex runtime behavior.

### Suggested module layout

- `apps/server/src/transport/wsServer.ts`
- `apps/server/src/transport/connectionRegistry.ts`
- `apps/server/src/application/commandBus.ts`
- `apps/server/src/application/threadOrchestrator.ts`
- `apps/server/src/application/providerRegistry.ts`
- `apps/server/src/application/replayService.ts`
- `apps/server/src/providers/providerTypes.ts`
- `apps/server/src/providers/codex/codexProviderAdapter.ts`
- `apps/server/src/providers/fake/fakeProviderAdapter.ts`
- `apps/server/src/persistence/eventStore.ts`
- `apps/server/src/persistence/threadRepository.ts`
- `apps/server/src/persistence/providerSessionRepository.ts`
- `apps/server/src/projections/threadProjector.ts`
- `apps/server/src/projections/threadListProjector.ts`

## Risks

- Codex-specific assumptions could leak into shared contracts, making later provider additions expensive even if adapter boundaries exist on paper.
- Supporting both native-resume and stateless providers increases orchestration complexity early, especially around session recovery, context rebuilding, and capability branching.
- Replay bugs will be costly. If event ordering, idempotency, or checkpoint handling are underspecified, reconnect behavior can corrupt user-visible transcript state.
- SQLite schema choices may become difficult to evolve if optimized for the first UI rather than long-term replay and provider flexibility.
- Provider capability divergence may tempt one-off conditional logic in command handlers, which would erode the abstraction boundary over time.
- Process lifecycle management for long-running provider sessions can become a stability risk under crashes, disconnects, and concurrent reconnects unless session ownership is explicit.

## Validation

- Unit tests should cover command validation, provider capability branching, resume strategy selection, thread projector logic, event serialization, and error normalization.
- Integration tests should cover command-to-event orchestration, SQLite persistence, event replay, deduplication, and session recovery using both a fake stateful provider and a fake stateless provider.
- Codex adapter tests should verify translation of app-server events into provider-neutral runtime events, interrupt behavior, and native resume handling.
- Transport tests should verify reconnect handshake behavior, replay-before-live semantics, and connection state notifications.
- Logging should be structured and correlated by request id, thread id, provider session id, turn id, and connection id so recovery failures can be traced across layers.
- Required project validation commands should pass before implementation is considered complete: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.

## Completion Criteria

- The server exposes a provider-agnostic orchestration flow for the initial chat commands without leaking Codex-specific types into shared contracts.
- The backend supports both providers with native server-side resume and stateless providers that reconstruct context from persisted thread history.
- Thread and turn state are persisted through an append-only event model in SQLite, with replay sufficient to rebuild a thread after reconnect or restart.
- WebSocket reconnect and replay behave deterministically and do not require separate client-side recovery contracts.
- Codex works as the first provider adapter, and a fake provider exists for orchestration and recovery testing.
- All required validation commands from `AGENTS.md` pass: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
