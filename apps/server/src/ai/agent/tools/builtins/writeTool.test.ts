import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DocumentService } from "../../../../editor/documents/documentService";
import { PathPresentationPolicy } from "../../../../editor/workspace/pathPresentationPolicy";
import { WorkspacePathPolicy } from "../../../../editor/workspace/workspacePathPolicy";
import { WorkspaceQueryService } from "../../../../editor/workspace/workspaceQueryService";
import { ToolExecutionError } from "../toolTypes";
import { readTool } from "./readTool";
import { writeTool } from "./writeTool";

const createEditorServices = () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magick-write-tool-"));
  mkdirSync(join(workspaceRoot, "notes"), { recursive: true });
  writeFileSync(join(workspaceRoot, "notes", "alpha.md"), "alpha\n", "utf8");
  const pathPolicy = new WorkspacePathPolicy(workspaceRoot);
  const presentationPolicy = new PathPresentationPolicy("workspace-relative");
  const documents = new DocumentService({
    pathPolicy,
    presentationPolicy,
  });

  return {
    documents,
    workspaceQuery: new WorkspaceQueryService({
      pathPolicy,
      presentationPolicy,
      documents,
    }),
  };
};

const createContext = (services: {
  readonly documents: DocumentService;
  readonly workspaceQuery: WorkspaceQueryService;
}) => {
  const readFiles = new Set<string>();

  return {
    workspaceId: "workspace_1",
    threadId: "thread_1",
    turnId: "turn_1",
    documents: services.documents,
    workspaceQuery: services.workspaceQuery,
    web: {} as never,
    hasReadFile: (path: string) =>
      readFiles.has(
        services.documents.toAgentPath(services.documents.resolveFile(path)),
      ),
    markFileRead: (path: string) => {
      readFiles.add(
        services.documents.toAgentPath(services.documents.resolveFile(path)),
      );
    },
  };
};

describe("writeTool", () => {
  it("creates a new file without requiring a prior read", async () => {
    const services = createEditorServices();
    const context = createContext(services);

    await expect(
      writeTool.execute({ path: "notes/new.md", content: "hello" }, context),
    ).resolves.toMatchObject({
      path: "notes/new.md",
      title: "Created notes/new.md",
    });
  });

  it("rejects overwriting an existing file unless it was read first", async () => {
    const services = createEditorServices();
    const context = createContext(services);

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
