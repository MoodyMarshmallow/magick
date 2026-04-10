import type { ZodType, z } from "zod";
import type { FileDiffPreview } from "./fileDiffPreview";
import type { WebContentService } from "./webContentService";
import type { WorkspaceAccessService } from "./workspaceAccessService";

export interface ToolExecutionContext {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly workspace: WorkspaceAccessService;
  readonly web: WebContentService;
  readonly hasReadFile: (path: string) => boolean;
  readonly markFileRead: (path: string) => void;
}

export interface ToolExecutionResult {
  readonly title: string;
  readonly modelOutput: string;
  readonly resultPreview: string | null;
  readonly path: string | null;
  readonly url: string | null;
  readonly diff: FileDiffPreview | null;
}

export interface ToolDefinition<TSchema extends ZodType> {
  readonly id: string;
  readonly description: string;
  readonly schema: TSchema;
  readonly execute: (
    args: z.infer<TSchema>,
    context: ToolExecutionContext,
  ) => Promise<ToolExecutionResult>;
}

export interface RegisteredTool {
  readonly id: string;
  readonly description: string;
  readonly inputSchemaJson: Record<string, unknown>;
}

export class ToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolExecutionError";
  }
}
