import { z } from "zod";
import {
  createFileDiffPreview,
  formatFileDiffPreview,
} from "../fileDiffPreview";
import type { ToolDefinition } from "../toolTypes";

const writeToolSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .describe("Workspace-relative markdown file path to create or overwrite."),
  content: z
    .string()
    .describe("Full markdown content to write into the target file."),
});

export const writeTool: ToolDefinition<typeof writeToolSchema> = {
  id: "write_file",
  description: "Write one markdown file",
  schema: writeToolSchema,
  execute: async (args, context) => {
    const result = await context.workspace.write(args.path, args.content);
    const diff = createFileDiffPreview({
      path: result.path,
      previousContent: result.previousContent,
      nextContent: result.nextContent,
    });
    return {
      title: `${result.previousContent === null ? "Created" : "Updated"} ${result.path}`,
      modelOutput: formatFileDiffPreview(diff),
      resultPreview: formatFileDiffPreview(diff),
      path: result.path,
      url: null,
      diff,
    };
  },
};
