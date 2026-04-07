import { ToolExecutor } from "./toolExecutor";
import { ToolRegistry } from "./toolRegistry";

describe("ToolRegistry", () => {
  it("derives provider-facing JSON schema from Zod", () => {
    const readTool = new ToolRegistry()
      .list()
      .find((tool) => tool.id === "read");
    const listTool = new ToolRegistry()
      .list()
      .find((tool) => tool.id === "list");

    expect(readTool).toMatchObject({
      inputSchemaJson: {
        type: "object",
        required: ["path"],
        properties: {
          path: {
            type: "string",
            minLength: 1,
            description: "Workspace-relative markdown file path to read.",
          },
        },
      },
    });
    expect(listTool).toMatchObject({
      inputSchemaJson: {
        properties: {
          path: {
            default: ".",
          },
          hidden: {
            default: true,
          },
          maxDepth: {
            default: 3,
          },
        },
      },
    });
  });
});

describe("ToolExecutor", () => {
  it("uses Zod schemas to reject invalid tool inputs", async () => {
    const executor = new ToolExecutor();

    await expect(
      executor.execute({
        toolName: "read",
        input: { path: "   " },
        context: {
          workspaceId: "workspace_1",
          threadId: "thread_1",
          turnId: "turn_1",
          workspace: {} as never,
          web: {} as never,
        },
      }),
    ).rejects.toThrow();
  });
});
