import { z } from "zod";
import type { ToolDefinition } from "../toolTypes";

const globToolSchema = z.object({
  pattern: z
    .string()
    .trim()
    .min(1)
    .describe("Workspace-relative glob pattern used to match markdown files."),
});

export const globTool: ToolDefinition<typeof globToolSchema> = {
  id: "glob",
  description: "Find files by pattern",
  schema: globToolSchema,
  execute: async (args, context) => {
    const matches = await context.workspace.glob(args.pattern);
    const body = matches.join("\n") || "No matches found.";
    return {
      title: `Globbed ${args.pattern}`,
      modelOutput: body,
      resultPreview: body,
      path: null,
      url: null,
      diff: null,
    };
  },
};
