# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Snapshot

Magick is a beautiful, minimal, web GUI for LLMs like ChatGPT built to support powerful productivity workflows.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there are shared logic that can be extracted to a separate module. Duplicate logic across mulitple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem. In addition, you need to make sure your code is easy to evaluate and debug. Towards this end, you should always write unit testing for all files with logic that you write. You should also make extensive logging that is clear, detailed, and specific.

## Package Roles

- `apps/server`: Node.js WebSocket server. Owns provider orchestration, auth integration, persistence, and WebSocket delivery for the React app.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@magick/shared`) — no barrel index.

## Codex Integration (Important)

Magick is Codex-first and now owns Codex auth and transport directly inside Magick rather than relying on `codex app-server` as the integration surface.

How we use it in this codebase:

- Provider dispatch, auth handling, and thread orchestration are coordinated under `apps/server/src/application/` and `apps/server/src/providers/`.
- The current Codex runtime lives under `apps/server/src/providers/codex/`.
- Web app consumers should continue to rely on orchestration domain events and typed WebSocket commands rather than provider-specific transport details.
- If implementing new Codex work, keep the direct OAuth, token refresh, and Codex HTTP transport path as the source of truth.

Docs:

- Codex auth/docs overview: https://developers.openai.com/codex/auth

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor
- OpenCode (direct OAuth and Codex transport reference): https://github.com/anomalyco/opencode
- T3 code: https://github.com/pingdotgg/t3code

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.
