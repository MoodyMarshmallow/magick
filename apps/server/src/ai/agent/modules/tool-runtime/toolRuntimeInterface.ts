import type { ToolActivityView } from "@magick/contracts/chat";
import type { ProviderRuntimeToolDefinition } from "../provider-runtime/providerRuntimeInterface";

export interface ToolRuntimeCall {
  readonly turnId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}

export interface ToolRuntimeResult {
  readonly turnId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: "completed" | "failed";
  readonly title: string;
  readonly resultPreview: string | null;
  readonly modelOutput: string;
  readonly path: string | null;
  readonly url: string | null;
  readonly diff: ToolActivityView["diff"];
  readonly error: string | null;
}

export interface ToolRuntimeInterface {
  listProviderTools(): readonly ProviderRuntimeToolDefinition[];
  executeToolCalls(input: {
    readonly bookmarkId: string;
    readonly calls: readonly ToolRuntimeCall[];
  }): Promise<readonly ToolRuntimeResult[]>;
}
