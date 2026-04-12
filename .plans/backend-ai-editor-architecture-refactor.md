## Summary

Refactor `apps/server/src` from its current layer-first layout into a capability-first layout with two primary product domains:

- `ai/` for agent, provider, thread, tool, and auth logic
- `editor/` for workspace and document logic backing the markdown editor

The root of `apps/server/src` should remain intentionally small and limited to backend bootstrapping and composition. The goal is to make ownership clearer, reduce mixed-boundary modules, and create a more obvious dependency rule: AI code may consume editor capabilities, but editor code must not depend on AI code.

This refactor should stay behavior-preserving. The primary objective is architectural clarity, not feature changes. Small boundary extractions are encouraged where they materially improve ownership, but this plan should avoid turning a directory reorganization into a broad product redesign.

## Motivation

The current backend structure is functional, but it is organized mostly by implementation layer rather than by product capability. That creates several clarity problems:

- `application/`, `providers/`, `tools/`, `persistence/`, and `transport/` spread one AI feature across many directories.
- `application/threadOrchestrator.ts` is the architectural center of the backend, but its ownership is obscured by the generic `application/` directory name.
- `application/providerAuthService.ts` sounds provider-agnostic, but it is effectively Codex auth logic.
- `tools/workspaceAccessService.ts` mixes editor-like file and workspace behavior with agent-tool-facing concerns.
- `index.ts` is a large composition root that wires together auth, providers, thread orchestration, transport, tools, and workspace access all in one place.

The result is that a contributor trying to answer a simple question like "where does AI thread state live?" or "where is document editing logic?" has to jump across multiple top-level folders.

The proposed `ai/` and `editor/` split matches the product more closely:

- the AI assistant is one major backend capability
- the local document/workspace editor is the other major backend capability

That makes the directory tree easier to navigate and gives future refactors a clearer home.

## Scope

This plan covers:

- reorganizing `apps/server/src` into `ai/` and `editor/`
- moving existing files into clearer capability-owned locations
- refining boundaries so editor workspace/document services sit under `editor/`
- moving provider auth under `ai/auth/`
- grouping AI thread, provider, tool, and transport code under `ai/agent/`
- reducing the size and responsibility of the root composition layer
- updating imports, tests, and composition code to match the new structure

This plan should include the following source areas:

- `apps/server/src/application/`
- `apps/server/src/core/`
- `apps/server/src/persistence/`
- `apps/server/src/projections/`
- `apps/server/src/providers/`
- `apps/server/src/tools/`
- `apps/server/src/transport/`
- `apps/server/src/index.ts`
- `apps/server/src/main.ts`

This plan does not cover:

- changing backend behavior, websocket contracts, or provider protocols unless needed to complete the move cleanly
- redesigning the thread domain model
- redesigning the auth model beyond moving it behind clearer boundaries
- major decomposition of `ThreadOrchestrator` into many smaller services unless a small extraction is needed to break a dependency tangle
- introducing a new persistence model or database schema changes unrelated to file moves
- changing the web or desktop app architecture beyond whatever import updates tests require

## Proposed Changes

### 1. Adopt a capability-first target layout

The target structure should make the main product domains immediately visible from `apps/server/src`.

Recommended target layout:

```text
apps/server/src/
  main.ts
  index.ts
  ai/
    auth/
      providerAuthService.ts
      providerAuthRepository.ts
      codex/
        codexAuthClient.ts
        codexOAuth.ts
        codexJwt.ts
    agent/
      runtime/
        runtime.ts
        errors.ts
      transport/
        wsServer.ts
        connectionRegistry.ts
      providers/
        providerRegistry.ts
        providerTypes.ts
        providerPrompts.ts
        codex/
          codexProviderAdapter.ts
          codexResponsesClient.ts
        fake/
          fakeProviderAdapter.ts
      threads/
        threadOrchestrator.ts
        replayService.ts
        threadProjector.ts
        eventStore.ts
        threadRepository.ts
        providerSessionRepository.ts
      tools/
        toolExecutor.ts
        toolRegistry.ts
        toolPermissionService.ts
        toolResultSerializer.ts
        toolContextBuilder.ts
        toolTypes.ts
        webContentService.ts
        builtins/
          applyPatchTool.ts
          fetchTool.ts
          globTool.ts
          grepTool.ts
          listTool.ts
          readTool.ts
          writeTool.ts
  editor/
    workspace/
      workspacePathPolicy.ts
      pathPresentationPolicy.ts
      workspaceQueryService.ts
    documents/
      documentService.ts
      fileDiffPreview.ts
```

Key design rule:

- `ai/` may depend on `editor/`
- `editor/` must not depend on `ai/`
- root files should only compose subsystems, not implement domain behavior

### 2. Preserve a very small root layer

`apps/server/src/main.ts` and `apps/server/src/index.ts` should remain at the root because they are process and composition entrypoints, not domain-owned logic.

Recommended root responsibilities:

- `main.ts`
  - host/port resolution
  - process startup and shutdown
- `index.ts`
  - create database
  - create editor services
  - create AI services
  - wire transport to the composed services

Recommended cleanup in `index.ts`:

- extract `createEditorServices(...)`
- extract `createAiServices(...)`
- keep the returned `BackendServices` shape stable where possible
- remove inline fake-provider responder setup from the main composition function if it can be moved into a dedicated dev/test helper

The main goal is that `index.ts` stops being the only place where the architecture is understandable.

### 3. Move auth into `ai/auth/`

Auth is conceptually part of the AI provider boundary, not a generic application concern.

Recommended moves:

- `application/providerAuthService.ts` -> `ai/auth/providerAuthService.ts`
- `persistence/providerAuthRepository.ts` -> `ai/auth/providerAuthRepository.ts`
- `providers/codex/codexAuthClient.ts` -> `ai/auth/codex/codexAuthClient.ts`
- `providers/codex/codexOAuth.ts` -> `ai/auth/codex/codexOAuth.ts`
- `providers/codex/codexJwt.ts` -> `ai/auth/codex/codexJwt.ts`

Recommended cleanup while moving:

- keep the current public API of `ProviderAuthService` stable during the move
- update imports so auth code no longer looks like it lives under generic application or provider directories
- keep the Codex-specific implementation details under `ai/auth/codex/` so future provider auth work has an obvious extension point

This move should happen early because it is relatively self-contained and it simplifies the later provider and composition work.

### 4. Group AI runtime, providers, threads, tools, and transport under `ai/agent/`

The current AI backend flow spans many top-level folders. The refactor should regroup it into a single subtree.

Recommended moves:

- `core/runtime.ts` -> `ai/agent/runtime/runtime.ts`
- `core/errors.ts` -> `ai/agent/runtime/errors.ts`
- `application/providerRegistry.ts` -> `ai/agent/providers/providerRegistry.ts`
- `providers/providerTypes.ts` -> `ai/agent/providers/providerTypes.ts`
- `providers/providerPrompts.ts` -> `ai/agent/providers/providerPrompts.ts`
- `providers/codex/codexProviderAdapter.ts` -> `ai/agent/providers/codex/codexProviderAdapter.ts`
- `providers/codex/codexResponsesClient.ts` -> `ai/agent/providers/codex/codexResponsesClient.ts`
- `providers/fake/fakeProviderAdapter.ts` -> `ai/agent/providers/fake/fakeProviderAdapter.ts`
- `application/threadOrchestrator.ts` -> `ai/agent/threads/threadOrchestrator.ts`
- `application/replayService.ts` -> `ai/agent/threads/replayService.ts`
- `projections/threadProjector.ts` -> `ai/agent/threads/threadProjector.ts`
- `persistence/eventStore.ts` -> `ai/agent/threads/eventStore.ts`
- `persistence/threadRepository.ts` -> `ai/agent/threads/threadRepository.ts`
- `persistence/providerSessionRepository.ts` -> `ai/agent/threads/providerSessionRepository.ts`
- `tools/toolExecutor.ts` -> `ai/agent/tools/toolExecutor.ts`
- `tools/toolRegistry.ts` -> `ai/agent/tools/toolRegistry.ts`
- `tools/toolPermissionService.ts` -> `ai/agent/tools/toolPermissionService.ts`
- `tools/toolResultSerializer.ts` -> `ai/agent/tools/toolResultSerializer.ts`
- `tools/toolContextBuilder.ts` -> `ai/agent/tools/toolContextBuilder.ts`
- `tools/toolTypes.ts` -> `ai/agent/tools/toolTypes.ts`
- `tools/webContentService.ts` -> `ai/agent/tools/webContentService.ts`
- `transport/wsServer.ts` -> `ai/agent/transport/wsServer.ts`
- `transport/connectionRegistry.ts` -> `ai/agent/transport/connectionRegistry.ts`

This reorganization should make it possible to navigate the full AI request path without leaving `ai/agent/`:

- transport receives command
- thread orchestration runs turn
- provider executes model interaction
- tools run when requested
- events persist and project thread state

### 5. Move editor-facing workspace and document logic under `editor/`

The most important boundary extraction in this refactor is separating editor-owned file and workspace logic from agent-owned tool orchestration.

Recommended moves and splits:

- `tools/workspacePathPolicy.ts` -> `editor/workspace/workspacePathPolicy.ts`
- `tools/pathPresentationPolicy.ts` -> `editor/workspace/pathPresentationPolicy.ts`
- `tools/fileDiffPreview.ts` -> `editor/documents/fileDiffPreview.ts`

Recommended service split for `tools/workspaceAccessService.ts`:

- replace it with `editor/documents/documentService.ts` for:
  - read
  - write
  - exists
  - file title/path presentation helpers if still needed there
- add `editor/workspace/workspaceQueryService.ts` for:
  - list tree
  - glob
  - grep
  - path-scoped traversal helpers

Recommended dependency shape after the split:

- built-in agent tools call `DocumentService` and `WorkspaceQueryService`
- editor services own workspace sandboxing and path presentation policies
- AI tool code no longer owns the editor filesystem abstraction directly

This is the one place where light functional extraction is worth doing during the reorg, because simply moving `WorkspaceAccessService` wholesale would preserve an already-mixed boundary.

### 6. Keep agent tools in `ai/agent/tools/`, but make them depend on editor services

The built-in tools are part of the agent runtime, not part of the editor itself. Their implementations should stay under `ai/agent/tools/` even when they operate on editor-owned services.

Recommended tool ownership:

- `ai/agent/tools/builtins/readTool.ts`
  - depends on `editor/documents/documentService.ts`
- `ai/agent/tools/builtins/writeTool.ts`
  - depends on `editor/documents/documentService.ts`
- `ai/agent/tools/builtins/applyPatchTool.ts`
  - depends on document service plus diff preview helpers
- `ai/agent/tools/builtins/listTool.ts`
  - depends on `editor/workspace/workspaceQueryService.ts`
- `ai/agent/tools/builtins/globTool.ts`
  - depends on `editor/workspace/workspaceQueryService.ts`
- `ai/agent/tools/builtins/grepTool.ts`
  - depends on `editor/workspace/workspaceQueryService.ts`
- `ai/agent/tools/builtins/fetchTool.ts`
  - depends on `ai/agent/tools/webContentService.ts`

This preserves a clean product boundary:

- editor services own the local workspace
- agent tools are just one consumer of those services

### 7. Keep transport with the AI command surface for now

The current websocket command server is primarily concerned with AI-thread workflows, provider auth, replay, and thread lifecycle. For this refactor, it is reasonable to keep transport under the AI subtree rather than create a third major product domain.

Recommended move:

- `transport/wsServer.ts` -> `ai/agent/transport/wsServer.ts`
- `transport/connectionRegistry.ts` -> `ai/agent/transport/connectionRegistry.ts`

Recommended cleanup while moving:

- leave command and response shapes unchanged
- keep `WebSocketCommandServer` behavior stable
- consider a small internal extraction of command handlers only if it materially improves readability during the move
- avoid mixing a transport redesign into the directory refactor

If the backend later grows significant non-AI websocket or HTTP editor APIs, transport can be revisited in a separate follow-up.

### 8. Move tests with the files they verify

The refactor should move tests alongside their source files so the new structure remains self-explanatory.

Examples:

- `application/providerAuthService.test.ts` -> `ai/auth/providerAuthService.test.ts`
- `providers/codex/codexAuthClient.test.ts` -> `ai/auth/codex/codexAuthClient.test.ts`
- `application/threadOrchestrator.test.ts` -> `ai/agent/threads/threadOrchestrator.test.ts`
- `projections/threadProjector.test.ts` -> `ai/agent/threads/threadProjector.test.ts`
- `tools/workspaceAccessService.test.ts` should be replaced by:
  - `editor/documents/documentService.test.ts`
  - `editor/workspace/workspaceQueryService.test.ts`
- built-in tool tests should move under `ai/agent/tools/builtins/`
- transport tests should move under `ai/agent/transport/`

Tests are part of the architecture. If the tests do not move with the ownership boundaries, the refactor will still feel half-finished.

### 9. Use a staged migration instead of a single giant move

This refactor touches a large number of imports. The safest approach is a staged move that keeps the backend passing between phases.

Recommended implementation phases:

1. Create the target directories.
2. Move auth into `ai/auth/` and update composition.
3. Move runtime, provider registry, provider types, and provider implementations into `ai/agent/`.
4. Move thread repositories, projector, replay, and orchestrator into `ai/agent/threads/`.
5. Split `WorkspaceAccessService` into editor-owned services and update built-in tools to depend on them.
6. Move tool runtime files into `ai/agent/tools/`.
7. Move websocket transport into `ai/agent/transport/`.
8. Slim `index.ts` into explicit subsystem factories.
9. Remove obsolete directories and transitional wrappers.

Recommended sequencing rule:

- each phase should leave the repo buildable, typecheckable, and lint-clean before moving to the next one

### 10. Keep the refactor mostly behavior-preserving

This plan should explicitly avoid mixing three separate goals into one change:

- directory reorganization
- deep service decomposition
- product behavior redesign

Recommended discipline:

- only extract new services when they are needed to express a clean boundary
- do not rename every concept in the backend just because files moved
- preserve public class and function APIs where possible during the move
- do not change event contracts or provider semantics unless required by import and ownership cleanup

For example:

- splitting `WorkspaceAccessService` is worth doing now because the old class clearly spans editor and AI concerns
- fully decomposing `ThreadOrchestrator` into many smaller services is likely better as a follow-up once the new directory ownership is in place

### 11. Decide import strategy before moving files

This repo already has shared package path aliases, but it does not currently expose server-local aliases for internal modules.

Recommended approach for this refactor:

- keep using relative imports for the move itself to avoid config churn unless the import paths become unreasonably noisy
- if server-local import paths become too hard to maintain, add a narrowly scoped alias after the directory move, not before
- do not combine a large alias rollout with the first-pass architecture move unless it is clearly necessary

This keeps the refactor focused and reduces the number of independent moving parts.

### 12. Suggested concrete move map

The following source-to-target map should be used as the main checklist for the refactor.

- `application/providerAuthService.ts` -> `ai/auth/providerAuthService.ts`
- `application/providerAuthService.test.ts` -> `ai/auth/providerAuthService.test.ts`
- `persistence/providerAuthRepository.ts` -> `ai/auth/providerAuthRepository.ts`
- `persistence/providerAuthRepository.test.ts` -> `ai/auth/providerAuthRepository.test.ts`
- `providers/codex/codexAuthClient.ts` -> `ai/auth/codex/codexAuthClient.ts`
- `providers/codex/codexAuthClient.test.ts` -> `ai/auth/codex/codexAuthClient.test.ts`
- `providers/codex/codexOAuth.ts` -> `ai/auth/codex/codexOAuth.ts`
- `providers/codex/codexOAuth.test.ts` -> `ai/auth/codex/codexOAuth.test.ts`
- `providers/codex/codexJwt.ts` -> `ai/auth/codex/codexJwt.ts`
- `providers/codex/codexJwt.test.ts` -> `ai/auth/codex/codexJwt.test.ts`
- `core/runtime.ts` -> `ai/agent/runtime/runtime.ts`
- `core/runtime.test.ts` -> `ai/agent/runtime/runtime.test.ts`
- `core/errors.ts` -> `ai/agent/runtime/errors.ts`
- `core/errors.test.ts` -> `ai/agent/runtime/errors.test.ts`
- `application/providerRegistry.ts` -> `ai/agent/providers/providerRegistry.ts`
- `application/providerRegistry.test.ts` -> `ai/agent/providers/providerRegistry.test.ts`
- `providers/providerTypes.ts` -> `ai/agent/providers/providerTypes.ts`
- `providers/providerPrompts.ts` -> `ai/agent/providers/providerPrompts.ts`
- `providers/prompts/default_assistant_instructions.txt` -> `ai/agent/providers/prompts/default_assistant_instructions.txt`
- `providers/codex/codexProviderAdapter.ts` -> `ai/agent/providers/codex/codexProviderAdapter.ts`
- `providers/codex/codexProviderAdapter.test.ts` -> `ai/agent/providers/codex/codexProviderAdapter.test.ts`
- `providers/codex/codexResponsesClient.ts` -> `ai/agent/providers/codex/codexResponsesClient.ts`
- `providers/codex/codexResponsesClient.test.ts` -> `ai/agent/providers/codex/codexResponsesClient.test.ts`
- `providers/fake/fakeProviderAdapter.ts` -> `ai/agent/providers/fake/fakeProviderAdapter.ts`
- `providers/fake/fakeProviderAdapter.test.ts` -> `ai/agent/providers/fake/fakeProviderAdapter.test.ts`
- `application/threadOrchestrator.ts` -> `ai/agent/threads/threadOrchestrator.ts`
- `application/threadOrchestrator.test.ts` -> `ai/agent/threads/threadOrchestrator.test.ts`
- `application/replayService.ts` -> `ai/agent/threads/replayService.ts`
- `application/replayService.test.ts` -> `ai/agent/threads/replayService.test.ts`
- `projections/threadProjector.ts` -> `ai/agent/threads/threadProjector.ts`
- `projections/threadProjector.test.ts` -> `ai/agent/threads/threadProjector.test.ts`
- `persistence/eventStore.ts` -> `ai/agent/threads/eventStore.ts`
- `persistence/eventStore.test.ts` -> `ai/agent/threads/eventStore.test.ts`
- `persistence/threadRepository.ts` -> `ai/agent/threads/threadRepository.ts`
- `persistence/threadRepository.test.ts` -> `ai/agent/threads/threadRepository.test.ts`
- `persistence/providerSessionRepository.ts` -> `ai/agent/threads/providerSessionRepository.ts`
- `persistence/providerSessionRepository.test.ts` -> `ai/agent/threads/providerSessionRepository.test.ts`
- `tools/toolExecutor.ts` -> `ai/agent/tools/toolExecutor.ts`
- `tools/toolRegistry.ts` -> `ai/agent/tools/toolRegistry.ts`
- `tools/toolRegistry.test.ts` -> `ai/agent/tools/toolRegistry.test.ts`
- `tools/toolPermissionService.ts` -> `ai/agent/tools/toolPermissionService.ts`
- `tools/toolResultSerializer.ts` -> `ai/agent/tools/toolResultSerializer.ts`
- `tools/toolContextBuilder.ts` -> `ai/agent/tools/toolContextBuilder.ts`
- `tools/toolTypes.ts` -> `ai/agent/tools/toolTypes.ts`
- `tools/webContentService.ts` -> `ai/agent/tools/webContentService.ts`
- `tools/webContentService.test.ts` -> `ai/agent/tools/webContentService.test.ts`
- `tools/builtins/*` -> `ai/agent/tools/builtins/*`
- `transport/wsServer.ts` -> `ai/agent/transport/wsServer.ts`
- `transport/wsServer.test.ts` -> `ai/agent/transport/wsServer.test.ts`
- `transport/connectionRegistry.ts` -> `ai/agent/transport/connectionRegistry.ts`
- `transport/connectionRegistry.test.ts` -> `ai/agent/transport/connectionRegistry.test.ts`
- `tools/workspacePathPolicy.ts` -> `editor/workspace/workspacePathPolicy.ts`
- `tools/pathPresentationPolicy.ts` -> `editor/workspace/pathPresentationPolicy.ts`
- `tools/pathPresentationPolicy.test.ts` -> `editor/workspace/pathPresentationPolicy.test.ts`
- `tools/fileDiffPreview.ts` -> `editor/documents/fileDiffPreview.ts`
- `tools/fileDiffPreview.test.ts` -> `editor/documents/fileDiffPreview.test.ts`
- `tools/workspaceAccessService.ts` -> split into `editor/documents/documentService.ts` and `editor/workspace/workspaceQueryService.ts`
- `tools/workspaceAccessService.test.ts` -> split into `editor/documents/documentService.test.ts` and `editor/workspace/workspaceQueryService.test.ts`

### 13. Clean up naming after the move only where it improves ownership

The move should avoid churn for churn's sake, but a few names may become clearer once the files are in their new homes.

Acceptable naming follow-ups during the refactor:

- rename `WorkspaceAccessService` to `DocumentService` and `WorkspaceQueryService` as part of the explicit split
- rename helper comments and file headers so they describe the new ownership correctly
- update composition helper names to match the new subsystem boundaries

Names that should probably stay stable for the first pass:

- `ThreadOrchestrator`
- `ProviderRegistry`
- `WebSocketCommandServer`
- `ProviderAuthService`

Stable type and class names reduce the risk of a directory refactor turning into a semantic rewrite.

## Risks

- The largest risk is accidental behavioral change during a mostly-mechanical move, especially in `ThreadOrchestrator`, transport wiring, and provider runtime code.
- Splitting `WorkspaceAccessService` can accidentally change filesystem behavior, path sanitation behavior, or list/glob/grep semantics if the extraction is not backed by targeted tests.
- Relative import churn can create a noisy diff and make it harder to spot real regressions.
- Transport and composition files may temporarily become more complex during the intermediate phases before the final cleanup lands.
- If the move is done in one giant patch instead of staged phases, debugging failures will be much harder.
- If transitional wrappers are introduced and then forgotten, the repo can end up with the new layout on top of the old architecture instead of replacing it.
- Moving `core/errors.ts` under `ai/agent/runtime/` may reveal a few places where editor or auth code depended on generic backend errors. Those call sites should be reviewed deliberately rather than patched blindly.

## Validation

Validation should happen after each major phase and again at the end of the refactor.

Required checks after every substantial move phase:

- run `bun fmt`
- run `bun lint`
- run `bun typecheck`
- run `bun knip`
- run `bun run test`

Targeted validation should also accompany the boundary split work:

- verify auth tests still cover login start, cancel, expiry, refresh, and logout from the new `ai/auth/` locations
- verify provider adapter and responses client tests still cover commentary/final streaming, continuation history, and failure semantics after import moves
- verify thread orchestration and projector tests still cover replay, tool continuation, interruption, and failure behavior after the `ai/agent/threads/` move
- replace `WorkspaceAccessService` tests with explicit `DocumentService` and `WorkspaceQueryService` tests that cover the same sandboxing, read/write, list, glob, grep, and error-sanitization behaviors
- verify built-in tool tests still prove the tools call the correct editor-owned services and preserve existing result formatting
- verify websocket transport tests still cover bootstrap, thread subscribe/open/create/delete flows, auth state reads, and error mapping

Recommended execution discipline:

- do not start the next phase until the current phase passes the full validation suite
- if a move uncovers a hidden dependency-cycle or ownership problem, resolve it immediately rather than piling more moves on top

## Completion Criteria

This refactor is complete when all of the following are true:

- `apps/server/src` has a clear top-level split with `ai/` and `editor/`
- root `main.ts` and `index.ts` are slim bootstrapping/composition files rather than large mixed-domain modules
- provider auth code lives under `ai/auth/`
- AI runtime, providers, thread orchestration, tools, and transport live under `ai/agent/`
- editor workspace and document logic live under `editor/`
- `WorkspaceAccessService` has been retired in favor of editor-owned services with clearer responsibilities
- built-in agent tools depend on editor services rather than owning workspace/document logic directly
- old top-level directories such as `application/`, `providers/`, `tools/`, `transport/`, `persistence/`, `projections/`, and `core/` have either been removed or reduced to no-op transitional shells that are deleted by the end of the refactor
- all moved tests live alongside the new source ownership boundaries
- `bun fmt`, `bun lint`, `bun typecheck`, `bun knip`, and `bun run test` all pass
- the backend behavior remains functionally unchanged from a user perspective apart from any narrowly scoped internal cleanup required to complete the move
