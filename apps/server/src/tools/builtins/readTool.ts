import { z } from "zod";
import type { ToolDefinition } from "../toolTypes";

const readToolSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .describe("Workspace-relative markdown file path to read."),
});

export const readTool: ToolDefinition<typeof readToolSchema> = {
  id: "read",
  description: "Read one markdown file",
  schema: readToolSchema,
  execute: async (args, context) => {
    const file = await context.workspace.read(args.path);
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
