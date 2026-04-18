## Summary

Add opencode-like assistant finish metadata to Magick's Codex turn pipeline and use it to decide when a turn should continue versus stop. The immediate goal is to fix repeated final outputs and redundant continuation requests without dropping current-turn assistant content and without first migrating the Codex transport to the AI SDK.

## Motivation

Magick currently persists and replays assistant output from the active turn, but it has no durable metadata that distinguishes:

- an assistant segment that finished because tool work must continue
- an assistant segment that finished because the turn is actually done

That gap makes current-turn assistant text look more final than it really is. In practice, the same turn can:

1. emit commentary or final-looking assistant text
2. request one or more tools
3. continue by sending rebuilt history back to Codex

Because Magick does not persist an opencode-like finish reason, the rebuilt history replays provisional final output as if it were terminal conversation history. The logs already show the consequence:

- repeated final outputs in the same turn
- growing final assistant history blobs
- redundant continuation requests after a turn appears complete

OpenCode avoids this class of bug by tracking assistant finish state and stopping only when the latest assistant is genuinely finished and no unresolved tool work remains. Magick should adopt the same semantic boundary, but derive the finish state from the raw Responses stream it already parses.

## Scope

This plan covers:

- provider event types in `apps/server/src/ai/agent/providers/providerTypes.ts`
- Codex stream reduction in `apps/server/src/ai/agent/providers/codex/codexResponsesClient.ts`
- Codex provider event mapping in `apps/server/src/ai/agent/providers/codex/codexProviderAdapter.ts`
- chat contracts and transcript message metadata in `packages/contracts/src/chat.ts`
- provider event persistence in `apps/server/src/ai/agent/threads/runtime/threadEventPersistence.ts`
- server projection in `apps/server/src/ai/agent/threads/domain/threadProjector.ts`
- history rebuilding in `apps/server/src/ai/agent/threads/domain/threadHistoryBuilder.ts`
- turn continuation logic in `apps/server/src/ai/agent/threads/runtime/threadTurnRunner.ts`
- regression tests for provider reduction, persistence, history rebuilding, and turn continuation behavior

This plan does not cover:

- migrating the Codex provider stack to the AI SDK
- changing the current ChatGPT/Codex OAuth transport path
- dropping current-turn assistant content from continuation history
- changing transcript UI rendering

## Proposed Changes

### 1. Introduce assistant completion reason metadata at the provider boundary

Add a provider-facing completion-reason classification for completed assistant message segments.

Recommended type:

- `AssistantCompletionReason = "tool_calls" | "stop" | "incomplete"`

Recommended first insertion point:

- extend `ProviderEvent["output.message.completed"]` with `reason`

Why this is the right layer:

- it is provider-agnostic enough for orchestration to reason about
- it matches opencode's use of assistant finish-reason metadata
- it avoids leaking raw Responses API object shapes beyond the Codex boundary

### 2. Derive finish from the current Codex Responses stream instead of waiting for an AI SDK migration

`codexResponsesClient.ts` already tracks the key facts needed to derive an opencode-like completion reason:

- whether a response segment saw any `tool.call.requested`
- whether the response segment reached `response.completed`
- whether the stream failed before clean completion
- which assistant output items completed in that segment

Recommended derivation rules per single Responses API call:

- if the segment completed cleanly and saw one or more tool calls:
  - completed assistant items in that segment get `reason: "tool_calls"`
- if the segment completed cleanly and saw no tool calls:
  - completed assistant items in that segment get `reason: "stop"`
- if the segment fails or is interrupted before clean completion:
  - completed assistant items in that segment get `reason: "incomplete"`, or no completion should be emitted until that behavior is modeled deliberately

Recommended implementation detail:

- stop emitting `output.message.completed` immediately at raw item completion time with no completion context
- instead, keep enough per-item state to finalize completion with reason metadata once the surrounding response segment outcome is known

This mirrors what the AI SDK and chat-completions abstractions do for callers, but keeps Magick on its current direct Codex transport.

### 3. Persist completion reason metadata as part of assistant message completion events

The completion-reason classification needs to survive replay and history rebuilding.

Recommended changes:

- extend the chat/event contracts in `packages/contracts/src/chat.ts`
- extend the persisted `message.assistant.completed` event payload with `reason`
- update `threadEventPersistence.ts` so provider events carry the new field through unchanged

Important constraint:

- completion-reason metadata belongs to assistant message completion, not to the whole turn

Why this matters:

- a turn may emit one or more assistant messages before it is really done
- tool calls can happen after assistant text in the same turn
- `turn.completed` alone is too coarse to explain whether the last assistant segment was provisional or terminal

### 4. Project assistant completion reason metadata into the thread snapshot

`threadProjector.ts` should preserve completion reason metadata on assistant transcript messages or on closely related per-turn state so orchestration can reason about the latest assistant segment for the active turn.

Recommended direction:

- attach optional `reason` metadata to persisted/projected assistant transcript messages
- keep this metadata internal or debug-oriented if it is not needed on the web immediately
- do not change the visible transcript UI just to support the stop-condition fix

Why this is recommended:

- replay after restart should not lose whether the last assistant message was provisional
- history rebuilding should not need to infer terminality from ad hoc event ordering every time

### 5. Keep current-turn content, but rebuild it with reason-aware semantics

Do not solve this by deleting or suppressing active-turn assistant history.

Instead:

- keep current-turn assistant content in rebuilt history
- keep tool calls and tool results as they are today
- let continuation logic inspect the latest assistant segment's `reason`

`threadHistoryBuilder.ts` should remain responsible for reconstructing message, tool call, and tool result history, but it should become finish-aware.

Recommended direction:

- preserve assistant message completion-reason metadata while rebuilding history
- make that metadata available to the turn runner, either through enriched history items or a separate active-turn inspection helper

The core rule is:

- current-turn content stays
- stop/continue decisions come from reason metadata, not from hiding content

### 6. Add an explicit active-turn stop condition in the turn runner

`threadTurnRunner.ts` currently continues the loop whenever tool results are submitted and the provider stream has not emitted `turn.completed`.

That logic should be tightened to match opencode's semantics.

Recommended stop condition:

- continue if either:
  - the latest assistant completion for the active turn has `reason === "tool_calls"`, or
  - there is unresolved tool work for that turn
- stop if all are true:
  - the latest assistant completion for the active turn has `reason === "stop"`
  - there is no unresolved tool work for that turn
  - the turn has reached its terminal state

Recommended unresolved-tool definition for the first pass:

- any tool activity in `requested`, `running`, or `awaiting_approval` status counts as unresolved

This should be evaluated after each continuation step and before issuing another follow-up request.

### 7. Treat contradictory terminal states as protocol errors

Once completion-reason metadata exists, Magick can be stricter about invalid provider behavior.

Recommended handling:

- if an assistant segment is finalized with `reason: "stop"` and later in the same turn the provider still attempts more tool continuation, treat that as a protocol failure or at minimum log it loudly
- do not silently continue past an already terminal assistant finish

This is important for debugging and for preventing the same turn from drifting into contradictory states.

### 8. Keep the AI SDK migration as a follow-up refactor, not part of this fix

The AI SDK would provide a normalized `finishReason`, but it would not eliminate the need for Magick to:

- map step/message output into `ProviderEvent`
- persist assistant completion-reason metadata
- define a turn-level stop condition against Magick's own projected tool state
- preserve the custom ChatGPT/Codex OAuth transport behavior that opencode implements with a custom fetch shim

Because Magick already has enough low-level signal to derive finish metadata directly, this fix should stay on the current transport and leave an AI SDK migration for a separate plan.

### 9. Add regression coverage around provisional final output and continuation loops

Required new tests:

- `codexResponsesClient.test.ts`
  - assistant item completes in a response segment that also contains a tool call
  - completion emits `reason: "tool_calls"`
- `codexProviderAdapter.test.ts`
- mapped provider events preserve completion-reason metadata
- `threadEventPersistence.test.ts`
- `message.assistant.completed` persists completion-reason metadata end-to-end
- `threadProjector.test.ts`
- projected assistant messages retain completion-reason metadata and tool activity remains resolvable
- `threadHistoryBuilder.test.ts`
- rebuilt history preserves current-turn assistant content while exposing reason information needed by orchestration
- `threadTurnRunner.test.ts`
  - a turn that emits final-looking text, then tool calls, then more assistant output should not loop indefinitely
- a turn should stop once the latest assistant reason is `stop` and all tool work is resolved

Most important regression scenario:

1. user message starts a turn
2. assistant emits commentary or final-looking text
3. assistant requests a tool
4. tool result is submitted
5. continuation request includes the current-turn content
6. turn stops only after a later assistant segment completes with `finish: "stop"`

## Risks

- Deriving `reason` at the wrong boundary could make Magick mark a provisional assistant segment as terminal, which would stop valid tool continuations too early.
- If `incomplete` handling is underspecified, recovery after interruption may remain ambiguous.
- Extending transcript or event contracts may require careful migration across persisted local thread data and tests.
- Stop-condition checks that inspect projected tool state must stay aligned with how `threadProjector.ts` models requested, running, completed, failed, and approval-gated tools.
- There is still a future AI SDK migration risk, but combining it with this fix would make the behavior harder to isolate and validate.

## Validation

- Add bottom-up unit tests for completion-reason derivation in `codexResponsesClient.ts`
- Add provider mapping tests for `output.message.completed.finish`
- Add projector/history tests that prove finish metadata survives persistence and replay
- Add a `threadTurnRunner` regression test for repeated-final-output loops caused by provisional final text before tool continuation
- Run:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`
  - `bun knip`
  - `bun run test`

## Completion Criteria

- completed assistant message segments carry durable completion-reason metadata derived from the current Codex Responses stream
- assistant completion-reason metadata persists through provider mapping, event persistence, projection, and history rebuilding
- current-turn assistant content is still replayed on continuation requests
- the turn runner stops issuing continuation requests once the latest assistant reason is terminal and no unresolved tool work remains
- the repeated-final-output regression is covered by tests and no longer reproduces
- no AI SDK migration is required to ship the fix
