import { z } from "zod";
import type { ToolDefinition } from "../toolTypes";

const fetchToolSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .describe("HTTP or HTTPS URL to fetch and convert into readable text."),
});

export const fetchTool: ToolDefinition<typeof fetchToolSchema> = {
  id: "fetch",
  description: "Fetch a URL",
  schema: fetchToolSchema,
  execute: async (args, context) => {
    const result = await context.web.fetchUrl(args.url);
    return {
      title: `Fetched ${result.url}`,
      modelOutput: result.content,
      resultPreview: result.content,
      path: null,
      url: result.url,
      diff: null,
    };
  },
};
