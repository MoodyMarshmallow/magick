import type { ToolExecutionContext } from "./toolTypes";
import type { WebContentService } from "./webContentService";
import type { WorkspaceAccessService } from "./workspaceAccessService";

export const buildToolExecutionContext = (args: {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly workspace: WorkspaceAccessService;
  readonly web: WebContentService;
  readonly hasReadFile: (path: string) => boolean;
  readonly markFileRead: (path: string) => void;
}): ToolExecutionContext => ({
  workspaceId: args.workspaceId,
  threadId: args.threadId,
  turnId: args.turnId,
  workspace: args.workspace,
  web: args.web,
  hasReadFile: args.hasReadFile,
  markFileRead: args.markFileRead,
});
