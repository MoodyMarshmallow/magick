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

Long term maintainability is a core priority. If you add new functionality, first check if there are shared logic that can be extracted to a separate module. Duplicate logic across mulitple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem. In addition, you need to make sure your code is easy to evaluate and debug. Towards this end, you should always write unit testing for all files with logic that you write. You should also ensure that variables and functions have names that are unambiguous and clearly communicate their exact function, rather be a more verbose with naming than giving them names that may be confusing to understand. Lastly, you should make extensive logging that is clear, detailed, and specific.

## Testing

- Always write comprehensive unit tests for the code you add or change when that code contains logic.
- Build tests bottom-up: start with the smallest pure helpers and reducers first, then add tests for higher-level orchestration built on top of them.
- After writing tests, use a file read tool to read them again and think to yourself about whether the test cases cover all edge cases that would be encountered in real usage. If tests are not absolutely comprehensive, you should iterate on them.
- Prefer small, deterministic tests with explicit inputs and outputs over broad tests that are hard to debug.
- Test failure paths, malformed input, replay or duplicate events, persistence boundaries, and recovery behavior whenever those concerns exist in the code under test.
- When state changes over time, test the full lifecycle: initial state, transition states, terminal states, and no-op or invalid transitions.
- For streaming or async behavior, make tests deterministic by controlling time, ids, scheduling, and network or provider boundaries with test doubles.
- Keep tests close to the logic they verify, and structure them so a future contributor can understand the intended behavior from the test file alone.
- Avoid shallow tests that only assert implementation details. Focus on observable behavior, invariants, and contract guarantees.
- If you add a new bug fix, add or update a regression test that would have failed before the fix.
- If a change affects UI, always verify it with Playwright against the running app, not just unit tests.
- For UI verification with Playwright, inspect the result both structurally and visually: read extracted DOM/text state with Playwright code or snapshots, and capture a targeted screenshot of the changed area.
- Store Playwright screenshots and named snapshot artifacts under `.playwright-cli/` instead of the repo root, for example `.playwright-cli/feature-name.png` and `.playwright-cli/feature-name.yaml`.

## Effect vs Promise Guidance

Use plain TypeScript functions, classes, and `Promise`/`async` by default. Only use Effect when it is clearly buying us something material for correctness, cancellation, streaming, or resource lifetime management.

Use Effect when:

- You are implementing provider streaming, event streams, or other long-lived async flows where `Stream`, cancellation, or structured composition is genuinely useful.
- You need precise resource lifetime management, interruption, or cleanup around sockets, subprocesses, or similar runtime-managed resources.
- You are working in the existing provider/orchestration boundary that already uses Effect and changing just one local piece to promises would make the surrounding code more awkward.

Use promises/plain TypeScript when:

- The code is straightforward request/response logic, repository access, fetch wrappers, mapping, validation, or application service orchestration.
- The module mainly performs synchronous database work or simple async calls and Effect would just wrap thrown errors in extra ceremony.
- A plain class with constructor injection and `async` methods is easier to read and provides the same reliability.

Specific guidance for this repo:

- Prefer promises for persistence, auth helpers, transport handlers, composition roots, and simple application services.
- Keep Effect in the provider streaming/runtime path only where it is already central to the design.
- Do not introduce `Context.GenericTag`, `Layer`, or runtime plumbing for new code unless the module truly needs Effect-style dependency management.
- If a module could reasonably be written either way, choose the version that is easier for a new contributor to read and debug.

## Package Roles

- `apps/server`: Backend runtime. Owns provider integration, auth, persistence, orchestration, tools, and WebSocket transport.
- `apps/web`: Browser UI. Owns chat, workspace, document editing, and client-side state over the backend API.
- `apps/desktop`: Electron shell. Owns desktop packaging, local workspace access, filesystem watching, and native bridges.
- `packages/contracts`: Shared schemas and protocol/types for events, commands, providers, and persisted thread state.
- `packages/shared`: Shared runtime utilities used across apps, including ids, time, workspace helpers, and small cross-platform helpers.
- `scripts` and repo root config: Developer entrypoints, local orchestration, and workspace-wide tooling/configuration.

## Frontend Design Guidelines

The frontend Magick should feel like digital magick expressed through a restrained TUI-esquq interface. The UI should feel simplistic and slightly playful, but not ornamental.

- You can think of the central design philosophy of Magick as 'digital-magick,' combining elements of TUIs and magick, with a touch of retro game design feel.
- Lean into TUI aesthetics: strong panel divisions, clear rows, mono-forward typography, flat surfaces, and obvious information hierarchy.
- Keep controls visually minimal. Buttons should be borderless by default and rely on hover, active, focus, and selection states rather than persistent outlines or filled pills.
- Corners should stay sharp. Avoid rounded corners unless directed.
- Prefer flat fills over gradients, glass, shadows, or soft depth effects.
- Use color sparingly and intentionally. Aqua, yellow, green, and red should read as signals, not decoration.
- Default toward icon + text pairings that are austere and legible. Icons should feel barebones and utilitarian, not friendly or over-detailed.
- Keep layout simple. The interface should feel clean, and only surface the most important information to the user.
- Titles and labels should be short, plain, and operational. Avoid marketing-style copy in product UI.
- Hover states should feel crisp and understated. Selection and active states should be stronger than hover, but still minimal.
- Scrollbars, dividers, and overlays are part of the visual language. Treat them as deliberate interface elements rather than browser defaults.
- When adding new UI, match the existing workspace/sidebar/tab chrome instead of introducing a separate visual system.
- If a design choice is between “clean but slightly severe” and “soft and friendly,” prefer the cleaner, more severe option.

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
