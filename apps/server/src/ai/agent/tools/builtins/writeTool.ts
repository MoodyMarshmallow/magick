import { z } from "zod";
import {
  createFileDiffPreview,
  formatFileDiffPreview,
} from "../../../../editor/documents/fileDiffPreview";
import { type ToolDefinition, ToolExecutionError } from "../toolTypes";
import { loadToolDescription } from "./toolDescription";

const writeToolSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .describe("Workspace-relative file path to create or overwrite."),
  content: z.string().describe("Full content to write into the target file."),
});

export const writeTool: ToolDefinition<typeof writeToolSchema> = {
  id: "write_file",
  description: loadToolDescription("write_file.txt"),
  schema: writeToolSchema,
  execute: async (args, context) => {
    const fileExists = await context.documents.exists(args.path);
    if (fileExists && !context.hasReadFile(args.path)) {
      throw new ToolExecutionError(
        `Cannot overwrite '${args.path}' before reading it. Use the read tool first.`,
      );
    }

    const result = await context.documents.write(args.path, args.content);
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
