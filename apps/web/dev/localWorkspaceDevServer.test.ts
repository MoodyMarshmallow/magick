import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createLocalWorkspaceDevPlugin,
  ensureSeedWorkspaceFiles,
} from "./localWorkspaceDevServer";

describe("localWorkspaceDevServer", () => {
  it("seeds example workspace files when the workspace is empty", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "magick-web-workspace-"));

    try {
      ensureSeedWorkspaceFiles(workspaceDir);

      expect(
        existsSync(
          join(workspaceDir, "notes", "research", "layout-observations.md"),
        ),
      ).toBe(true);
      expect(
        readFileSync(
          join(workspaceDir, "notes", "archive", "recovery-notes.md"),
          "utf8",
        ),
      ).toContain("local-first client");
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  it("does not overwrite an existing supported workspace file", () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "magick-web-workspace-"));

    try {
      const filePath = join(workspaceDir, "notes", "studio", "custom.md");
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, "custom workspace file", "utf8");

      ensureSeedWorkspaceFiles(workspaceDir);

      expect(readFileSync(filePath, "utf8")).toBe("custom workspace file");
      expect(
        existsSync(
          join(workspaceDir, "notes", "research", "layout-observations.md"),
        ),
      ).toBe(false);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });

  it("does not seed files or start watching until the dev server is configured", () => {
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
      expect(existsSync(join(workspaceDir, "notes"))).toBe(false);
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

      expect(existsSync(join(workspaceDir, "notes"))).toBe(true);
      expect(watcherStarted).toBe(1);

      closeHandlers[0]?.();
      expect(watcherStopped).toBe(1);
    } finally {
      rmSync(workspaceDir, { force: true, recursive: true });
    }
  });
});
