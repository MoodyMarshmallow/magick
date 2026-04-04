import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalWorkspaceService } from "./localWorkspaceService";

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "magick-desktop-"));
  const workspaceDir = join(root, "workspace");

  mkdirSync(join(workspaceDir, "notes", "patterns"), { recursive: true });
  mkdirSync(join(workspaceDir, "codex"), { recursive: true });
  mkdirSync(join(workspaceDir, "node_modules", "ignored"), { recursive: true });

  writeFileSync(
    join(workspaceDir, "codex", "evergreen-systems-memo.md"),
    "Magick should feel like a calm studio for thinking with AI.",
    "utf8",
  );
  writeFileSync(
    join(workspaceDir, "notes", "patterns", "design-system-field-notes.md"),
    "Keep the interface flat, direct, and readable.",
    "utf8",
  );
  writeFileSync(
    join(workspaceDir, "notes", "scratch.txt"),
    "Plain text is also supported in the first pass.",
    "utf8",
  );
  writeFileSync(
    join(workspaceDir, "node_modules", "ignored", "package.md"),
    "This file should be ignored.",
    "utf8",
  );

  const service = new LocalWorkspaceService({ workspaceDir });

  return {
    root,
    workspaceDir,
    service,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
};

describe("LocalWorkspaceService", () => {
  it("builds a workspace tree from real local files", () => {
    const harness = createHarness();

    try {
      const bootstrap = harness.service.getFileWorkspaceBootstrap();

      expect(bootstrap.workspaceRoot).toBe(harness.workspaceDir);
      expect(bootstrap.tree).toEqual([
        {
          id: "directory:codex",
          type: "directory",
          name: "codex",
          path: "codex",
          children: [
            {
              id: "file:codex/evergreen-systems-memo.md",
              type: "file",
              name: "evergreen-systems-memo.md",
              path: "codex/evergreen-systems-memo.md",
              filePath: "codex/evergreen-systems-memo.md",
            },
          ],
        },
        {
          id: "directory:notes",
          type: "directory",
          name: "notes",
          path: "notes",
          children: [
            {
              id: "directory:notes/patterns",
              type: "directory",
              name: "patterns",
              path: "notes/patterns",
              children: [
                {
                  id: "file:notes/patterns/design-system-field-notes.md",
                  type: "file",
                  name: "design-system-field-notes.md",
                  path: "notes/patterns/design-system-field-notes.md",
                  filePath: "notes/patterns/design-system-field-notes.md",
                },
              ],
            },
            {
              id: "file:notes/scratch.txt",
              type: "file",
              name: "scratch.txt",
              path: "notes/scratch.txt",
              filePath: "notes/scratch.txt",
            },
          ],
        },
      ]);
    } finally {
      harness.cleanup();
    }
  });

  it("opens a file by workspace-relative path", () => {
    const harness = createHarness();

    try {
      const file = harness.service.openFile("codex/evergreen-systems-memo.md");

      expect(file.title).toBe("Evergreen Systems Memo");
      expect(file.markdown).toContain("Magick should feel like a calm studio");
    } finally {
      harness.cleanup();
    }
  });

  it("persists file saves to disk", () => {
    const harness = createHarness();

    try {
      harness.service.saveFile(
        "notes/patterns/design-system-field-notes.md",
        "Fresh local markdown",
      );

      expect(
        readFileSync(
          join(
            harness.workspaceDir,
            "notes",
            "patterns",
            "design-system-field-notes.md",
          ),
          "utf8",
        ),
      ).toContain("Fresh local markdown");
    } finally {
      harness.cleanup();
    }
  });

  it("rejects file paths that escape the workspace root", () => {
    const harness = createHarness();

    try {
      expect(() => harness.service.openFile("../outside.md")).toThrow(
        "outside the workspace root",
      );
    } finally {
      harness.cleanup();
    }
  });

  it("loads legacy thread history from workspace.json", () => {
    const harness = createHarness();

    try {
      writeFileSync(
        join(harness.workspaceDir, "workspace.json"),
        JSON.stringify({
          threads: [
            {
              threadId: "thread_legacy",
              title: "Legacy Chat",
              status: "open",
              updatedAt: "2026-04-04T00:00:00.000Z",
              messages: [],
            },
          ],
        }),
        "utf8",
      );

      const service = new LocalWorkspaceService({
        workspaceDir: harness.workspaceDir,
      });

      expect(service.getWorkspaceBootstrap().threads).toEqual([
        {
          threadId: "thread_legacy",
          title: "Legacy Chat",
          status: "open",
          updatedAt: "2026-04-04T00:00:00.000Z",
          messages: [],
        },
      ]);
    } finally {
      harness.cleanup();
    }
  });

  it("persists local thread replies and emits a completed assistant reply sequence", () => {
    const harness = createHarness();

    try {
      const events = harness.service.sendThreadMessage(
        "thread_seed_1",
        "Follow up from desktop",
      );

      expect(events.map((event) => event.type)).toEqual([
        "message.added",
        "message.added",
        ...events.slice(2, -1).map((event) => event.type),
        "message.completed",
      ]);

      const persistedThreads = JSON.parse(
        readFileSync(
          join(harness.workspaceDir, ".magick", "workspace.json"),
          "utf8",
        ),
      ) as {
        threads: Array<{
          threadId: string;
          messages: Array<{ body: string; status: string }>;
        }>;
      };
      const persistedThread = persistedThreads.threads.find(
        (thread) => thread.threadId === "thread_seed_1",
      );

      expect(persistedThread?.messages.at(-2)?.body).toBe(
        "Follow up from desktop",
      );
      expect(persistedThread?.messages.at(-1)?.status).toBe("complete");
      expect(persistedThread?.messages.at(-1)?.body).toContain("chat durable");
    } finally {
      harness.cleanup();
    }
  });

  it("persists resolved state changes for local threads", () => {
    const harness = createHarness();

    try {
      const event = harness.service.toggleThreadResolved("thread_seed_1");

      expect(event.type).toBe("thread.statusChanged");
      if (event.type !== "thread.statusChanged") {
        throw new Error("Expected a thread status change event.");
      }
      expect(event.status).toBe("resolved");

      const reloadedService = new LocalWorkspaceService({
        workspaceDir: harness.workspaceDir,
      });
      expect(
        reloadedService
          .getWorkspaceBootstrap()
          .threads.find((thread) => thread.threadId === "thread_seed_1")
          ?.status,
      ).toBe("resolved");
    } finally {
      harness.cleanup();
    }
  });
});
