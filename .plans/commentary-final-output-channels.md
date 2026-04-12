## Summary

Reorganize Magick's single assistant text-output path into two durable assistant output channels: `commentary` for intermediary progress updates and `final` for the completed answer. The change should replace unlabeled assistant text across the main server/web transcript pipeline so every persisted agent-authored text message is explicitly channelized, replayable after reload, and rendered through the same UI surface as today's standard assistant text.

## Motivation

Magick currently models assistant transcript output as a single stream of `role: "assistant"` text with no distinction between progress narration and the completed answer. That is too coarse for the desired behavior.

The new requirement is stronger than a rendering tweak:

- `commentary` and `final` must completely replace the old unlabeled assistant text path.
- Both channels must be persisted in the full transcript and shown to both the user and the agent after reload.
- A turn may emit zero or more `commentary` messages and at most one `final` message.
- The two channels should render the same way as today's text messages by default, with no visible channel badge required in the UI.

The current event model also has a structural mismatch with this requirement. `turn.completed` currently doubles as both "the assistant message finished" and "the turn finished." That works for one assistant message per turn, but it is not robust enough once a turn can contain multiple durable assistant messages with different output channels.

## Scope

This plan covers:

- shared transcript and event contracts in `packages/contracts/src/chat.ts`
- provider stream interfaces in `apps/server/src/providers/providerTypes.ts`
- provider output parsing and adapter behavior in `apps/server/src/providers/`
- orchestration persistence and history rebuilding in `apps/server/src/application/threadOrchestrator.ts`
- server-side projection in `apps/server/src/projections/threadProjector.ts`
- web-side thread projection and transcript rendering in `apps/web/src/features/comments/`
- transport/bootstrap/replay behavior anywhere the updated transcript model flows through existing websocket contracts
- test coverage for parsing, persistence, replay, projection, and rendering

This plan does not cover:

- unifying the desktop-local thread store with the main server/web thread model
- changing how user-authored messages are modeled
- adding visible channel labels or a redesigned transcript UI
- changing provider auth, workspace storage, or unrelated thread architecture

## Proposed Changes

### 1. Define channel semantics and invariants explicitly

- Treat `commentary` and `final` as assistant-output-only channels. User messages remain unchanged.
- Persist both channels as first-class transcript messages.
- Keep the UI rendering path shared by default. The transcript should not need a separate visual component for `commentary` versus `final` just to ship this change.
- Enforce these invariants in contracts and projector logic:
  - a turn may emit zero or more `commentary` messages
  - a turn may emit at most one `final` message
  - once `final` output starts for a turn, no later `commentary` output is allowed in that same turn
  - a turn failure or interruption should only mark the currently streaming assistant message as failed/interrupted, not retroactively invalidate already completed commentary messages

Recommended type naming:

- add `AssistantOutputChannel = "commentary" | "final"`
- add `channel: AssistantOutputChannel` to persisted assistant transcript messages

### 2. Make transcript messages channel-aware

- Extend `TranscriptMessage` in `packages/contracts/src/chat.ts` so assistant messages carry their output channel.
- Keep `role: "assistant"` so the broader transcript model does not need to split assistant into two roles.
- Update any thread snapshot/bootstrap types that expose transcript messages so the web client receives the channelized transcript directly.

Recommended shape:

- `role` remains `"user" | "assistant"`
- assistant messages add `channel: "commentary" | "final"`
- user messages should not need a channel field

This keeps the change tightly scoped to assistant-output semantics without inventing a broader role taxonomy.

### 3. Separate message completion from turn completion

- Replace the current implicit assumption that one turn maps to one assistant message.
- Introduce explicit assistant-message lifecycle events rather than overloading `turn.completed`.

Recommended event direction:

- keep `turn.started`, `turn.completed`, `turn.failed`, and `turn.interrupted` as turn-lifecycle events
- introduce assistant-output message events that are independent from turn completion, for example:
  - `message.assistant.delta`
  - `message.assistant.completed`
- include `turnId`, `messageId`, and `channel` on those assistant-output events

Why this is recommended:

- commentary messages may complete before the turn completes
- a tool call may happen between commentary and final output
- a turn may fail after one or more completed commentary messages but before any final output exists
- replay/projector logic becomes much easier to reason about when message completion is explicit instead of inferred from unrelated turn events

### 4. Update provider stream contracts to emit channelized output

- Extend `ProviderEvent` in `apps/server/src/providers/providerTypes.ts` so assistant text deltas are channel-aware.
- Do not keep the current provider event model where `output.completed` implicitly means "the whole turn is done."

Recommended provider event model:

- `output.delta` includes:
  - `turnId`
  - `messageId`
  - `channel`
  - `delta`
- `output.message.completed` includes:
  - `turnId`
  - `messageId`
  - `channel`
- `turn.completed` becomes a pure turn-lifecycle event with no assistant-message completion responsibility

This change should be applied before orchestration work so the rest of the pipeline can rely on explicit semantics.

### 5. Introduce a shared assistant output protocol above raw provider text

- The current Codex transport only yields raw assistant text deltas plus tool calls. It does not natively provide `commentary` versus `final` channel metadata.
- Because of that, Magick needs a shared provider-layer output protocol that converts one raw assistant text stream into explicit channelized assistant messages.

Recommended architecture:

- add a shared provider utility such as `assistantOutputProtocol.ts` under `apps/server/src/providers/`
- define a canonical text framing protocol for assistant output, for example explicit channel tags like `<commentary>...</commentary>` and `<final>...</final>`
- instruct the agent through the shared assistant prompt to emit only channel-tagged assistant text
- parse the raw streamed text into channelized output messages before it reaches orchestration persistence

Important behavior requirements for the parser:

- support partial streaming frames where tags arrive across multiple deltas
- strip the protocol framing from persisted transcript text
- emit clean `output.delta` and `output.message.completed` events with stable `messageId`s
- reject invalid ordering such as `commentary` after `final` in the same turn
- preserve tool-call ordering relative to commentary/final transcript segments

Recommended rollout behavior:

- during the first implementation, log protocol violations clearly
- if a provider emits unlabeled raw text, prefer a controlled fallback to `final` plus warning rather than silently dropping content
- once the protocol is stable, tighten enforcement if needed

### 6. Update shared assistant instructions and history serialization

- The shared prompt in `apps/server/src/providers/prompts/default_assistant_instructions.txt` should be extended so the agent knows:
  - when to use `commentary`
  - when to use `final`
  - that every assistant-authored text message must use one of the two channels
  - that only one `final` message is allowed per turn
- Keep these instructions in the shared provider prompt layer rather than Codex-specific code so the behavior remains provider-agnostic.

Recommended prompt direction:

- update the system/shared assistant prompt so the channel instructions are written as direct behavioral rules, not loose suggestions
- keep the wording very close to the desired product definition so the runtime contract and the model instructions do not drift apart
- explicitly state that all assistant-authored text output must be sent through either `commentary` or `final`, with no third unlabeled text mode

Recommended prompt content should closely mirror the requested definitions:

- `commentary`
  - only use `commentary` for intermediary updates
  - these are short updates while working and are not the final answer
  - keep updates brief and use them to communicate meaningful progress, discoveries, tradeoffs, blockers, substantial plans, or the start of a non-trivial edit or verification step
  - do not narrate routine reads, searches, obvious next steps, or minor confirmations
  - do not begin with conversational interjections or meta commentary
  - before substantial work, send a short update describing the first step
  - before editing files, send a short update describing the edit
  - after enough context has been gathered, a longer progress update is allowed only when the work is substantial
- `final`
  - use `final` for the completed response
  - structure the response only as much as the task complexity requires
  - for simple tasks, a one-line final response is preferred
  - for larger changes, lead with the solution, then explain what changed and why
  - if something could not be completed, say so clearly
  - suggest next steps only when they are natural and useful

Prompt rules should also state:

- all assistant text messages must be either `commentary` or `final`
- these channels completely replace the old standard unlabeled text-output path
- the channels render the same way in the UI, so the assistant should not rely on a visible badge to communicate intent
- each turn may contain zero or more `commentary` messages and at most one `final` message
- once `final` output has started for a turn, no later `commentary` output is allowed in that turn

Because the user wants the agent to always see the full transcript after reload, assistant-history serialization also needs to preserve channel semantics.

Recommended changes:

- extend `ConversationContextMessage` and `ConversationHistoryItem` so assistant messages carry their channel
- when serializing assistant history back to provider requests, re-encode channel semantics through the same shared output protocol rather than flattening assistant history back to unlabeled text
- keep user history messages unchanged

### 7. Persist channelized assistant output in orchestration

- Update `ThreadOrchestrator` so provider output is persisted as channel-aware assistant message events.
- Rewrite history rebuilding in `#buildConversationHistory` so it reconstructs multiple assistant messages per turn with channel metadata, not just one concatenated assistant blob.
- Ensure message ids remain stable and deterministic across live streaming, replay, and continuation after tool calls.

Recommended orchestration behavior:

- each `commentary` or `final` emission becomes its own assistant transcript message
- tool calls should continue to split surrounding assistant output into separate transcript entries
- `submitToolResult` continuations must be able to emit additional `commentary` or the single `final` message for the active turn
- failure/interruption paths should only update the last still-streaming message for the turn

### 8. Update server and web projectors for channel-aware transcripts

- Server projector:
  - update `apps/server/src/projections/threadProjector.ts`
  - preserve multiple assistant transcript entries per turn with `channel`
  - use explicit message completion events rather than inference from `turn.completed`
- Web projector:
  - update `apps/web/src/features/comments/state/threadProjector.ts`
  - carry channel through `CommentMessage`
  - preserve ordering of commentary, tools, and final output in the active thread timeline

Recommended web model change:

- add `channel: "commentary" | "final"` to `CommentMessage` for assistant-authored messages
- keep rendering identical by default, but retain the field for future UX and debugging

### 9. Keep transcript rendering visually unchanged by default

- `CommentSidebar` and related transcript components should continue rendering channelized assistant messages through the existing Markdown/text path.
- Do not add visible labels like `commentary` or `final` unless product direction changes later.
- Ensure consecutive commentary messages remain readable and ordered correctly relative to tools and user messages.

This meets the requirement that both channels render the same way as current standard text.

### 10. Update fake provider and test harnesses first

- The fake provider is the fastest place to prove the channel model before relying on Codex behavior.
- Extend `FakeProviderAdapter` so tests can emit:
  - commentary-only output
  - commentary followed by final
  - commentary before tool calls and final after tool results
  - commentary followed by failure with no final
- Use those cases to harden orchestration and projector behavior before updating Codex parsing.

### 11. Suggested implementation phases

1. Contract phase
- add `AssistantOutputChannel`
- extend transcript/provider/history types with channel metadata
- introduce explicit assistant-message completion events distinct from `turn.completed`

2. Fake-provider and orchestration phase
- update fake provider stream types
- update `ThreadOrchestrator` persistence and history rebuilding
- update server projector and tests

3. Codex protocol phase
- add shared assistant output framing protocol and parser
- update shared assistant instructions
- adapt Codex raw text streaming into channelized provider events

4. Web projection and rendering phase
- propagate channelized transcript data into `CommentMessage`
- keep the rendering surface visually unchanged
- add regression coverage for ordering, reload, and replay

5. Hardening phase
- verify tool-call interleaving, turn failure, interruption, and replay behavior
- add logs for channel/protocol violations
- remove any remaining assumptions that assistant text is unlabeled

## Risks

- The largest technical risk is not the UI. It is the provider-stream parsing layer. Codex currently gives Magick one raw assistant text stream, so channel semantics must be imposed by prompt plus parser without introducing brittle streaming behavior.
- If message completion remains coupled to `turn.completed`, commentary persistence will be incorrect around failures, interruptions, and tool continuations.
- Partial-tag parsing can become error-prone if the protocol is not narrowly defined and heavily tested.
- History reconstruction must stay deterministic. If channel metadata is lost when rebuilding provider history, the model will stop seeing the same transcript the user sees.
- A permissive fallback for malformed output improves robustness but weakens strict protocol guarantees. A strict failure mode improves guarantees but can degrade UX if the model drifts.
- Desktop-local thread storage will remain structurally different after this change. That divergence is acceptable for now because it is intentionally out of scope, but it should be revisited later.

## Validation

- Unit tests for the shared assistant output protocol parser:
  - partial opening/closing tags across streamed deltas
  - multiple commentary messages in one turn
  - commentary followed by final
  - invalid ordering such as commentary after final
  - unlabeled text fallback or failure behavior
- Provider adapter tests:
  - fake provider emits channelized output correctly
  - Codex raw text is converted into channelized provider events correctly
  - tool-call interleaving preserves message order and channel boundaries
- Orchestrator tests:
  - commentary persists as its own transcript message
  - commentary plus final persists as two assistant messages
  - commentary survives reload/replay before a later final
  - failure after completed commentary does not mark prior commentary failed
  - tool continuation can emit final after prior commentary
- Projector tests:
  - server and web projectors preserve channel, status, and ordering
  - turn completion only finalizes turn state, not prior completed commentary messages
- UI tests:
  - transcript still renders channelized messages through the existing visual path
  - no visible channel label is introduced by accident
  - message ordering remains stable around tools and reloads
- Repository validation before completion:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`
  - `bun knip`
  - `bun run test`
- If transcript rendering changes in the browser, add Playwright verification of the changed chat flow with screenshots under `.playwright-cli/`.

## Completion Criteria

- Every assistant-authored persisted transcript message in the main server/web chat path is explicitly classified as `commentary` or `final`.
- No remaining main-path transcript or projector logic assumes a single unlabeled assistant text stream per turn.
- Assistant message completion is modeled independently from turn completion.
- The full transcript, including commentary and final messages, survives reload and replay unchanged.
- The agent receives channel-preserving assistant history when building provider context.
- The web transcript renders commentary and final through the same existing message UI without visible channel labels.
- One turn can contain multiple commentary messages and at most one final message, and tests enforce that invariant.
- All required validation commands pass.
