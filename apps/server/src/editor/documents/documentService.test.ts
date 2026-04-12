import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathPresentationPolicy } from "../workspace/pathPresentationPolicy";
import { WorkspaceAccessError } from "../workspace/workspaceAccess";
import { WorkspacePathPolicy } from "../workspace/workspacePathPolicy";
import { DocumentService } from "./documentService";

const createService = () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magick-workspace-"));
  mkdirSync(join(workspaceRoot, "notes"), { recursive: true });
  writeFileSync(
    join(workspaceRoot, "notes", "alpha.md"),
    "alpha\nworld\n",
    "utf8",
  );

  return {
    workspaceRoot,
    service: new DocumentService({
      pathPolicy: new WorkspacePathPolicy(workspaceRoot),
      presentationPolicy: new PathPresentationPolicy("workspace-relative"),
    }),
  };
};

describe("DocumentService", () => {
  it("reads, writes, and checks file existence within the workspace root", async () => {
    const { service } = createService();

    await expect(service.read("notes/alpha.md")).resolves.toMatchObject({
      path: "notes/alpha.md",
      content: expect.stringContaining("alpha"),
    });
    await expect(service.exists("notes/alpha.md")).resolves.toBe(true);

    await expect(
      service.write("notes/gamma.md", "hello magick"),
    ).resolves.toMatchObject({
      path: "notes/gamma.md",
      previousContent: null,
      nextContent: "hello magick",
    });
    await expect(service.exists("notes/gamma.md")).resolves.toBe(true);
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
});
