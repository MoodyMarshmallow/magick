## Summary

Migrate Magick's Codex integration away from `codex app-server` and onto a Magick-owned OAuth harness plus direct Codex HTTP integration, while preserving the existing provider-agnostic orchestration, persistence, and replay architecture.

## Motivation

`codex app-server` gave us a strong starting point for session lifecycle and ChatGPT-managed auth, but it also makes Magick dependent on a separate local runtime for authentication, thread control, and protocol compatibility. That adds process-management complexity, hides important auth state behind a subprocess boundary, and limits how much of the Codex experience Magick can own directly.

OpenCode demonstrates a different path: own the OAuth flow, refresh tokens directly, and call the Codex backend over HTTP with Magick-controlled headers and account context. Moving in that direction would let Magick present a first-class login experience, inspect and manage auth state directly, and reduce its dependency on Codex app-server-specific behavior.

We should keep the backend event pipeline and provider abstraction, but replace the Codex transport/auth implementation underneath it.

## Scope

This plan covers the Codex integration path in `apps/server`, the provider/auth contracts in `packages/contracts`, and relevant updates to operational guidance in `AGENTS.md`. It does not require changing the frontend in this pass beyond whatever new auth/status commands are exposed by the backend contracts.

## Proposed Changes

### Integration direction

- Replace the current Codex provider runtime's dependency on `codex app-server` stdio JSON-RPC with a Magick-owned OAuth and HTTP client implementation.
- Preserve the existing provider-agnostic architecture: `ThreadOrchestrator`, SQLite persistence, replay, projections, and WebSocket transport should remain the stable core.
- Treat this as a transport/auth swap under the Codex provider adapter, not as a rewrite of the full backend.

### Auth architecture

- Introduce a dedicated Codex auth subsystem in `apps/server/src/providers/codex/` that owns:
  - ChatGPT browser OAuth login
  - optional headless/device auth flow if Codex supports it reliably enough for us to adopt
  - access token refresh
  - logout and auth invalidation
  - extraction and persistence of ChatGPT account identifiers needed for Codex backend requests
- Persist OAuth credentials in a Magick-owned store rather than treating Codex CLI state as the source of truth.
- Define explicit auth records containing at minimum:
  - auth mode
  - access token
  - refresh token
  - expiry time
  - account id / organization context if present
  - email and plan metadata when available
- Keep auth isolated behind a `ProviderAuthService` so future providers can adopt their own auth implementations without leaking Codex-specific details into transport or orchestration.

### Codex HTTP client

- Replace `CodexAppServerClient` with a direct Codex HTTP client that targets the ChatGPT Codex backend.
- Build requests with Magick-controlled headers, including:
  - `Authorization: Bearer <access token>`
  - `ChatGPT-Account-Id` when required by the selected account context
  - Magick-specific origin/session identifiers for observability where supported
- Centralize token refresh inside the HTTP client so expired sessions are recovered automatically when safe.
- Model request/response handling so provider errors can still be mapped into Magick's typed provider-neutral error channel.

### Thread and turn mapping

- Rework the Codex provider adapter so native provider references are Codex backend thread identifiers rather than app-server thread ids.
- Replace `thread/start` / `thread/resume` / `turn/start` app-server RPC calls with the corresponding direct Codex backend thread/run APIs.
- Preserve the current Magick contract that the provider layer emits normalized provider events like:
  - `output.delta`
  - `output.completed`
  - `turn.failed`
  - `session.disconnected`
  - `session.recovered`
- If Codex direct HTTP returns richer event types than we currently expose, keep them internal until we have a cross-provider event model for them.

### Streaming strategy

- Implement streaming directly over the Codex backend's supported response stream format rather than relying on app-server notifications.
- Normalize streamed deltas into the existing provider event stream consumed by `ThreadOrchestrator`.
- Explicitly handle partial output, stream termination, interrupt behavior, auth expiry mid-stream, and transient network failures.

### Auth status and login UX backend support

- Keep `provider.auth.read`, `provider.auth.login.start`, `provider.auth.login.cancel`, and `provider.auth.logout`, but make them Magick-owned rather than app-server pass-through calls.
- Add support for reporting richer auth state, such as:
  - whether the current account is ChatGPT-managed or API-key based
  - current plan metadata
  - active login in progress
  - token freshness / refresh viability where useful
- Ensure login flows survive browser round-trips cleanly and can be cancelled or resumed without leaving leaked auth state behind.

### Persistence changes

- Add a provider auth table or equivalent secure persistence mechanism for provider credential state.
- Separate provider auth records from provider session records so auth can be refreshed independently of thread/session lifecycles.
- Persist Codex-native thread references in `provider_sessions` or a dedicated session metadata structure as needed for resume support.

### Migration path

1. Add Magick-owned Codex auth store and service alongside the current app-server path.
2. Implement direct OAuth login, token refresh, auth status, and logout.
3. Implement a direct Codex HTTP client behind a new runtime interface.
4. Add a second Codex runtime path behind a feature flag or configuration switch.
5. Validate direct-thread create/resume/send/interrupt flows end to end.
6. Remove app-server dependency from the active Codex provider path once parity is reached.
7. Delete obsolete app-server-specific Codex transport code after migration is complete.

### AGENTS.md updates

- Update `AGENTS.md` so it no longer describes `codex app-server` as the long-term or primary architectural direction for Magick.
- Document that Magick is moving toward a first-party OAuth harness and direct Codex backend integration, while remaining provider-agnostic at the orchestration layer.
- Add OpenCode as a reference implementation specifically for OAuth and direct Codex transport behavior.

## Risks

- Owning OAuth directly introduces security and token-handling responsibilities that `codex app-server` currently abstracts away.
- The direct Codex backend may change more frequently or be less stable for external integrations than the app-server contract.
- Interrupt and streaming semantics may differ from app-server behavior, creating edge cases in replay and partial-output handling.
- Incorrect account-id or token refresh handling could create confusing auth failures that are harder to debug than app-server pass-through errors.
- Supporting both the old app-server path and the new direct path during migration could temporarily increase code complexity.

## Validation

- Unit tests should cover OAuth state transitions, token refresh behavior, account-id extraction, direct Codex request construction, and auth error mapping.
- Integration tests should cover login state read, login start/cancel/logout, direct thread creation, resume, send message, interrupt, and token refresh recovery.
- Orchestration tests should confirm the rest of the backend behaves the same regardless of whether Codex uses app-server transport or direct HTTP transport.
- Transport tests should verify that auth-related WebSocket commands return stable response shapes and do not leak sensitive credential material.
- Logging should make auth and request failures traceable without logging raw access or refresh tokens.
- Required project validation commands should pass before the migration is considered complete: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.

## Completion Criteria

- Codex authentication is handled by a Magick-owned OAuth harness instead of `codex app-server`.
- Codex login status, login, cancellation, logout, and token refresh are available through Magick backend services and contracts.
- The Codex provider adapter uses direct Codex backend requests rather than stdio JSON-RPC app-server calls for thread and turn execution.
- Existing backend orchestration, persistence, replay, and WebSocket interfaces continue to work with the new transport path.
- App-server-specific Codex runtime code is either removed or clearly isolated behind a deprecated migration path.
- All required validation commands from `AGENTS.md` pass: `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
