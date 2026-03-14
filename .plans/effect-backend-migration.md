## Summary

Migrate the Magick backend from promise-first orchestration to an Effect-based execution model, focusing on typed failures, resource-safe provider session lifecycle management, explicit dependency wiring, and more robust streaming and recovery behavior.

## Motivation

The backend is already doing the kind of work where Effect provides real leverage: long-lived provider sessions, turn streaming, cancellation, replay, error classification, and dependency-heavy orchestration. Promises are workable for the current size of the codebase, but they leave too much behavior implicit. As the backend grows to support more providers and more recovery logic, an Effect-based core will make the system easier to reason about, safer under failure, and more maintainable.

We should migrate now while the backend is still small enough to reshape without a large compatibility burden.

## Scope

This plan covers `apps/server` runtime internals and the runtime-facing parts of `packages/shared` needed to support an Effect-based backend. It does not require converting `packages/contracts` into runtime Effect code, and it does not require converting the frontend.

## Proposed Changes

### Migration goals

- Use Effect as the execution model for backend application services, provider adapters, persistence services, and replay/recovery logic.
- Keep transport edges thin and imperative where appropriate. The WebSocket and eventual HTTP server should translate incoming requests into Effect programs and run them at the boundary.
- Preserve provider-agnostic architecture while making provider session lifecycle and streaming behavior safer and more explicit.
- Keep shared contracts transport-friendly and framework-neutral. Effect should power runtime behavior, not leak unnecessarily into persisted schemas or wire payloads.

### What should change first

- `apps/server/src/application/threadOrchestrator.ts` should be the first major migration target because it coordinates provider calls, persistence, replay, and event publishing.
- `apps/server/src/providers/providerTypes.ts` should move from `Promise` and `AsyncIterable` contracts to Effect/Stream-based contracts.
- Persistence services in `apps/server/src/persistence/` should become Effect services with typed error channels instead of throwing directly.
- Replay and recovery logic in `apps/server/src/application/replayService.ts` should move to Effect so reconnect behavior and checkpoint handling become composable and testable.

### Target architecture

- Introduce Effect services for the major backend capabilities:
  - `ProviderRegistry`
  - `ProviderRuntime`
  - `EventStore`
  - `ThreadRepository`
  - `ProviderSessionRepository`
  - `EventPublisher`
  - `Clock` and `IdGenerator` where deterministic testing is helpful
- Introduce explicit domain error types for orchestration failures, persistence failures, provider failures, and transport-facing command failures.
- Use `Effect.acquireRelease` or scoped resources for provider sessions and any future Codex subprocess lifecycle so cleanup behavior is guaranteed.
- Use `Stream` for provider turn output rather than raw `AsyncIterable`, so interruption, backpressure-aware composition, and transformation are easier to manage.

### Interface migration

- `ProviderAdapter` should expose Effect-returning methods such as `createSession`, `resumeSession`, and error normalization through typed domain errors rather than unchecked exceptions.
- `ProviderSessionHandle` should expose `startTurn` and `interruptTurn` as Effects, and turn output should be represented as `Stream<ProviderEvent, ProviderError>` or a similarly typed stream abstraction.
- The orchestrator should stop catching generic `unknown` errors in large imperative blocks and instead compose smaller typed programs for thread creation, message send, interrupt, retry, and replay.
- Repository methods should return Effects and typed failures rather than returning nullable data where absence is actually an error case.

### Dependency model

- Replace constructor-heavy manual dependency plumbing in the application layer with Effect `Layer`s or equivalent service composition.
- Keep a single backend composition root where concrete SQLite repositories, provider adapters, and publishers are wired together.
- Continue allowing fake providers for tests, but register them as alternate layers rather than manually swapping classes in individual tests.

### Error model

- Define a small set of backend error categories that can be safely mapped to transport responses:
  - not found
  - invalid command/state transition
  - provider unavailable
  - provider turn failed
  - persistence failure
  - replay/recovery failure
- Preserve provider-specific details for logs, but expose stable app-level error shapes to transport and frontend layers.
- Remove as many ad hoc `throw new MagickError(...)` cases as possible in favor of typed failures propagated through Effect.

### Streaming and cancellation

- Replace imperative `for await` turn loops with `Stream`-based pipelines that transform provider output into domain events.
- Encode user interrupt as structured cancellation or interruption rather than a side path outside the turn execution model.
- Make it explicit whether event publication is part of the same execution pipeline as persistence or a separate best-effort branch.
- Design the stream pipeline so batching or coalescing token deltas later does not require transport-specific hacks.

### Transport boundary strategy

- Keep `apps/server/src/transport/wsServer.ts` imperative at the outer edge for now.
- Parse incoming commands, call a single Effect entrypoint per request, and convert typed failures into transport responses.
- Avoid pushing Effect-specific concepts into WebSocket payloads or frontend contracts.
- Reserve a future migration of the transport layer itself unless it becomes complex enough to justify deeper adoption.

### Migration phases

1. Foundation
   - add Effect dependencies
   - define backend error types
   - add basic service interfaces and composition root
2. Persistence migration
   - convert repositories and event store to Effect services
   - introduce typed persistence errors
3. Provider runtime migration
   - convert provider interfaces to Effect and Stream
   - migrate fake provider first
   - then migrate Codex adapter shell
4. Application migration
   - convert thread orchestrator and replay service to Effect programs
   - replace ad hoc runtime caching and failure handling with explicit service logic
5. Transport integration
   - run Effect programs from WebSocket handlers
   - map typed failures to command responses
6. Hardening
   - add scoped resource cleanup
   - add interruption tests, replay tests, and provider crash recovery tests

### Non-goals

- Do not rewrite `packages/contracts` into Effect runtime modules.
- Do not block frontend progress on frontend-wide Effect adoption.
- Do not chase perfect functional purity at the expense of clear system boundaries.

## Risks

- A broad rewrite could destabilize a backend that is still evolving if the migration is attempted all at once instead of by layer.
- Introducing Effect without disciplined error and service boundaries could add complexity without delivering the intended reliability gains.
- Mixing promise-based and Effect-based flows for too long could create awkward interop code and duplicate abstractions.
- If the Codex adapter is migrated before the generic provider interfaces are settled, provider-agnostic design could regress.
- Team familiarity is a real risk. If the code becomes more abstract before conventions are established, maintainability could get worse rather than better.

## Validation

- Unit tests should be added or updated for each migrated service, especially around typed failures, replay semantics, interruption, and provider stream handling.
- Integration tests should verify that stateful and stateless fake providers still work correctly through the migrated orchestrator.
- Transport tests should verify that Effect failures are mapped into stable command response shapes without leaking internal implementation details.
- Resource lifecycle tests should verify that provider sessions are cleaned up correctly on interruption, failure, and disconnect.
- Logging should remain structured and should include enough identifiers to trace failures across Effect service boundaries.
- Required project validation commands should pass before the migration is considered complete: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.

## Completion Criteria

- Backend application services, provider interfaces, and persistence services run on Effect rather than plain Promises.
- Provider turn streaming and interruption are represented through a typed streaming model rather than ad hoc async iteration.
- The server composition root wires concrete implementations through Effect services or layers instead of constructor-only manual plumbing.
- Transport boundaries successfully execute backend Effect programs and map typed failures into stable command responses.
- Both stateful-resume and stateless-rebuild provider flows still work after migration.
- All required validation commands from `AGENTS.md` pass: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
