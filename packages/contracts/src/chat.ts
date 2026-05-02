// Defines shared branch, bookmark, command, and update contracts.

import type { ProviderKey } from "./provider";

export type BranchRuntimeState =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "interrupted"
  | "failed";
export type AssistantOutputChannel = "commentary" | "final";
export type AssistantCompletionReason = "tool_calls" | "stop" | "incomplete";
export type ToolActivityStatus =
  | "requested"
  | "running"
  | "completed"
  | "failed"
  | "awaiting_approval";

export interface FileDiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
}

export interface FileDiffPreview {
  readonly kind: "created" | "updated";
  readonly path: string;
  readonly hunks: readonly FileDiffHunk[];
  readonly truncated: boolean;
}

export interface ToolActivityView {
  readonly turnId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly title: string;
  readonly status: ToolActivityStatus;
  readonly argsPreview: string | null;
  readonly resultPreview: string | null;
  readonly path: string | null;
  readonly url: string | null;
  readonly diff: FileDiffPreview | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ToolApprovalView {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly path: string | null;
  readonly reason: string;
  readonly requestedAt: string;
}

export interface TranscriptMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly channel: AssistantOutputChannel | null;
  readonly content: string;
  readonly createdAt: string;
  readonly status: "streaming" | "complete" | "interrupted" | "failed";
  readonly reason?: AssistantCompletionReason | null;
}

export interface BookmarkSummary {
  readonly bookmarkId: string;
  readonly providerKey: ProviderKey;
  readonly title: string;
  readonly runtimeState: BranchRuntimeState;
  readonly latestActivityAt: string;
  readonly updatedAt: string;
}

export interface BranchViewModel {
  readonly bookmarkId: string;
  readonly headNodeId: string;
  readonly providerKey: ProviderKey;
  readonly title: string;
  readonly runtimeState: BranchRuntimeState;
  readonly messages: readonly TranscriptMessage[];
  readonly toolActivities: readonly ToolActivityView[];
  readonly pendingToolApproval: ToolApprovalView | null;
  readonly activeTurnId: string | null;
  readonly lastError: string | null;
  readonly lastUserMessageAt: string | null;
  readonly lastAssistantMessageAt: string | null;
  readonly latestActivityAt: string;
  readonly updatedAt: string;
}

export type ContextNodeKind =
  | "root"
  | "system_prompt"
  | "global_prompt"
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result";

export type ProviderPayloadItem =
  | {
      readonly type: "message";
      readonly role: "user" | "assistant";
      readonly channel: AssistantOutputChannel | null;
      readonly content: string;
      readonly reason?: AssistantCompletionReason;
    }
  | {
      readonly type: "tool_call";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: unknown;
    }
  | {
      readonly type: "tool_result";
      readonly toolCallId: string;
      readonly output: string;
    };

export interface BranchUpdate {
  readonly bookmarkId: string;
  readonly branch: BranchViewModel;
}

export type ClientCommand =
  | {
      readonly type: "app.bootstrap";
      readonly payload: { readonly bookmarkId?: string };
    }
  | {
      readonly type: "bookmark.list";
      readonly payload: Record<string, never>;
    }
  | {
      readonly type: "bookmark.create";
      readonly payload: {
        readonly providerKey: ProviderKey;
        readonly title?: string;
      };
    }
  | {
      readonly type: "bookmark.select";
      readonly payload: { readonly bookmarkId: string };
    }
  | {
      readonly type: "bookmark.rename";
      readonly payload: { readonly bookmarkId: string; readonly title: string };
    }
  | {
      readonly type: "bookmark.delete";
      readonly payload: { readonly bookmarkId: string };
    }
  | {
      readonly type: "bookmark.sendMessage";
      readonly payload: {
        readonly bookmarkId: string;
        readonly content: string;
      };
    }
  | {
      readonly type: "bookmark.stopTurn";
      readonly payload: { readonly bookmarkId: string };
    }
  | {
      readonly type: "bookmark.retryTurn";
      readonly payload: { readonly bookmarkId: string };
    }
  | {
      readonly type: "bookmark.resume";
      readonly payload: { readonly bookmarkId: string };
    }
  | {
      readonly type: "tool.approval.respond";
      readonly payload: {
        readonly bookmarkId: string;
        readonly toolCallId: string;
        readonly decision: "approved" | "rejected";
      };
    }
  | {
      readonly type: "provider.auth.read";
      readonly payload: {
        readonly providerKey: ProviderKey;
        readonly refreshToken?: boolean;
      };
    }
  | {
      readonly type: "provider.auth.login.start";
      readonly payload: {
        readonly providerKey: ProviderKey;
        readonly mode: "chatgpt";
      };
    }
  | {
      readonly type: "provider.auth.login.cancel";
      readonly payload: {
        readonly providerKey: ProviderKey;
        readonly loginId: string;
      };
    }
  | {
      readonly type: "provider.auth.logout";
      readonly payload: { readonly providerKey: ProviderKey };
    };
