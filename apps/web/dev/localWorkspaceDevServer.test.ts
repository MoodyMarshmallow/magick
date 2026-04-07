import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLocalWorkspaceDevPlugin,
  ensureWorkspaceDirectory,
} from "./localWorkspaceDevServer";

describe("localWorkspaceDevServer", () => {
  it("creates an empty workspace directory when the workspace is empty", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "magick-web-workspace-"));

    try {
      ensureWorkspaceDirectory(workspaceDir);

      expect(existsSync(workspaceDir)).toBe(true);
      expect(readdirSync(workspaceDir)).toEqual([]);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  it("does not populate files when the workspace already exists", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "magick-web-workspace-"));

    try {
      ensureWorkspaceDirectory(workspaceDir);

      expect(readdirSync(workspaceDir)).toEqual([]);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  it("does not create files or start watching until the dev server is configured", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "magick-web-workspace-"));
    let watcherStarted = 0;
    let watcherStopped = 0;
    const plugin = createLocalWorkspaceDevPlugin({
      workspaceDir,
      createWatcher: () => ({
        start() {
          watcherStarted += 1;
        },
        stop() {
          watcherStopped += 1;
        },
      }),
    });

    try {
      expect(readdirSync(workspaceDir)).toEqual([]);
      expect(watcherStarted).toBe(0);

      const closeHandlers: Array<() => void> = [];
      const configureServer =
        typeof plugin.configureServer === "function"
          ? plugin.configureServer
          : plugin.configureServer?.handler;

      if (!configureServer) {
        throw new Error("Expected the dev plugin to expose configureServer.");
      }

      configureServer.call(
        {} as never,
        {
          httpServer: {
            once(_event: string, listener: () => void) {
              closeHandlers.push(listener as () => void);
              return this;
            },
          },
          middlewares: {
            use() {
              return this;
            },
          },
        } as never,
      );

      expect(readdirSync(workspaceDir)).toEqual([".magick"]);
      expect(watcherStarted).toBe(1);

      closeHandlers[0]?.();
      expect(watcherStopped).toBe(1);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});
