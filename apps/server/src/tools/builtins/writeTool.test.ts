import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathPresentationPolicy } from "../pathPresentationPolicy";
import { ToolExecutionError } from "../toolTypes";
import { WorkspaceAccessService } from "../workspaceAccessService";
import { WorkspacePathPolicy } from "../workspacePathPolicy";
import { readTool } from "./readTool";
import { writeTool } from "./writeTool";

const createWorkspace = () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magick-write-tool-"));
  mkdirSync(join(workspaceRoot, "notes"), { recursive: true });
  writeFileSync(join(workspaceRoot, "notes", "alpha.md"), "alpha\n", "utf8");

  return new WorkspaceAccessService({
    pathPolicy: new WorkspacePathPolicy(workspaceRoot),
    presentationPolicy: new PathPresentationPolicy("workspace-relative"),
  });
};

const createContext = (workspace: WorkspaceAccessService) => {
  const readFiles = new Set<string>();

  return {
    workspaceId: "workspace_1",
    threadId: "thread_1",
    turnId: "turn_1",
    workspace,
    web: {} as never,
    hasReadFile: (path: string) =>
      readFiles.has(workspace.toAgentPath(workspace.resolveFile(path))),
    markFileRead: (path: string) => {
      readFiles.add(workspace.toAgentPath(workspace.resolveFile(path)));
    },
  };
};

describe("writeTool", () => {
  it("creates a new file without requiring a prior read", async () => {
    const workspace = createWorkspace();
    const context = createContext(workspace);

    await expect(
      writeTool.execute({ path: "notes/new.md", content: "hello" }, context),
    ).resolves.toMatchObject({
      path: "notes/new.md",
      title: "Created notes/new.md",
    });
  });

  it("rejects overwriting an existing file unless it was read first", async () => {
    const workspace = createWorkspace();
    const context = createContext(workspace);

    await expect(
      writeTool.execute(
        { path: "notes/alpha.md", content: "updated" },
        context,
      ),
    ).rejects.toBeInstanceOf(ToolExecutionError);

    await readTool.execute({ path: "notes/alpha.md" }, context);

    await expect(
      writeTool.execute(
        { path: "notes/alpha.md", content: "updated" },
        context,
      ),
    ).resolves.toMatchObject({
      path: "notes/alpha.md",
      title: "Updated notes/alpha.md",
    });
  });
});
