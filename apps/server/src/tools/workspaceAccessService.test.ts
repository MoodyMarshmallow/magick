import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
