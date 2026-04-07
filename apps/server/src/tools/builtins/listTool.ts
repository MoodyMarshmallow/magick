import { z } from "zod";
import type { ToolDefinition } from "../toolTypes";

const listToolSchema = z.object({
  path: z
    .string()
    .describe(
      "Workspace-relative directory path to scan with ripgrep. Defaults to '.' for the workspace root.",
    )
    .default("."),
  ignore: z
    .array(z.string())
    .describe(
      "Additional ripgrep ignore globs applied within the workspace tree. Defaults to an empty list.",
    )
    .default([]),
  hidden: z
    .boolean()
    .describe(
      "Include hidden files in the recursive ripgrep listing. Defaults to true.",
    )
    .default(true),
  follow: z
    .boolean()
    .describe(
      "Follow symlinks while ripgrep scans the workspace tree. Defaults to false.",
    )
    .default(false),
  maxDepth: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Maximum recursive depth for ripgrep file discovery from the selected workspace path. Defaults to 3.",
    )
    .default(3),
});

export const listTool: ToolDefinition<typeof listToolSchema> = {
  id: "list",
  description:
    "Lists files and directories in a given path. Rooted to the workspace root. The path parameter must be relative to the workspace root; omit it to use the current workspace root. You can optionally provide an array of glob patterns to ignore with the ignore parameter. You should generally prefer the Glob and Grep tools, if you know which directories to search.",
  schema: listToolSchema,
  execute: async (args, context) => {
    const result = await context.workspace.listTree({
      path: args.path,
      ignore: args.ignore,
      hidden: args.hidden,
      follow: args.follow,
      maxDepth: args.maxDepth,
    });
    return {
      title: args.path ? `Listed ${args.path}` : "Listed workspace root",
      modelOutput: result.output,
      resultPreview: result.output,
      path: result.path,
      url: null,
      diff: null,
    };
  },
};
