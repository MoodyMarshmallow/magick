import { z } from "zod";
import type { ToolDefinition } from "../toolTypes";
import { loadToolDescription } from "./toolDescription";

const readToolSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .describe("Workspace-relative markdown file path to read."),
});

export const readTool: ToolDefinition<typeof readToolSchema> = {
  id: "read",
  description: loadToolDescription("read.txt"),
  schema: readToolSchema,
  execute: async (args, context) => {
    const file = await context.workspace.read(args.path);
    context.markFileRead(file.path);
    return {
      title: `Read ${file.path}`,
      modelOutput: file.content,
      resultPreview: file.content,
      path: file.path,
      url: null,
      diff: null,
    };
  },
};
