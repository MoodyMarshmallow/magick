# Magick
- ChatGPT but better.

## Running

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
