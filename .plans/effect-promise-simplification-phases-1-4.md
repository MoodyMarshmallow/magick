## Summary

Simplify the backend by removing Effect-TS from the layers where it is mostly adding ceremony, while keeping Effect in the provider streaming and orchestration path where it still provides clear value. This plan covers the first four migration phases: simple services and auth helpers, persistence, runtime/auth state, and the transport/composition root.

## Motivation

The current backend gets real value from Effect in streamed provider execution, cancellation, and multi-step orchestration. It gets much less value from Effect in synchronous SQLite repositories, thin read services, static registry lookup, OAuth helper wrappers, and the WebSocket composition root.

Those simpler modules are now harder to read because they pay repeated costs for `Context.GenericTag`, `Layer`, `ManagedRuntime`, `Ref`, `Effect.gen`, and `Effect.try*` even when the underlying behavior is straightforward. This plan reduces that overhead without removing the parts of Effect that are actually helping reliability.

## Scope

This plan covers these migrations to plain TypeScript classes/functions with direct return values or `Promise`s:

- `apps/server/src/application/replayService.ts`
- `apps/server/src/application/providerRegistry.ts`
- `apps/server/src/application/providerAuthService.ts`
- `apps/server/src/persistence/eventStore.ts`
- `apps/server/src/persistence/threadRepository.ts`
- `apps/server/src/persistence/providerAuthRepository.ts`
- `apps/server/src/persistence/providerSessionRepository.ts`
- `apps/server/src/providers/codex/codexAuthClient.ts`
- `apps/server/src/providers/codex/codexOAuth.ts`
- `apps/server/src/effect/runtime.ts`
- `apps/server/src/transport/wsServer.ts`
- `apps/server/src/index.ts`

This plan explicitly does not remove Effect from the provider streaming boundary:

- `apps/server/src/providers/providerTypes.ts`
- `apps/server/src/providers/codex/codexResponsesClient.ts`
- `apps/server/src/providers/codex/codexProviderAdapter.ts`
- `apps/server/src/providers/fake/fakeProviderAdapter.ts`
- `apps/server/src/application/threadOrchestrator.ts`

## Proposed Changes

### Target architecture after phases 1-4

- Keep `threadOrchestrator` as the main Effect-based application service.
- Keep provider adapters and streamed provider output on `Effect` + `Stream`.
- Replace simple service tags/layers with plain constructor-injected classes or objects.
- Replace repository `Effect.try(...)` wrappers around `better-sqlite3` with synchronous methods that either return values directly or throw typed backend errors.
- Replace `ManagedRuntime` request execution in the WebSocket layer with direct service method calls and `try/catch` error mapping.
- Use normal in-memory state (`Map`) for active logins, session runtimes, and active turns where no cross-runtime concurrency model is needed.

### Error handling strategy

- Keep the existing backend error classes in `apps/server/src/effect/errors.ts` so transport error mapping and tests stay stable.
- In migrated files, throw backend error instances directly instead of returning them through an Effect error channel.
- Limit promise rejection surfaces to genuine async boundaries such as network I/O, OAuth callback waiting, and WebSocket request handling.

### Dependency model after migration

- `index.ts` becomes a normal composition root that constructs repositories, service instances, provider registry, runtime state, and WebSocket server dependencies explicitly.
- `wsServer.ts` receives concrete service objects instead of an Effect `ManagedRuntime`.
- `threadOrchestrator.ts` remains Effect-based for now, but it should receive plain repository/service objects where possible and internally bridge promise/sync calls into Effect only at the points it needs to compose them.

### Phase 1: Low-risk service and auth helper simplification

Files:

- `apps/server/src/application/replayService.ts`
- `apps/server/src/application/providerRegistry.ts`
- `apps/server/src/providers/codex/codexAuthClient.ts`
- `apps/server/src/providers/codex/codexOAuth.ts`

Changes:

- Replace `ReplayService` tag/layer with a plain service class exposing:
  - `getThreadState(threadId): ThreadViewModel`
  - `replayThread(threadId, afterSequence?): readonly DomainEvent[]`
- Replace `ProviderRegistry` layer/tag with a plain registry class or object with a synchronous `get(providerKey)` method that throws `ProviderUnavailableError` when missing.
- Convert `CodexAuthClient` from `Effect.tryPromise(...)` wrappers to `async` methods that return `Promise<CodexAuthTokenSet>` and throw `ProviderFailureError`.
- Convert `CodexOAuthHarness.startLogin()` to return `Promise<CodexOAuthLogin>` instead of an Effect. Keep the browser callback flow, timeout, and cancellation behavior the same.

Justification:

- These files do not benefit much from typed effect composition. They are thin wrappers around repository calls, map lookup, fetch, and Node HTTP callback wiring.
- This phase removes several high-ceremony service tags/layers early with low architectural risk.

Risks:

- `threadOrchestrator` and other Effect-based code will need small interop bridges to call promise-based auth helpers if they still depend on them.
- `codexOAuth.ts` has browser-visible behavior and should keep its current tests plus additional regression tests if timing/cleanup changes.

### Phase 2: Persistence migration to plain repositories

Files:

- `apps/server/src/persistence/eventStore.ts`
- `apps/server/src/persistence/threadRepository.ts`
- `apps/server/src/persistence/providerAuthRepository.ts`
- `apps/server/src/persistence/providerSessionRepository.ts`

Changes:

- Replace `Context.GenericTag` + `Layer.succeed(...)` repository providers with plain repository classes.
- Convert methods from `Effect.Effect<..., PersistenceError>` to direct return values for sync operations:
  - `append(...) => readonly DomainEvent[]`
  - `listThreadEvents(...) => readonly DomainEvent[]`
  - `get(...) => Record | null`
  - `create(...) => void`
  - `saveSnapshot(...) => void`
- Continue throwing `PersistenceError` from repository methods when SQLite or JSON parsing fails.

Justification:

- These repositories are almost entirely synchronous `better-sqlite3` operations already.
- Effect is acting mainly as a checked wrapper around thrown exceptions, but the code becomes much longer and harder to scan.
- Converting persistence first also simplifies downstream services significantly.

Risks:

- `threadOrchestrator` currently expects Effect-returning repositories; this phase requires a careful compatibility bridge or a coordinated orchestrator adaptation.
- Any tests that assert directly on Effect `Exit` values for repository failures will need rewriting.

### Phase 3: Runtime state and auth service simplification

Files:

- `apps/server/src/effect/runtime.ts`
- `apps/server/src/application/providerAuthService.ts`

Changes:

- Replace `Clock`, `IdGenerator`, `RuntimeState`, and `EventPublisher` tags/layers with plain service objects/classes.
- Replace `RuntimeStateLive` `Ref<Map<...>>` state with normal private `Map`s and imperative methods:
  - `getSessionRuntime`
  - `setSessionRuntime`
  - `getActiveTurn`
  - `setActiveTurn`
  - `clearActiveTurn`
- Convert `ProviderAuthService` from a layered Effect service to a plain class with async methods:
  - `read(...)`
  - `startChatGptLogin(...)`
  - `cancelLogin(...)`
  - `logout(...)`
- Replace the in-memory `Ref<Map<...>>` login tracker with a private `Map<string, ...>`.
- Replace `Effect.runFork(...)` background login completion with an explicitly detached async task that always cleans up the login map in `finally`.

Justification:

- This state is in-process only; it does not need Effect runtime semantics to be safe in a single Node event loop.
- `providerAuthService.ts` contains meaningful workflow logic, but a normal class with `async`/`await`, `try/catch`, and `finally` will be easier for contributors to follow.

Risks:

- Cleanup guarantees currently expressed with `Effect.ensuring(...)` must be preserved with `finally`.
- Background login completion must continue to swallow/report errors in the same user-visible way and must not leak unfinished login entries.

### Phase 4: Transport and composition root simplification

Files:

- `apps/server/src/transport/wsServer.ts`
- `apps/server/src/index.ts`

Changes:

- Replace `ManagedRuntime` injection in `WebSocketCommandServer` with direct dependencies:
  - `threadOrchestrator`
  - `providerAuthService`
  - `replayService`
- Convert `handleCommand(...)` into a normal `async` method with direct `await` calls and a single `try/catch` that maps thrown backend errors into transport-safe error payloads.
- Replace `Layer.mergeAll(...)` composition in `index.ts` with explicit object construction and wiring.
- Keep the publisher bridge that sends domain events to `ConnectionRegistry`, but provide it as a normal object/function instead of a Layer service.

Justification:

- The transport layer is already imperative and request/response oriented; removing `Exit`, `Cause`, `Option`, and `ManagedRuntime` will make command handling much easier to understand.
- The dependency graph is small and static enough that explicit construction is clearer than layered DI.

Risks:

- `threadOrchestrator.ts` will still be Effect-based after this phase, so `index.ts` and `wsServer.ts` need a small boundary for invoking it safely.
- If interop is handled inconsistently, the backend could end up with a more confusing split than before. This phase should standardize one boundary helper for "run orchestrator Effect, catch backend errors, return normal Promise".

### Required interop boundary during the transition

Because `threadOrchestrator.ts` remains Effect-based for now, the migration should introduce one narrow compatibility boundary rather than many ad hoc conversions.

Recommended approach:

- Add a small helper near the composition root that runs an Effect program and returns a `Promise`, preserving thrown backend errors.
- Use that helper only where plain services need to call the orchestrator or provider-streaming path.
- Do not keep broad `Layer`/`ManagedRuntime` plumbing solely for this interop.

This keeps the codebase readable while preserving the current streaming model.

### Suggested implementation order inside the branch

1. Phase 1 low-risk services and auth helpers
2. Phase 2 repositories and repository tests
3. Phase 3 runtime state and provider auth service
4. Phase 4 WebSocket server and composition root
5. Final cleanup to remove obsolete Effect tags/layers/imports left behind by phases 1-4

## Risks

- The main architectural risk is ending up with messy interop between promise-first services and the still-Effect-based orchestrator. The migration should keep this boundary explicit and minimal.
- Repository signature changes will fan out into many tests and service constructors.
- It is easy to regress cleanup semantics when converting `Effect.ensuring(...)` to manual async code.
- WebSocket transport error mapping must remain stable so the frontend does not observe changed error codes or messages.
- If the migration drags on across many partial commits, the codebase could be harder to follow temporarily than either the old or final state.

## Validation

- Update unit tests alongside each migrated file rather than waiting until the end.
- Add regression tests where cleanup semantics matter, especially OAuth cancellation/timeout and active login cleanup.
- Add or update transport tests to verify stable command response error mapping after `wsServer.ts` stops using `ManagedRuntime.runPromiseExit(...)`.
- Run the required project validation commands after each phase or at minimum before each mergeable checkpoint:
  - `bun run test`
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`

## Completion Criteria

- Phases 1-4 files use plain classes/functions and direct return values or promises instead of `Context.GenericTag`, `Layer`, `ManagedRuntime`, `Ref`, and `Effect.try*` wrappers.
- Provider streaming remains Effect-based only in the provider/orchestrator boundary where it is clearly useful.
- `wsServer.ts` handles requests with normal async control flow and preserves current transport error behavior.
- `index.ts` wires backend services explicitly without layered dependency composition.
- Existing tests are updated and new regression tests cover any lifecycle-sensitive behavior touched by the migration.
- All required validation commands pass: `bun run test`, `bun fmt`, `bun lint`, and `bun typecheck`.
