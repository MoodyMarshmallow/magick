import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { PathPresentationPolicy } from "./pathPresentationPolicy";
import {
  WorkspaceAccessError,
  WorkspaceAccessService,
} from "./workspaceAccessService";
import { WorkspacePathPolicy } from "./workspacePathPolicy";

const createService = () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magick-workspace-"));
  mkdirSync(join(workspaceRoot, "notes"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "notes", "alpha.md"),
    "alpha\nworld\n",
    "utf8",
  );
  writeFileSync(
    join(workspaceRoot, "notes", "beta.md"),
    "beta\nhello\n",
    "utf8",
  );
  writeFileSync(join(workspaceRoot, ".hidden.md"), "hidden", "utf8");
  mkdirSync(join(workspaceRoot, "notes", "nested"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "notes", "nested", "deep.md"),
    "deep\nfile\n",
    "utf8",
  );
  return {
    workspaceRoot,
    service: new WorkspaceAccessService({
      pathPolicy: new WorkspacePathPolicy(workspaceRoot),
      presentationPolicy: new PathPresentationPolicy("workspace-relative"),
    }),
  };
};

describe("WorkspaceAccessService", () => {
  it("lists, reads, writes, globs, and greps within the workspace root", async () => {
    const { service } = createService();

    await expect(service.read("notes/alpha.md")).resolves.toMatchObject({
      path: "notes/alpha.md",
      content: expect.stringContaining("alpha"),
    });

    await service.write("notes/gamma.md", "hello magick");
    await expect(service.glob("notes/*.md")).resolves.toContain(
      "notes/gamma.md",
    );
    await expect(service.grep("hello")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "notes/beta.md" }),
        expect.objectContaining({ path: "notes/gamma.md" }),
      ]),
    );

    await expect(service.listTree({ path: "." })).resolves.toMatchObject({
      path: ".",
      output: expect.stringContaining("notes/"),
    });
    await expect(
      service.listTree({ path: ".", hidden: false, maxDepth: 1 }),
    ).resolves.toMatchObject({
      output: expect.not.stringContaining(".hidden.md"),
    });
    await expect(
      service.listTree({ path: ".", maxDepth: 1 }),
    ).resolves.toMatchObject({
      output: expect.not.stringContaining("deep.md"),
    });
  });

  it("refuses paths outside the workspace root", async () => {
    const { service } = createService();

    await expect(service.read("../outside.md")).rejects.toBeInstanceOf(
      WorkspaceAccessError,
    );
  });

  it("refuses symlinked file access outside the workspace root", async () => {
    const { service } = createService();
    const outsideRoot = mkdtempSync(join(tmpdir(), "magick-outside-"));
    const outsideFile = join(outsideRoot, "secret.md");
    writeFileSync(outsideFile, "secret", "utf8");
    symlinkSync(outsideFile, join(service.workspaceRoot, "notes", "leak.md"));

    await expect(service.read("notes/leak.md")).rejects.toBeInstanceOf(
      WorkspaceAccessError,
    );
    await expect(
      service.write("notes/leak.md", "overwrite attempt"),
    ).rejects.toBeInstanceOf(WorkspaceAccessError);
  });

  it("matches root-level markdown files in glob and grep", async () => {
    const { service } = createService();
    await service.write("root.md", "root hello");

    await expect(service.glob("**/*.md")).resolves.toContain("root.md");
    await expect(service.grep("root hello")).resolves.toEqual([
      expect.objectContaining({ path: "root.md", line: 1 }),
    ]);
  });

  it("sanitizes filesystem errors so the workspace root is not leaked", async () => {
    const { service, workspaceRoot } = createService();

    await expect(service.read("missing.md")).rejects.toMatchObject({
      name: "WorkspaceAccessError",
      message: expect.stringContaining("missing.md"),
    });

    try {
      await service.read("missing.md");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(workspaceRoot);
    }
  });

  it("runs list rg from the workspace root even for nested paths", async () => {
    const { workspaceRoot } = createService();
    const execFile = vi.fn(async () => ({
      stdout: "notes/alpha.md\nnotes/nested/deep.md\n",
      stderr: "",
    }));
    const service = new WorkspaceAccessService({
      pathPolicy: new WorkspacePathPolicy(workspaceRoot),
      presentationPolicy: new PathPresentationPolicy("workspace-relative"),
      execFile,
    });
    const result = await service.listTree({ path: "notes" });

    expect(result).toMatchObject({
      path: "notes",
      output: expect.stringContaining("alpha.md"),
    });
    expect(result.output).not.toContain("notes/\n  notes/");
    expect(execFile).toHaveBeenCalledWith(
      "rg",
      expect.arrayContaining(["--files", "notes"]),
      { cwd: workspaceRoot },
    );
  });
});
