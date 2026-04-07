import { ToolPermissionService } from "./toolPermissionService";
import { ToolRegistry } from "./toolRegistry";
import { serializeToolResult } from "./toolResultSerializer";
import type { ToolExecutionContext, ToolExecutionResult } from "./toolTypes";
import { ToolExecutionError } from "./toolTypes";

export class ToolExecutor {
  readonly #registry: ToolRegistry;
  readonly #permissions: ToolPermissionService;

  constructor(args?: {
    readonly registry?: ToolRegistry;
    readonly permissions?: ToolPermissionService;
  }) {
    this.#registry = args?.registry ?? new ToolRegistry();
    this.#permissions = args?.permissions ?? new ToolPermissionService();
  }

  listTools() {
    return this.#registry.list();
  }

  async execute(args: {
    readonly toolName: string;
    readonly input: unknown;
    readonly context: ToolExecutionContext;
  }): Promise<ToolExecutionResult> {
    const permissionDecision = this.#permissions.evaluate();
    if (permissionDecision.decision !== "allow") {
      throw new ToolExecutionError("Tool execution is not allowed.");
    }

    const tool = this.#registry.get(args.toolName);
    const parsedInput = tool.schema.safeParse(args.input);
    if (!parsedInput.success) {
      throw new ToolExecutionError(
        parsedInput.error.issues.map((issue) => issue.message).join("; ") ||
          parsedInput.error.message,
      );
    }
    const result = await tool.execute(parsedInput.data, args.context);
    return serializeToolResult(result);
  }
}
