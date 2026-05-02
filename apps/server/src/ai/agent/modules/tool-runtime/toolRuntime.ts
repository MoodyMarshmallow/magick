import type { DocumentService } from "../../../../editor/documents/documentService";
import type { WorkspaceQueryService } from "../../../../editor/workspace/workspaceQueryService";
import { buildToolExecutionContext } from "./toolContextBuilder";
import type { ToolExecutor } from "./toolExecutor";
import type {
  ToolRuntimeCall,
  ToolRuntimeInterface,
  ToolRuntimeResult,
} from "./toolRuntimeInterface";
import type { WebContentService } from "./webContentService";

export class ToolRuntime implements ToolRuntimeInterface {
  readonly #toolExecutor: ToolExecutor;
  readonly #documents: DocumentService;
  readonly #workspaceQuery: WorkspaceQueryService;
  readonly #webContent: WebContentService;

  constructor(args: {
    readonly toolExecutor: ToolExecutor;
    readonly documents: DocumentService;
    readonly workspaceQuery: WorkspaceQueryService;
    readonly webContent: WebContentService;
  }) {
    this.#toolExecutor = args.toolExecutor;
    this.#documents = args.documents;
    this.#workspaceQuery = args.workspaceQuery;
    this.#webContent = args.webContent;
  }

  listProviderTools(): ReturnType<ToolRuntimeInterface["listProviderTools"]> {
    return this.#toolExecutor.listTools().map((tool) => ({
      name: tool.id,
      description: tool.description,
      inputSchema: tool.inputSchemaJson,
    }));
  }

  async executeToolCalls(input: {
    readonly bookmarkId: string;
    readonly calls: readonly ToolRuntimeCall[];
  }): Promise<readonly ToolRuntimeResult[]> {
    const readFilesForTurn = new Set<string>();
    const results: ToolRuntimeResult[] = [];

    for (const call of input.calls) {
      const context = buildToolExecutionContext({
        workspaceId: "global",
        bookmarkId: input.bookmarkId,
        turnId: call.turnId,
        documents: this.#documents,
        workspaceQuery: this.#workspaceQuery,
        web: this.#webContent,
        hasReadFile: (path) => readFilesForTurn.has(this.#normalizePath(path)),
        markFileRead: (path) => readFilesForTurn.add(this.#normalizePath(path)),
      });

      try {
        const result = await this.#toolExecutor.execute({
          toolName: call.toolName,
          input: call.input,
          context,
        });
        results.push({
          turnId: call.turnId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          status: "completed",
          title: result.title,
          resultPreview: result.resultPreview,
          modelOutput: result.modelOutput,
          path: result.path,
          url: result.url,
          diff: result.diff,
          error: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          turnId: call.turnId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          status: "failed",
          title: call.toolName,
          resultPreview: null,
          modelOutput: `Tool execution failed: ${message}`,
          path: null,
          url: null,
          diff: null,
          error: message,
        });
      }
    }

    return results;
  }

  #normalizePath(path: string): string {
    return this.#documents.toAgentPath(this.#documents.resolveFile(path));
  }
}
