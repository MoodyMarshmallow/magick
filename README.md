# Magick

![Screenshot of the Magick software UI](screenshot.png)

Claude Code but for deep learning and thinking. Still a VERY EARLY WIP. Currently only runs via Codex.

## Todo
1. Clean up and harden the backend — Backend code still contains a lot of shallow modules. Need to refactor it into a more maintainable state.

2. Rework chat history handling to tree model — We should move from the current raw session-based session handling to a tree format: All chats should be stored as a single giant tree. When chats need to be sent to the api, we should walk up from the current node to the root to fetch the full history. (We may need to implement a node-merging function here to reduce traversals). This is also in preparation for step 4.

4. Move away from the thread model and instead adopt an infinite chat + bookmakrs format — We should have a single, unified chat with a bookmarking system so users can go back to sections they saved. This should allow for much better continuous context flow.P

3. Modularize frontend — I've decided that we shouldn't have fixed sidebars, but rather a fully modular interface. We should have presets, but th euser hsould be able to configure their interface at will.



## Running

```bash
npm run dev
```

Starts the default local development flow from the repo root.

```bash
bun run desktop:dev
```

Starts the Vite renderer and Electron desktop app together for development.

```bash
bun run desktop:start
```

Starts the Electron desktop app directly.

```bash
bun run desktop:main
```

Starts the Electron main process with file watching for `apps/desktop/src/main` and `apps/desktop/src/preload`.

```bash
bun run web:dev
```

Starts only the renderer on `http://localhost:4173`.

```bash
bun run server:start
```

Starts the local backend server on `ws://127.0.0.1:8787`.

```bash
bun run server:start -- --debug-agent-transport
```

Starts the local backend server with verbose agent transport debug logging for Codex request and stream summaries.

```bash
bun run server:dev -- --debug-agent-transport
```

Starts the watched backend server with the same agent transport debug logging enabled.
