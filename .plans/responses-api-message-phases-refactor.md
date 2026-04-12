## Summary

Refactor Magick's Codex channel-output implementation to use the native OpenAI Responses API message `phase` syntax instead of the custom `<commentary>...</commentary>` / `<final>...</final>` text protocol. The goal is to preserve and resend assistant phase metadata exactly as the Responses API expects for `gpt-5.3-codex` and later, while keeping Magick's product-facing transcript model as the existing two channels: `commentary` and `final`.

## Motivation

The current implementation solved the channel split by inventing a provider-local text framing protocol and instructing the model to emit tagged text. That was a useful bridge, but it is not the right long-term transport contract for Codex.

The OpenAI Responses API now supports native assistant message phases:

- `commentary`
- `final_answer`

The docs and the referenced OpenCode issue both call out an important requirement for `gpt-5.3-codex` and later: follow-up requests should preserve and resend `phase` on assistant messages. Dropping it can degrade model behavior.

Magick's current custom tag protocol has several drawbacks that disappear if the transport uses native Responses syntax instead:

- it requires prompt-level formatting rules that the API already models natively
- it introduces collision bugs when assistant text needs to mention literal tag strings
- it adds a custom streaming parser that can fail independently of the model output contract
- it serializes assistant history in a format that is not the actual Responses API schema
- it creates extra protocol-hardening work that should not exist if we follow the upstream wire format

This refactor should make the Codex path thinner, more correct, and closer to the API contract the model is actually trained and documented for.

## Scope

This plan covers:

- Codex request serialization in `apps/server/src/providers/codex/codexProviderAdapter.ts`
- Codex streaming response parsing in `apps/server/src/providers/codex/codexResponsesClient.ts`
- removal of the custom assistant output protocol in `apps/server/src/providers/assistantOutputProtocol.ts`
- shared prompt cleanup in `apps/server/src/providers/prompts/default_assistant_instructions.txt`
- any supporting type changes needed at the provider boundary in `apps/server/src/providers/providerTypes.ts`
- regression coverage for native phase serialization, streaming, replay/history rebuilding, and completion semantics

This plan does not cover:

- changing Magick's product-facing channel names from `commentary` / `final`
- redesigning transcript UI or adding visible phase badges
- changing non-Codex providers unless they later adopt native Responses phase support
- adding backward compatibility for the removed tag protocol in persisted local data

## Proposed Changes

### 1. Replace the custom text protocol with native Responses API phase metadata

- Stop asking the assistant to encode channels in raw text.
- Remove the requirement that assistant output must be wrapped in `<commentary>` / `<final>` tags.
- Treat the Codex transport as a native Responses-phase transport, not a generic raw-text transport with a Magick-specific parser layered on top.

Recommended direction:

- assistant messages sent to Codex should use the Responses API message form with `role: "assistant"` and `phase: "commentary" | "final_answer"`
- assistant messages received from Codex should be read from native message/output metadata that includes `phase`
- Magick should no longer infer channels by inspecting assistant text content

### 2. Keep Magick's internal transcript contract, but translate cleanly at the Codex boundary

Magick already has a product and projection model built around:

- `commentary`
- `final`

That app-level contract can remain, but the Codex boundary should map explicitly between internal and external representations.

Recommended mapping:

- internal `commentary` -> Responses API `phase: "commentary"`
- internal `final` -> Responses API `phase: "final_answer"`
- Responses API `phase: "commentary"` -> internal `commentary`
- Responses API `phase: "final_answer"` -> internal `final`

This preserves the existing Magick transcript/UI model while making the Codex wire format natively correct.

### 3. Remove `assistantOutputProtocol.ts`

- Delete `apps/server/src/providers/assistantOutputProtocol.ts`
- Delete its tests
- Remove all imports and call sites from `CodexResponsesClient`

This is the central mechanical goal of the refactor. Once Codex uses native `phase`, Magick should not keep a second custom output protocol alive in parallel.

### 4. Change request serialization to emit native Responses messages

Current behavior:

- assistant history is re-encoded into tagged text through `encodeAssistantOutput(...)`

Target behavior:

- assistant history should be serialized as normal Responses assistant messages with a native `phase` field
- no tagged text transformation should occur

Recommended implementation details:

- update the Codex request payload builder in `CodexResponsesClient` so assistant messages include `phase`
- keep user messages unchanged
- keep tool call and tool result items unchanged
- preserve `phase` on all assistant history items in both `startTurn` and `submitToolResult` continuations

This is the key correctness requirement from the upstream docs: phase must survive follow-up requests.

### 5. Parse native phase from Codex streaming/output items

Current behavior:

- `CodexResponsesClient` parses raw text deltas and runs them through a custom protocol parser to decide whether they belong to `commentary` or `final`

Target behavior:

- `CodexResponsesClient` should inspect the actual Responses stream payloads for message phase metadata and emit provider events directly from that native information

Recommended parser direction:

- identify the response output item / message object that owns each text delta
- capture its stable item/message id and `phase`
- emit:
  - `output.delta` with internal `channel`
  - `output.message.completed` when that message item completes
  - `turn.completed` only once at the actual response terminal event

Important constraint:

- avoid reintroducing any text-content-based framing or parsing heuristics

The parser should care about Responses item structure, not magic strings inside assistant text.

### 6. Model the Codex streaming reducer around response items, not only text deltas

The current reducer is text-first. Native phase support likely needs it to become output-item-first.

Recommended internal model:

- keep a map of active response output items keyed by upstream item/message id
- store per-item metadata such as:
  - upstream id
  - phase
  - current text status
  - whether completion has already been emitted
- route deltas and completion events through that state

Why this is recommended:

- native phase belongs to a message/output item, not to arbitrary text chunks
- stable upstream item ids are a better basis for message grouping than custom local tag state
- duplicate terminal events like `response.completed` plus `[DONE]` become easier to dedupe cleanly

### 7. Make completion handling idempotent and upstream-driven

The review already found a duplicate-completion risk when both `response.completed` and `[DONE]` appear.

As part of this refactor:

- track whether response-level completion has already been emitted
- ignore duplicate terminal markers after the first terminal transition
- track message-level completion per upstream output item so `output.message.completed` is emitted at most once per assistant message

This should be solved as part of the native-item reducer rather than as an isolated patch.

### 8. Simplify the shared assistant prompt

Once native phase support exists in the transport, the prompt should stop telling the model to output literal channel tags.

Recommended prompt changes in `apps/server/src/providers/prompts/default_assistant_instructions.txt`:

- remove all instructions about `<commentary>` / `<final>` wrappers
- remove tag-based examples
- keep the behavioral guidance about when intermediary updates are appropriate and what a final answer should look like
- rewrite the instructions so they describe behavior, not transport encoding

Recommended wording direction:

- preserve the product rules for `commentary` versus `final`
- do not describe the phase transport syntax in the shared assistant prompt unless the model explicitly needs it
- rely on the API `phase` field rather than prompt-enforced text formatting for wire correctness

### 9. Keep provider-facing contracts minimal and generic

The shared provider interfaces in `apps/server/src/providers/providerTypes.ts` should remain application-oriented rather than OpenAI-schema-oriented.

Recommended approach:

- keep `ProviderEvent` and conversation-history types expressed in Magick's internal channel vocabulary
- keep the OpenAI-specific `final_answer` spelling confined to the Codex adapter/client boundary
- avoid leaking Responses-API-specific object shapes across the whole app

This keeps the app architecture cleaner while still using the real upstream syntax where it matters.

### 10. Revisit message-id strategy using upstream item ids where possible

The current Codex adapter invents local message ids such as:

- `${turnId}:assistant:commentary:${n}`
- `${turnId}:assistant:final`

That still works, but native Responses items may expose stable item/message ids that are a better grouping key.

Recommended direction:

- use upstream message/output item ids when available to drive grouping and completion
- only synthesize local ids when the stream does not expose a stable id early enough
- keep the projected transcript ordering stable across tool continuations and replay

The plan does not require changing the user-visible message ids, but it should explicitly evaluate whether upstream ids reduce edge cases.

### 11. Update tests to prove native phase behavior instead of tag parsing

Delete tests that only validate the custom tag parser. Replace them with tests that validate the actual Responses semantics Magick now depends on.

Required test coverage:

- request serialization includes assistant `phase` on follow-up messages
- `commentary` history is preserved and resent on continuation requests
- `final_answer` history is preserved and resent on continuation requests
- streaming assistant deltas are grouped by upstream message/output item phase
- commentary before a tool call and final after tool results still project correctly
- malformed or missing upstream phase is handled deliberately
  - either mapped to a safe fallback with logging
  - or treated as a provider failure
- duplicate terminal events do not emit duplicate `turn.completed`

### 12. Suggested implementation phases

1. Native-transport design phase
- confirm the exact Responses stream payload fields Magick receives on the Codex backend endpoint
- document the mapping between upstream `phase` and internal `channel`

2. Request serialization phase
- stop encoding assistant history into tagged text
- send assistant history with native `phase`
- remove tag-oriented prompt instructions

3. Stream parsing phase
- replace the custom tag parser with a response-item-based native phase reducer
- dedupe terminal events and message completion events

4. Adapter cleanup phase
- simplify `CodexSessionHandle` mapping around native phase/item ids
- remove code that only exists to support text-framing state

5. Cleanup and hardening phase
- delete `assistantOutputProtocol.ts`
- update tests, docs, and plan references
- wipe local DB if needed to avoid compatibility work for the removed tag protocol

## Risks

- The biggest risk is assuming the direct Codex backend endpoint exposes the same phase-rich shape as the public Responses API docs. The first implementation step should verify the real stream payloads Magick receives.
- If the endpoint exposes phase only on completed items and not on early deltas, the reducer may need temporary item buffering before emitting deltas.
- If prompt cleanup happens before native phase parsing is complete, commentary/final behavior could regress in-flight.
- There is a naming mismatch between upstream `final_answer` and Magick's internal `final`. If the mapping is not kept explicit and localized, it can leak confusion across tests and contracts.
- Removing the tag protocol without wiping old local data can leave stale persisted threads in an unreplayable state. The current direction should assume DB reset rather than compatibility.
- Non-Codex providers may later need similar support. The plan should avoid baking Codex-specific assumptions too deeply into shared interfaces.

## Validation

- Add Codex client tests that verify assistant history is serialized with native `phase` instead of tagged text.
- Add Codex stream tests that verify commentary and final-answer output are parsed from native Responses item metadata.
- Add regression tests for follow-up requests preserving `phase` on all assistant history messages.
- Add regression tests for turns with:
  - commentary -> tool call -> commentary -> tool call -> final_answer
  - commentary -> tool call -> failure
  - final_answer-only response
- Add regression tests for duplicate terminal signals (`response.completed` plus `[DONE]`).
- Remove or rewrite tests that depend on `assistantOutputProtocol.ts`.
- Run repository validation before considering the refactor complete:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`
  - `bun knip`
  - `bun run test`

## Completion Criteria

- Codex no longer depends on a custom tagged-text assistant output protocol.
- `apps/server/src/providers/assistantOutputProtocol.ts` and its tests are removed.
- Assistant history is sent to Codex using native Responses API `phase` metadata.
- Codex streaming output is parsed from native Responses item/message phase data instead of assistant text content.
- Magick still persists and renders assistant transcript messages as `commentary` or `final` internally.
- Follow-up requests preserve assistant phase semantics across turns, matching the documented Responses API requirement for `gpt-5.3-codex` and later.
- Duplicate terminal markers do not emit duplicate completion events.
- All required validation commands pass.
