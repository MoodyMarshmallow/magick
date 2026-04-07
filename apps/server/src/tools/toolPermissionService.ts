export interface ToolPermissionDecision {
  readonly decision: "allow";
}

export class ToolPermissionService {
  evaluate(): ToolPermissionDecision {
    return { decision: "allow" };
  }
}
