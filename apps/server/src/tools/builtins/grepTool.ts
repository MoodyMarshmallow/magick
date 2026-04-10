import { z } from "zod";
import type { ToolDefinition } from "../toolTypes";
import { loadToolDescription } from "./toolDescription";

const grepToolSchema = z.object({
  pattern: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Case-insensitive regular-expression pattern to search within workspace markdown files.",
    ),
});

export const grepTool: ToolDefinition<typeof grepToolSchema> = {
  id: "grep",
  description: loadToolDescription("grep.txt"),
  schema: grepToolSchema,
  execute: async (args, context) => {
    const matches = await context.workspace.grep(args.pattern);
    const body =
      matches
        .map((match) => `${match.path}:${match.line} ${match.text}`)
        .join("\n") || "No matches found.";
    return {
      title: `Grepped ${args.pattern}`,
      modelOutput: body,
      resultPreview: body,
      path: null,
      url: null,
      diff: null,
    };
  },
};
