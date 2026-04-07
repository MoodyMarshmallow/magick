import type { ToolExecutionContext } from "./toolTypes";
import type { WebContentService } from "./webContentService";
import type { WorkspaceAccessService } from "./workspaceAccessService";

export const buildToolExecutionContext = (args: {
  readonly workspaceId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly workspace: WorkspaceAccessService;
  readonly web: WebContentService;
}): ToolExecutionContext => ({
  workspaceId: args.workspaceId,
  threadId: args.threadId,
  turnId: args.turnId,
  workspace: args.workspace,
  web: args.web,
});
