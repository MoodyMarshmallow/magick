## Summary

Replace the current thread/workspace conversation-history model with a single global **Context Tree** and five large, deep backend **Modules**:

- **Context Core**
- **Assistant Turn Engine**
- **Provider Runtime**
- **Tool Runtime**
- **Agent Transport**

The **Context Tree** stores only the durable information needed to rebuild provider API payloads, regenerate frontend branch history, and preserve minimal debugging context. User-facing "threads" become **Bookmarks**: named pointers to nodes in the tree. Selecting a bookmark displays the **Branch** from the prompt **Trunk** to that bookmark's target node.

This refactor should replace legacy naming throughout the server, shared contracts, and frontend. Temporary compatibility should be minimized and only used where avoiding it would cause disproportionate churn.

## Motivation

The current model stores conversation history as append-only thread events and projected thread snapshots. Payload construction then rebuilds history from those events, with snapshot-based fallbacks. This creates multiple overlapping representations of the same conversation state.

The target model makes payload-oriented history the canonical storage format:

- The **Context Tree** is the source of truth.
- A **Branch** is reconstructed by walking parent links from a selected node back to the **Trunk**.
- Provider payloads are built from the same branch walk used to regenerate frontend history.
- **Bookmarks** replace user-visible threads without preserving the old thread mental model.
- Large backend **Modules** keep repairable seams around the places behavior should change.

The important architecture move is not only renaming `threads` to `bookmarks`; it is replacing many shallow modules with a few deep **Modules** that provide leverage through small interfaces.

## Scope

In scope:

- Replace `apps/server/src/ai/agent/threads/` with the new module layout described below.
- Replace thread event history and thread snapshots for conversation history with context-tree storage.
- Introduce bookmarks as named pointers into the context tree.
- Rename shared contracts from thread terminology to conversation/branch/bookmark terminology.
- Update WebSocket command names away from `thread.*`.
- Update frontend naming to bookmarks/branches with no or extremely minimal logic changes.
- Preserve existing assistant/provider behavior while changing storage and naming.
- Preserve the ability to stream assistant output and tool activity to the frontend.

Out of scope for the first refactor:

- Prompt versioning.
- Multi-workspace support as a conversation-history concept.
- Advanced branch UI such as visual tree navigation.
- Garbage-collecting non-leaf branch history beyond explicit bookmark deletion rules.
- Provider-side server session resume as the canonical history mechanism.
- Broad frontend redesign.

## Clarifications

### Q: Should there be one placeholder thread per workspace?

A: No. Multi-workspace support should also be removed for now as a conversation-history concept. There should be a single app-level context tree.

### Q: What is the new canonical top-level domain object?

A: **Conversation** was accepted as a useful product term, but the storage architecture should use precise terms: **Context Tree** for the single global canonical tree, **Branch** for a path through it, and **Bookmark** for a named pointer to a node.

### Q: What should a context tree node contain?

A: A node should contain just enough information to build provider API payloads, regenerate frontend conversation history, and preserve minimal debugging context. It should not store unrelated lifecycle or UI state.

### Q: Should the tree replace all current conversation history storage options?

A: Yes. The context tree should replace both full thread event history and thread snapshots as the canonical conversation-history store.

### Q: Should the data model allow multiple children per node?

A: Yes. Branching should be supported in the data model from day one.

### Q: Should global/system prompts be versioned?

A: No. Versioning is unnecessary at this stage, and users may expect global prompt changes to affect future behavior everywhere immediately.

### Q: Should global/system prompts live outside the tree?

A: No. They should remain as the root/trunk of the single context tree because the trunk naturally participates in payload construction.

### Q: How should prompt changes be stored?

A: Mutate the existing trunk prompt nodes in place. Do not create prompt versions or historical prompt branches.

### Q: Are all leaf nodes head pointers?

A: No. The corrected model is bookmark-based: a bookmark points to a specific node, usually a branch head. The active bookmark determines which branch the frontend is displaying and appending to.

### Q: What is a bookmark?

A: A **Bookmark** is a named pointer to a specific context node. It is not itself the branch and not itself the conversation.

### Q: What is a branch?

A: A **Branch** is the path through the context tree from the trunk to a selected node.

### Q: What happens when the frontend selects a bookmark?

A: The bookmark becomes active, and the frontend displays the branch from the trunk to the bookmark's target node. Selection is navigational and should not mutate the tree.

### Q: What happens when the frontend creates a bookmark?

A: A new bookmark is created pointing immediately after the global prompt trunk, and it becomes active.

### Q: Should creating a bookmark make it active?

A: Yes.

### Q: Should the app restore the last active bookmark on startup?

A: No. Startup should bring the user to the bookmark menu with no active bookmark.

### Q: Is "no active bookmark" a valid state?

A: Yes. It should show the bookmark selection page. Payload construction requires an active or explicitly selected bookmark.

### Q: What happens when deleting the active bookmark?

A: The app should have no active bookmark afterward, returning the user to the bookmark selection page.

### Q: What happens when deleting a bookmark whose target is a leaf node?

A: Delete backward from that leaf until reaching either the prompt trunk or a node that still has another child after the deletion.

### Q: What happens when deleting a bookmark whose target is not a leaf node?

A: Delete only the bookmark pointer and do not delete any context nodes.

### Q: Should bookmark operations be stored in the context tree?

A: No. Bookmark create, rename, select, and delete operations are navigation/pointer operations and should live outside the tree.

### Q: Should bookmarks auto-advance?

A: Yes. When user or assistant actions append to a bookmark's branch, the bookmark should advance to the newest durable node on that branch.

### Q: How should assistant turns append to the tree?

A: All actions taken by the assistant during a turn append sequentially to the current active branch. Tool calls do not create branches.

### Q: How should streaming assistant text be stored?

A: One mutable **Assistant Message Node** should accumulate streamed content until completion. Individual deltas should not become tree nodes.

### Q: What happens if tool calls are emitted during assistant deltas?

A: Tool calls should be appended immediately after the assistant message stream ends. The assistant message itself remains a single node.

### Q: If the assistant requests multiple tool calls in one provider step, how should they be stored?

A: Store them as a sequential chain in provider order.

### Q: How should tool results be ordered?

A: Store tool results immediately after their corresponding tool calls in original provider order, even if execution timing differs.

### Q: How should failed tools be represented?

A: Store a failed tool as a **Tool Result Node** on the same branch, with model-facing failure output and minimal debug metadata.

### Q: Can a tool call attach directly after a user message?

A: Yes. If there is no assistant text, do not invent an empty assistant message node. The context tree should strictly reflect user and assistant actions.

### Q: What actions become context nodes?

A: User messages, assistant messages, assistant tool calls, tool results, and system/global prompt trunk items.

### Q: What should not become context nodes?

A: Turn started/completed markers, bookmark selection, bookmark metadata changes, transport state, debug logs, UI state, and other runtime bookkeeping.

### Q: Where should the refactor live in the codebase?

A: The refactor should disregard the current layout where useful and organize the backend around the five deep Modules: **Context Core**, **Assistant Turn Engine**, **Provider Runtime**, **Tool Runtime**, and **Agent Transport**.

### Q: Should legacy thread names remain internally for compatibility?

A: No. Refactor legacy names throughout the codebase to keep the model cohesive. Any compatibility should be narrow and temporary.

### Q: Should shared WebSocket protocol names move away from `thread.*`?

A: Yes. Since the frontend is in the same repo, update server, contracts, and frontend together.

### Q: How should shared names distinguish bookmarks and branches?

A: Use **Bookmark** for pointer/list/menu operations. Use **Branch** for the displayed conversation path reconstructed from a bookmark target.

### Q: What should replace `ThreadViewModel` and `ThreadSummary`?

A: `ThreadViewModel` should become `BranchViewModel`. `ThreadSummary` should become `BookmarkSummary`.

## Repairable Backend Modules

The refactor should prefer a small number of large, deep **Modules** over many shallow services. The **Interface** of each Module should be the test surface. Internal helpers may exist, but callers should not reach past the Module Interface to repositories, path walkers, serializers, or provider-specific adapters.

Target layout:

```text
apps/server/src/ai/agent/
  context-core/
    contextCore.ts
    internal/
    persistence/
    test-support/

  assistant-turn-engine/
    assistantTurnEngine.ts
    internal/
    test-support/

  provider-runtime/
    providerRuntime.ts
    codex/
    fake/
    test-support/

  tool-runtime/
    toolRuntime.ts
    builtins/
    test-support/

  transport/
    agentTransport.ts
    connectionRegistry.ts
```

### 1. Context Core

**Context Core** owns all durable context semantics.

External rule:

- Only **Context Core** may mutate **Context Nodes** or move **Bookmark** targets.

It owns:

- Trunk initialization
- Trunk prompt mutation in place
- Context Node append/update rules
- Assistant Message Node streaming mutation rules
- Branch path walking
- Bookmark create/select/rename/delete
- Bookmark auto-advance
- Leaf-only bookmark pruning
- Branch View Model derivation
- Provider payload derivation
- Node integrity checks and repair helpers

It hides:

- Conversation node repositories
- Bookmark repositories
- Branch path walker
- Payload serializer
- Branch view projector
- Pruning algorithm
- Database transaction shape

Its Interface should be high-level and behavior-oriented, for example:

```ts
ContextCore.bootstrap()
ContextCore.listBookmarks()
ContextCore.createBookmark(input)
ContextCore.selectBookmark(input)
ContextCore.renameBookmark(input)
ContextCore.deleteBookmark(input)
ContextCore.appendUserMessage(input)
ContextCore.beginAssistantMessage(input)
ContextCore.appendAssistantDelta(input)
ContextCore.completeAssistantMessage(input)
ContextCore.appendToolCall(input)
ContextCore.appendToolResult(input)
ContextCore.buildBranchView(input)
ContextCore.buildProviderPayload(input)
```

Required transaction invariants:

- Append node + advance Bookmark is one transaction.
- Delete Bookmark + optional prune is one transaction.
- Assistant Message Node mutation is guarded by node kind and status.
- Tool Call Node + Tool Result Node ordering is deterministic and provider-facing.
- Trunk nodes cannot be pruned.

Required data invariants:

- Every non-root node has an existing parent.
- Bookmark targets reference existing nodes.
- New bookmarks point to the trunk tail.
- Branch walks stop at the trunk/root sentinel.
- Context Nodes are canonical durable history.
- Branch View Models and provider payloads are derived, not persisted snapshots.

### 2. Assistant Turn Engine

**Assistant Turn Engine** owns one assistant run from user input through final output.

It coordinates:

- User message submission
- Provider payload requests through **Context Core**
- Provider stream consumption through **Provider Runtime**
- Assistant Message Node streaming through **Context Core**
- Tool call buffering while assistant text is streaming
- Tool execution through **Tool Runtime**
- Tool result append through **Context Core**
- Continuation after tool results
- Interruption and failure handling

It does not own:

- Context Tree mutation rules
- Bookmark pruning
- Provider wire payload shape
- Tool implementation details
- WebSocket delivery

Its Interface should be small, for example:

```ts
AssistantTurnEngine.sendMessage(input)
AssistantTurnEngine.stopTurn(input)
AssistantTurnEngine.retryTurn(input)
```

Repairability goal:

- Turn sequencing bugs live here.
- Tree integrity bugs live in **Context Core**.
- Provider quirks live in **Provider Runtime**.
- Tool quirks live in **Tool Runtime**.

### 3. Provider Runtime

**Provider Runtime** owns provider auth, provider sessions, provider stream normalization, and provider wire adapters.

It owns:

- Provider authentication access and refresh
- Provider Session creation/resume/disposal when needed
- Provider-specific request serialization
- Provider-specific SSE/event parsing
- Provider event normalization into provider-neutral output events
- Provider interruption
- Title generation if retained
- Provider failure mapping

It does not own:

- Context Tree concepts
- Bookmark concepts
- Branch View Models
- Tool execution
- WebSocket delivery

Its Interface should accept provider-neutral payloads built by **Context Core** and return provider-neutral stream events consumed by **Assistant Turn Engine**.

Example Interface shape:

```ts
ProviderRuntime.startTurn(input)
ProviderRuntime.continueTurn(input)
ProviderRuntime.interruptTurn(input)
ProviderRuntime.generateTitle(input)
ProviderRuntime.readAuthState(input)
```

Providers should not know whether history came from a Branch, a snapshot, or a test fixture. They should only know provider-neutral history items, instructions, tools, and cancellation.

### 4. Tool Runtime

**Tool Runtime** owns tool execution as seen by the assistant turn.

It owns:

- Tool catalog listing for provider payloads
- Tool input schema validation
- Tool permission checks
- Tool execution context construction
- Document/workspace/web dependencies used by tools
- Read-file tracking
- Tool result serialization
- Failed tool model-output formatting
- Multi-tool provider-order preservation

It does not own:

- Context Tree mutation
- Bookmark advancement
- Provider stream parsing
- WebSocket delivery

Its Interface should let **Assistant Turn Engine** request provider-order execution without knowing tool internals:

```ts
ToolRuntime.listProviderTools()
ToolRuntime.executeToolCalls(input)
```

Tool results should be returned in original provider order, not completion order. Concurrent execution can be an internal implementation detail later.

### 5. Agent Transport

**Agent Transport** owns WebSocket protocol mechanics.

It owns:

- WebSocket envelopes
- Command parsing and validation
- Connection registry
- Subscription/push mechanics
- Transport error serialization
- Mapping application outcomes into contract responses

It does not own:

- Bookmark lifecycle rules
- Context Tree mutation
- Assistant turn sequencing
- Provider behavior
- Tool behavior

It should call **Context Core** for bookmark/branch operations and **Assistant Turn Engine** for run operations.

Expected protocol names:

- `app.bootstrap`
- `bookmark.list`
- `bookmark.create`
- `bookmark.select`
- `bookmark.rename`
- `bookmark.delete`
- `bookmark.sendMessage`
- `bookmark.stopTurn`
- `bookmark.retryTurn`
- `bookmark.resume` if branch update replay remains necessary

## Proposed Changes

### 1. Shared Language And Contracts

Update `packages/contracts/src/chat.ts` around the new vocabulary.

Likely replacements:

- `ThreadViewModel` -> `BranchViewModel`
- `ThreadSummary` -> `BookmarkSummary`
- `threadId` -> `bookmarkId` at bookmark command boundaries
- `messages` remains acceptable for frontend display if it represents user/assistant text only
- `toolActivities` may become derived branch display data, not canonical storage language
- `ThreadRuntimeState` -> branch or bookmark runtime state, depending on final ownership
- `ThreadResolutionState` should likely be removed unless bookmarks still need an archived/resolved state
- `DomainEvent` should be removed or replaced with context node types if no longer used for conversation history

Rename WebSocket commands:

- `thread.list` -> `bookmark.list`
- `thread.create` -> `bookmark.create`
- `thread.open` -> `bookmark.select`
- `thread.rename` -> `bookmark.rename`
- `thread.delete` -> `bookmark.delete`
- `thread.sendMessage` -> `bookmark.sendMessage`
- `thread.stopTurn` -> `bookmark.stopTurn`
- `thread.retryTurn` -> `bookmark.retryTurn`
- `thread.resume` -> `bookmark.resume`
- `tool.approval.respond` should use `bookmarkId` if approvals remain bookmark-scoped

### 2. Persistence Model

Persistence should be internal to **Context Core**. Do not expose repositories as application-level seams.

Replace thread events and thread snapshots with tables or records for:

- context nodes
- bookmarks
- trunk metadata if needed
- branch update notifications if WebSocket resume needs replay

Minimum context node fields:

- `id`
- `parent_id`
- `kind`
- `created_at`
- `updated_at`
- deterministic sibling order or monotonic `created_sequence`
- provider-visible payload content by kind
- minimal status/debug metadata by kind

Likely node kinds:

- `root`
- `system_prompt`
- `global_prompt`
- `user_message`
- `assistant_message`
- `tool_call`
- `tool_result`

Minimum bookmark fields:

- `id`
- `title`
- `target_node_id`
- `created_at`
- `updated_at`

Prompt trunk rules:

- Initialize root/trunk nodes if absent.
- Define a stable trunk tail node.
- New bookmarks point to the trunk tail.
- Mutate prompt node content in place when global/system prompts change.
- Bookmark deletion must never prune trunk nodes.

### 3. Branch View Reconstruction

Branch View reconstruction is an internal behavior of **Context Core**, not a separately exposed persistence snapshot.

Flow:

1. Resolve bookmark.
2. Walk parent links from target node to trunk/root.
3. Reverse into chronological order.
4. Convert user/assistant/tool nodes into frontend display models.
5. Return `BranchViewModel` with embedded `bookmarkId`, `headNodeId`, runtime state, visible messages, visible tool activities, and minimal error/debug state.

The branch view should not be separately persisted in the first version.

### 4. Provider Payload Building

Provider payload building is an internal behavior of **Context Core**. Provider-specific wire serialization is owned by **Provider Runtime**.

Payload construction flow:

1. Resolve bookmark.
2. Walk from `bookmark.targetNodeId` through parent links to the root/trunk.
3. Reverse the path into chronological order.
4. Convert provider-visible nodes into provider-neutral payload items.
5. Return payload items and prompt/instruction content to **Assistant Turn Engine**.
6. **Assistant Turn Engine** passes that provider-neutral payload to **Provider Runtime**.

Serialization rules:

- `system_prompt` / `global_prompt` nodes become instruction/prompt context according to provider requirements.
- `user_message` nodes become user message items.
- `assistant_message` nodes become assistant message items.
- `tool_call` nodes become function-call/tool-call items.
- `tool_result` nodes become function-call-output/tool-result items.
- Failed tool results still serialize as tool outputs with model-facing failure text.
- Streaming assistant nodes should be included in Branch Views, but not in provider payloads unless the design explicitly needs partial-history continuation.

### 5. Assistant Turn Flow

Fresh user message flow:

1. **Agent Transport** receives `bookmark.sendMessage`.
2. **Agent Transport** calls **Assistant Turn Engine**.
3. **Assistant Turn Engine** asks **Context Core** to append a `user_message` node and advance the bookmark atomically.
4. **Assistant Turn Engine** asks **Context Core** to build provider-neutral payload history.
5. **Assistant Turn Engine** asks **Tool Runtime** for provider tool definitions.
6. **Assistant Turn Engine** asks **Provider Runtime** to stream provider output.
7. **Assistant Turn Engine** appends assistant/tool nodes through **Context Core** as durable output resolves.
8. **Agent Transport** publishes Branch updates generated from **Context Core** state.

Assistant message streaming flow:

1. **Assistant Turn Engine** asks **Context Core** to create or update one `assistant_message` node for one assistant output item.
2. Deltas accumulate into that node.
3. Completion marks that node terminal.
4. Tool calls buffered during assistant text are appended only after the assistant node reaches terminal status.

Tool flow:

1. **Provider Runtime** emits provider-neutral tool call requests.
2. **Assistant Turn Engine** buffers and orders them.
3. **Assistant Turn Engine** asks **Context Core** to append `tool_call` nodes in provider order.
4. **Assistant Turn Engine** asks **Tool Runtime** to execute calls.
5. **Tool Runtime** returns model-facing outputs in provider order.
6. **Assistant Turn Engine** asks **Context Core** to append `tool_result` nodes immediately after corresponding calls.
7. **Assistant Turn Engine** continues with **Provider Runtime** if required.

### 6. Bookmark Lifecycle

Bookmark lifecycle is owned by **Context Core** and exposed through **Agent Transport** commands.

Bookmark create:

- Create a bookmark pointing to the trunk tail.
- Mark it active for the current frontend session.
- Return the new branch view.

Bookmark select:

- Mark bookmark active for the current frontend session.
- Return branch view.
- Do not mutate tree nodes.

Bookmark rename:

- Update bookmark metadata only.
- Do not mutate tree nodes.

Bookmark delete:

- If deleting the active bookmark, clear active bookmark for the current frontend session.
- If target node is not a leaf, delete bookmark only.
- If target node is a leaf, delete bookmark and prune upward until reaching the trunk or a node with remaining children.
- Do not delete trunk nodes.

App bootstrap:

- Return bookmark list/menu state.
- Return no active bookmark by default on startup.

Active bookmark ownership:

- Prefer frontend/connection state over persisted singleton state.
- Server commands should accept explicit `bookmarkId` where possible.
- Startup should not restore a persisted active bookmark.

### 7. Runtime Notifications

Context Nodes are canonical durable history. Runtime/transport events are not canonical history.

If WebSocket resume still needs ordering, add a separate branch update sequence or notification outbox. Do not overload Context Node order as a general runtime event sequence, and do not recreate the old `DomainEvent` model under a new name.

### 8. Frontend Changes

Frontend changes should be mostly naming and contract alignment.

Likely replacements:

- chat/thread client names -> bookmark/branch client names
- `activeThread` -> `activeBranch`
- `threadSummaries` -> `bookmarkSummaries`
- `ThreadViewModel` -> `BranchViewModel`
- `ThreadSummary` -> `BookmarkSummary`
- `threadId` -> `bookmarkId` in UI operations

Avoid deeper UI behavior changes except:

- startup should show bookmark menu with no active bookmark
- deleting active bookmark should return to bookmark menu
- creating/selecting bookmark should show its branch

## Implementation Order

Use the `tdd` skill for this refactor because it is non-trivial.

Recommended order:

1. Introduce shared contract types for **Branch**, **Bookmark**, and provider-neutral payload items.
2. Build **Context Core** behind its deep Interface with in-memory tests first.
3. Add **Context Core** persistence adapters and transaction tests.
4. Add Branch View reconstruction tests at the **Context Core** Interface.
5. Add provider payload derivation tests at the **Context Core** Interface.
6. Build **Tool Runtime** around tool catalog, validation, execution, ordering, and model-facing outputs.
7. Build **Provider Runtime** around provider-neutral payloads and provider-neutral stream events.
8. Build **Assistant Turn Engine** against **Context Core**, **Tool Runtime**, and **Provider Runtime**.
9. Rework **Agent Transport** commands to use bookmark/branch terminology.
10. Update frontend naming and minimal behavior changes.
11. Delete `apps/server/src/ai/agent/threads/` after references are migrated.

## Tests

Test through the five Module Interfaces rather than internal helpers.

**Context Core** tests:

- trunk initialization
- prompt mutation in place
- new bookmark starts at trunk tail
- app bootstrap returns no active bookmark
- selecting bookmark reconstructs branch without mutation
- creating bookmark activates it for the session
- deleting active bookmark leaves no active bookmark
- deleting leaf bookmark prunes only unreachable branch suffix
- deleting non-leaf bookmark does not delete nodes
- append node + advance bookmark is atomic
- payload walk from bookmark includes trunk plus branch nodes in order
- Branch View Model is rebuilt from nodes, not snapshots

**Assistant Turn Engine** tests:

- user message appends before provider call
- assistant text deltas accumulate into one node
- tool calls emitted during assistant text append after the message node
- multiple tool calls/results persist in provider order
- failed tool result is included in branch and provider payload history
- interruption leaves the branch in a recoverable state

**Provider Runtime** tests:

- provider-neutral payload maps to Codex request shape
- provider stream maps to provider-neutral events
- auth failures map to provider-neutral failures
- interruption aborts active provider work

**Tool Runtime** tests:

- tool schemas validate inputs
- permission failures return model-facing failures
- successful tools return model-facing outputs
- failed tools return model-facing failure outputs
- results preserve provider order

**Agent Transport** tests:

- `bookmark.*` commands route to the correct Module
- transport errors serialize consistently
- subscriptions receive Branch updates
- bootstrap returns bookmark menu state with no active branch

## Risks

- This is a broad naming and storage refactor touching server, contracts, and frontend simultaneously.
- A shallow rename from threads to bookmarks would preserve current repairability problems.
- Removing snapshots may reveal places that relied on cheap persisted projections.
- Branch reconstruction from parent links needs careful ordering and performance attention.
- Streaming assistant output needs clear mutation semantics for a node that is not complete yet.
- Bookmark pruning can be destructive if leaf detection or trunk boundary detection is wrong.
- WebSocket resume semantics may need a replacement for `latestSequence` if branch updates no longer use thread event sequences.
- Frontend minimal-logic-change may conflict with startup/no-active-bookmark behavior.
- Tool-call buffering must preserve provider contract ordering under all stream shapes.

## Validation

Required repo checks before completion:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun knip`
- `bun run test` for relevant suites or full test run if practical

Additional validation:

- Exercise the app bootstrap flow and verify it lands on the bookmark menu.
- Create a bookmark and verify it displays an empty branch after the trunk.
- Send a message and verify the bookmark advances.
- Run an assistant turn with tool calls and verify the displayed branch order matches the tree order.
- Delete a leaf bookmark and verify pruning stops at trunk or a branching ancestor.
- Delete an active bookmark and verify no active branch remains.
- Verify payload logs/debug output show branch-walk-derived input rather than event-derived history.

## Completion Criteria

- `threads/` is removed or no longer owns active conversation logic.
- **Context Core** owns Context Tree, Bookmarks, Branch reconstruction, payload history, and pruning.
- **Assistant Turn Engine** owns assistant turn sequencing and uses **Context Core** for all durable mutations.
- **Provider Runtime** owns provider auth/session/wire behavior and does not know tree/bookmark concepts.
- **Tool Runtime** owns tool execution, validation, ordering, and model-facing outputs.
- **Agent Transport** owns protocol mechanics and does not own conversation rules.
- Thread terminology is removed from internal server code except narrow migration/compatibility leftovers explicitly documented.
- Shared contracts use conversation/branch/bookmark terminology.
- Frontend uses bookmark/branch naming and still follows the existing UI logic shape where possible.
- Conversation history is stored canonically as tree nodes, not thread events or thread snapshots.
- Payloads are built by walking from a bookmark target node back to the trunk.
- Branch views are rebuilt from the tree, not from persisted snapshots.
- Bookmark lifecycle semantics match the resolved Q&A.
- Tests cover the five Module Interfaces and the new tree, bookmark, payload, streaming, tool, pruning, and transport behavior.
- All required repo checks pass.
