## Summary

Harden Magick's Codex login lifecycle so login state is owned and resolved by the backend rather than inferred from popup behavior on the frontend. The implementation should replace the current implicit `activeLoginId`-only model with an explicit login state machine, backend-managed expiration and failure handling, stable retry semantics, and frontend UX that reflects authoritative auth state from the server.

## Motivation

The current Codex auth flow works for the happy path, but it is fragile when the browser login is abandoned, canceled, popup-blocked, or otherwise never reaches a successful callback. Right now the frontend can recover some cases by polling `window.closed`, but that is only a best-effort signal and not an authoritative source of truth.

This creates several long-term problems:

- Login correctness currently depends partly on frontend popup behavior instead of backend-owned auth lifecycle state.
- The auth model is too coarse. `activeLoginId` tells us that something is in flight, but not whether it is pending, failed, canceled, expired, or recoverable.
- A stuck or abandoned login can leave the UI in a confusing intermediate state until the user retries or refreshes.
- The frontend has to invent recovery behavior that should really be guaranteed by the backend.

Industry-standard OAuth flows generally treat popup-close detection as a UX enhancement, not as the correctness boundary. The backend should own login state transitions, expiry, and terminal cleanup, while the frontend simply reflects that state and offers retry or cancel actions.

## Scope

This plan covers:

- backend auth lifecycle behavior in `apps/server/src/application/providerAuthService.ts`
- Codex OAuth harness state transitions in `apps/server/src/providers/codex/`
- provider auth contracts in `packages/contracts/src/provider.ts` and related websocket response/push shapes
- frontend auth UI and retry/cancel handling in `apps/web/src/app/AppShell.tsx` and the chat/sidebar auth surfaces
- test coverage for backend auth transitions, websocket responses, and frontend auth UX

This plan does not cover:

- adding additional providers beyond Codex
- API-key auth flows
- deep redesign of the visual styling outside the auth-specific states needed for correctness
- replacing the OAuth harness implementation unless required by lifecycle/state constraints

## Proposed Changes

### Backend-owned login state machine

- Replace the implicit auth model of `account + activeLoginId` with an explicit login lifecycle model.
- Extend provider auth state to report a dedicated login status, for example:
  - `idle`
  - `pending`
  - `succeeded`
  - `failed`
  - `cancelled`
  - `expired`
- Keep `activeLoginId` only as a correlation identifier for an in-flight login, not as the sole state signal.
- Add optional structured metadata for the current or latest login attempt, such as:
  - `loginId`
  - `startedAt`
  - `expiresAt`
  - `lastErrorCode`
  - `lastErrorDetail`

Recommended contract direction:

- evolve `ProviderAuthState` to include a `login` object instead of a bare `activeLoginId`
- the `login` object should encode both current status and enough metadata for UI recovery/debugging
- make the backend the source of truth for all transitions into and out of those states

### Add backend login expiration

- Every login attempt should have a server-side TTL.
- On `startChatGptLogin`, persist or track:
  - `loginId`
  - `providerKey`
  - `startedAt`
  - `expiresAt`
- If the login callback never completes before `expiresAt`, the backend must:
  - clear the active login state
  - mark the attempt as `expired`
  - emit an auth-state change to subscribers
- Expiration should not depend on any frontend behavior or browser window state.

Implementation options:

- minimum viable: keep active login metadata in-memory with a scheduled timeout
- stronger option: persist pending login attempts in storage so server restarts do not leave ambiguous state

Recommended path:

- start with explicit in-memory expiration tied to `ProviderAuthService`
- if restart resilience becomes important, add persistence for pending login attempts in a follow-up phase

### Make login retry semantics explicit and idempotent

- Starting a login while one is already pending should no longer simply fail with `provider_login_in_progress`.
- Replace that with one of two explicit policies:

Policy A: resume existing login
- if a login is already pending and still valid, return the existing `loginId` and `authUrl`
- frontend can reopen the URL or continue waiting

Policy B: replace existing login
- explicitly cancel the existing pending login
- create a fresh login attempt
- emit state transitions cleanly so subscribers never see ambiguous overlap

Recommended direction:

- prefer Policy A for correctness and user clarity when the existing login is still valid
- support explicit replace/cancel if the user chooses to restart

This likely means evolving `provider.auth.login.start` so it can return either:

- a new login attempt
- the currently active login attempt

with enough metadata for the frontend to decide whether to reopen or simply reflect that state.

### Treat popup-close detection as secondary only

- Keep popup-close detection in the frontend only as a UX accelerant.
- It may still be useful to trigger `provider.auth.login.cancel` early when the user closes the auth window.
- But correctness must not depend on it.
- The backend timeout/expiration path should guarantee eventual cleanup even if:
  - `window.open` returns `null`
  - the popup becomes detached
  - the auth flow happens in a tab instead of a popup
  - the browser blocks or rewrites popup behavior

### Distinguish failure, cancellation, and expiration

- Backend auth logic should classify terminal outcomes explicitly.
- At minimum distinguish:
  - user cancellation
  - popup/tab abandoned until expiration
  - OAuth callback or token exchange failure
  - refresh/auth repository failure that invalidates auth
- These states should flow through `provider.authStateChanged` push events so the frontend can render meaningful UI.

Recommended backend behavior:

- OAuth harness cancellation path maps to `cancelled`
- timeout cleanup maps to `expired`
- token exchange or callback failure maps to `failed`
- successful token persistence maps back to logged-in authenticated state with login status reset to `idle`

### Improve websocket auth contracts

- Update websocket command and response flows so auth state can be fully reconstructed from backend responses.
- `provider.auth.read`, bootstrap payloads, and `provider.authStateChanged` should all expose the richer auth/login state consistently.
- Avoid one-off frontend inference rules.

Likely contract updates:

- `packages/contracts/src/provider.ts`
  - extend `ProviderAuthState`
- `packages/contracts/src/ws.ts`
  - ensure auth response and push shapes carry the richer state unchanged

### Frontend UX changes

- Keep the frontend layout and overall auth presentation aligned with the current implementation rather than redesigning the auth surfaces.
- Render auth state directly from backend-provided lifecycle data.
- Signed-out state should continue to use the current sidebar auth-gate pattern, but the button text should be `login` rather than `not logged in`.
- Signed-out state should show:
  - `login`
  - optionally `logging in`, `login failed`, `login cancelled`, or `login expired` based on backend state
- Signed-in state should continue to show `logout` and the normal chat sidebar.
- If a login is pending:
  - the UI should offer a clear `cancel` or `retry login` action rather than becoming ambiguously disabled
  - if resume semantics are adopted, it may also offer `continue login`
- If a login fails or expires:
  - the UI should recover automatically to a clickable retry state
  - stale pending UI should never persist indefinitely

Recommended UI behavior:

- preserve the current signed-out sidebar auth gate and signed-in sidebar/chat layout
- use `login` as the signed-out button label in both the sidebar gate and any supporting auth controls
- no permanently disabled login button for signed-out users
- if backend says `pending`, show a pending state plus an explicit recovery action without replacing the current layout pattern
- if backend says `failed` / `expired` / `cancelled`, immediately show a retryable state with  reason text

### Internal service structure

- Extract login attempt lifecycle handling into a dedicated internal abstraction in `ProviderAuthService`.
- Suggested responsibilities:
  - create attempt
  - mark active
  - complete successfully
  - fail
  - cancel
  - expire
  - emit state updates
- Keep token persistence and refresh separate from login lifecycle state so the service remains understandable.

Possible internal module breakdown:

- `apps/server/src/application/providerAuthService.ts`
- `apps/server/src/application/providerAuthLoginState.ts`
- `apps/server/src/application/providerAuthLoginTimeouts.ts`

This split is optional, but some separation will likely make the lifecycle easier to test and debug.

### Logging and observability

- Add structured logs for auth lifecycle transitions without logging secrets.
- Log events like:
  - login started
  - login resumed
  - login cancelled
  - login expired
  - login failed during exchange
  - login succeeded
- Include:
  - provider key
  - login id
  - timestamps
  - high-level failure reason or code
- Do not log raw access tokens, refresh tokens, or auth codes.

### Suggested implementation phases

1. Contract phase
- extend `ProviderAuthState` with explicit login lifecycle state
- update websocket/bootstrap/auth push contracts to carry the richer shape

2. Backend lifecycle phase
- implement explicit login attempt state tracking in `ProviderAuthService`
- add expiration timers and terminal-state cleanup
- map cancellation/failure/expiry to distinct states

3. Retry/resume phase
- change `startChatGptLogin` semantics so pending login is resumable or replaceable instead of hard-failing
- make this behavior deterministic and documented

4. Frontend UX phase
- update `AppShell` auth UI to reflect backend lifecycle state directly
- keep popup-close cancellation only as an optional fast path
- remove any logic that treats disabled login as the recovery mechanism

5. Hardening phase
- add deeper tests for timeout expiry, canceled popup, duplicate login attempts, and callback failures
- verify state convergence across bootstrap and push updates

## Risks

- Expanding auth state contracts will require coordinated backend, frontend, and test updates.
- If login lifecycle is tracked only in-memory, server restart behavior may still leave edge cases around stale auth UI until the next read/bootstrap.
- Introducing richer login states can make the UI more complex if failure messaging is not kept restrained and operational.
- Resume-versus-replace semantics for duplicate login attempts need to be chosen carefully or they can confuse users.
- Timer-based expiry adds new edge cases around race conditions when a callback succeeds close to the expiry boundary.
- If state transitions are not centralized, the service can become harder to reason about than the current simpler model.

## Validation

- Unit tests for `ProviderAuthService` should cover:
  - unauthenticated read state
  - login started state
  - successful login completion
  - explicit cancellation
  - automatic expiration
  - token exchange failure
  - retry/resume behavior when a login is already pending
- Websocket tests should cover:
  - bootstrap auth state shape
  - `provider.auth.login.start`
  - `provider.auth.login.cancel`
  - `provider.auth.logout`
  - `provider.authStateChanged` push events for pending, cancelled, expired, failed, and success transitions
- Frontend tests should cover:
  - signed-out login state
  - pending login state
  - retry after cancellation
  - retry after expiration
  - transition to signed-in state after successful login
- Playwright verification should cover the real browser flow for:
  - starting login and canceling it by closing the auth window
  - retrying login after cancellation
  - recovering from a stale pending login state
  - logging out and returning to the signed-out UI
- Logging validation should confirm that auth lifecycle events are observable without leaking sensitive credential data.
- Required project validation commands should pass before implementation is considered complete:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`
  - `bun knip`
  - `bun run test`

## Completion Criteria

- Login correctness no longer depends on frontend popup polling.
- The backend exposes explicit, authoritative login lifecycle state instead of only `activeLoginId`.
- Pending logins automatically expire and clear without requiring frontend intervention.
- Duplicate login attempts follow a documented resume-or-replace policy rather than returning a dead-end state.
- The frontend always returns to a retryable state after cancellation, failure, or expiration.
- Signed-out users are never stuck behind a permanently disabled login button.
- Bootstrap auth state, websocket push state, and frontend-rendered auth state all agree on the same backend-owned lifecycle model.
- All required validation commands from `AGENTS.md` pass: `bun fmt`, `bun lint`, `bun typecheck`, `bun knip`, and `bun run test`.
