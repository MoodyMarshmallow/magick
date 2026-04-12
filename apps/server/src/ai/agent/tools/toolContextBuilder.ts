import type { DocumentService } from "../../../editor/documents/documentService";
import type { WorkspaceQueryService } from "../../../editor/workspace/workspaceQueryService";
import type { ToolExecutionContext } from "./toolTypes";
import type { WebContentService } from "./webContentService";

export const buildToolExecutionContext = (args: {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly documents: DocumentService;
  readonly workspaceQuery: WorkspaceQueryService;
  readonly web: WebContentService;
  readonly hasReadFile: (path: string) => boolean;
  readonly markFileRead: (path: string) => void;
}): ToolExecutionContext => ({
  workspaceId: args.workspaceId,
  threadId: args.threadId,
  turnId: args.turnId,
  documents: args.documents,
  workspaceQuery: args.workspaceQuery,
  web: args.web,
  hasReadFile: args.hasReadFile,
  markFileRead: args.markFileRead,
});
