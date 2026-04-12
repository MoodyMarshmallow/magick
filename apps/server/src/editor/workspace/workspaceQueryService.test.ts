import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { DocumentService } from "../documents/documentService";
import { PathPresentationPolicy } from "./pathPresentationPolicy";
import { WorkspacePathPolicy } from "./workspacePathPolicy";
import { WorkspaceQueryService } from "./workspaceQueryService";

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
  const pathPolicy = new WorkspacePathPolicy(workspaceRoot);
  const presentationPolicy = new PathPresentationPolicy("workspace-relative");
  const documents = new DocumentService({
    pathPolicy,
    presentationPolicy,
  });

  return {
    workspaceRoot,
    documents,
    service: new WorkspaceQueryService({
      pathPolicy,
      presentationPolicy,
      documents,
    }),
  };
};

describe("WorkspaceQueryService", () => {
  it("lists, globs, and greps within the workspace root", async () => {
    const { service, documents } = createService();

    await documents.write("notes/gamma.md", "hello magick");
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

  it("matches root-level markdown files in glob and grep", async () => {
    const { service, documents } = createService();
    await documents.write("root.md", "root hello");

    await expect(service.glob("**/*.md")).resolves.toContain("root.md");
    await expect(service.grep("root hello")).resolves.toEqual([
      expect.objectContaining({ path: "root.md", line: 1 }),
    ]);
  });

  it("runs list rg from the workspace root even for nested paths", async () => {
    const { workspaceRoot, documents } = createService();
    const execFile = vi.fn(async () => ({
      stdout: "notes/alpha.md\nnotes/nested/deep.md\n",
      stderr: "",
    }));
    const service = new WorkspaceQueryService({
      pathPolicy: new WorkspacePathPolicy(workspaceRoot),
      presentationPolicy: new PathPresentationPolicy("workspace-relative"),
      documents,
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
