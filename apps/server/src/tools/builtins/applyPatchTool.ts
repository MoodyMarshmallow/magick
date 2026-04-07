import { z } from "zod";
import {
  createFileDiffPreview,
  formatFileDiffPreview,
} from "../fileDiffPreview";
import { type ToolDefinition, ToolExecutionError } from "../toolTypes";

const applyPatchToolSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .describe("Workspace-relative markdown file path to patch."),
  patches: z
    .array(
      z.object({
        find: z
          .string()
          .describe("Exact text to find in the file before replacing."),
        replace: z
          .string()
          .describe(
            "Replacement text that will be inserted once the target text is found.",
          ),
      }),
    )
    .describe(
      "Ordered patch operations applied sequentially to the target file.",
    )
    .min(1),
});

export const applyPatchTool: ToolDefinition<typeof applyPatchToolSchema> = {
  id: "apply_patch",
  description: "Apply targeted replacements to one file",
  schema: applyPatchToolSchema,
  execute: async (args, context) => {
    const currentFile = await context.workspace.read(args.path);
    let nextContent = currentFile.content;
    for (const patch of args.patches) {
      if (!nextContent.includes(patch.find)) {
        throw new ToolExecutionError(
          `Could not find patch target in ${currentFile.path}.`,
        );
      }
      nextContent = nextContent.replace(patch.find, patch.replace);
    }

    const writeResult = await context.workspace.write(args.path, nextContent);
    const diff = createFileDiffPreview({
      path: writeResult.path,
      previousContent: writeResult.previousContent,
      nextContent: writeResult.nextContent,
    });
    return {
      title: `Patched ${writeResult.path}`,
      modelOutput: formatFileDiffPreview(diff),
      resultPreview: formatFileDiffPreview(diff),
      path: writeResult.path,
      url: null,
      diff,
    };
  },
};
