import { type ZodType, z } from "zod";
import { applyPatchTool } from "./builtins/applyPatchTool";
import { fetchTool } from "./builtins/fetchTool";
import { globTool } from "./builtins/globTool";
import { grepTool } from "./builtins/grepTool";
import { listTool } from "./builtins/listTool";
import { readTool } from "./builtins/readTool";
import { writeTool } from "./builtins/writeTool";
import type { RegisteredTool, ToolDefinition } from "./toolTypes";

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition<ZodType>>();

  constructor() {
    for (const tool of [
      listTool,
      readTool,
      writeTool,
      globTool,
      grepTool,
      applyPatchTool,
      fetchTool,
    ]) {
      this.#tools.set(tool.id, tool as ToolDefinition<ZodType>);
    }
  }

  list(): readonly RegisteredTool[] {
    return Array.from(this.#tools.values()).map((tool) => ({
      id: tool.id,
      description: tool.description,
      inputSchemaJson: z.toJSONSchema(tool.schema, {
        io: "input",
        unrepresentable: "any",
      }) as Record<string, unknown>,
    }));
  }

  get(toolId: string): ToolDefinition<ZodType> {
    const tool = this.#tools.get(toolId);
    if (!tool) {
      throw new Error(`Unknown tool '${toolId}'.`);
    }

    return tool;
  }
}
