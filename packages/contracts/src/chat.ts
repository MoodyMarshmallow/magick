// Defines shared chat records, command payloads, and domain event contracts.

import type { ProviderKey, ResumeStrategy } from "./provider";

export type ThreadRuntimeState =
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

export type ThreadResolutionState = "open" | "resolved";

export interface ThreadRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly providerKey: ProviderKey;
  readonly providerSessionId: string;
  readonly title: string;
  readonly resolutionState: ThreadResolutionState;
  readonly createdAt: string;
  readonly updatedAt: string;
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

export interface ThreadViewModel {
  readonly threadId: string;
  readonly workspaceId: string;
  readonly providerKey: ProviderKey;
  readonly providerSessionId: string;
  readonly title: string;
  readonly resolutionState: ThreadResolutionState;
  readonly runtimeState: ThreadRuntimeState;
  readonly messages: readonly TranscriptMessage[];
  readonly toolActivities: readonly ToolActivityView[];
  readonly pendingToolApproval: ToolApprovalView | null;
  readonly activeTurnId: string | null;
  readonly latestSequence: number;
  readonly lastError: string | null;
  readonly lastUserMessageAt: string | null;
  readonly lastAssistantMessageAt: string | null;
  readonly latestActivityAt: string;
  readonly updatedAt: string;
}

export interface ThreadSummary {
  readonly threadId: string;
  readonly workspaceId: string;
  readonly providerKey: ProviderKey;
  readonly title: string;
  readonly resolutionState: ThreadResolutionState;
  readonly runtimeState: ThreadRuntimeState;
  readonly latestSequence: number;
  readonly latestActivityAt: string;
  readonly updatedAt: string;
}

interface EventBase<TType extends string, TPayload> {
  readonly eventId: string;
  readonly threadId: string;
  readonly providerSessionId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type: TType;
  readonly payload: Readonly<TPayload>;
}

export type DomainEvent =
  | EventBase<
      "thread.created",
      { workspaceId: string; providerKey: ProviderKey; title: string }
    >
  | EventBase<"thread.renamed", { title: string }>
  | EventBase<
      "provider.session.started",
      {
        providerKey: ProviderKey;
        resumeStrategy: ResumeStrategy;
      }
    >
  | EventBase<"provider.session.disconnected", { reason: string }>
  | EventBase<"provider.session.recovered", { reason: string }>
  | EventBase<"message.user.created", { messageId: string; content: string }>
  | EventBase<"turn.started", { turnId: string; parentTurnId: string | null }>
  | EventBase<
      "message.assistant.delta",
      {
        turnId: string;
        messageId: string;
        channel: AssistantOutputChannel;
        delta: string;
      }
    >
  | EventBase<
      "message.assistant.completed",
      {
        turnId: string;
        messageId: string;
        channel: AssistantOutputChannel;
        reason?: AssistantCompletionReason;
      }
    >
  | EventBase<"turn.completed", { turnId: string }>
  | EventBase<"turn.interrupted", { turnId: string; reason: string }>
  | EventBase<"turn.failed", { turnId: string; error: string }>
  | EventBase<
      "tool.requested",
      {
        turnId: string;
        toolCallId: string;
        toolName: string;
        title: string;
        argsPreview: string | null;
        input?: unknown;
        path: string | null;
        url: string | null;
      }
    >
  | EventBase<"tool.started", { turnId: string; toolCallId: string }>
  | EventBase<
      "tool.completed",
      {
        turnId: string;
        toolCallId: string;
        resultPreview: string | null;
        modelOutput?: string | null;
        path: string | null;
        url: string | null;
        diff: FileDiffPreview | null;
      }
    >
  | EventBase<
      "tool.failed",
      {
        turnId: string;
        toolCallId: string;
        error: string;
        modelOutput?: string | null;
      }
    >
  | EventBase<
      "tool.approval.requested",
      {
        turnId: string;
        toolCallId: string;
        toolName: string;
        path: string | null;
        reason: string;
      }
    >
  | EventBase<
      "tool.approval.resolved",
      {
        turnId: string;
        toolCallId: string;
        decision: "approved" | "rejected";
      }
    >
  | EventBase<"thread.resolved", Record<string, never>>
  | EventBase<"thread.reopened", Record<string, never>>;

export type ClientCommand =
  | {
      readonly type: "app.bootstrap";
      readonly payload: { workspaceId: string; threadId?: string };
    }
  | {
      readonly type: "thread.list";
      readonly payload: { workspaceId: string };
    }
  | {
      readonly type: "thread.create";
      readonly payload: {
        workspaceId: string;
        providerKey: ProviderKey;
        title?: string;
      };
    }
  | {
      readonly type: "thread.open";
      readonly payload: { threadId: string };
    }
  | {
      readonly type: "thread.rename";
      readonly payload: { threadId: string; title: string };
    }
  | {
      readonly type: "thread.delete";
      readonly payload: { threadId: string };
    }
  | {
      readonly type: "thread.sendMessage";
      readonly payload: { threadId: string; content: string };
    }
  | {
      readonly type: "thread.resolve";
      readonly payload: { threadId: string };
    }
  | {
      readonly type: "thread.reopen";
      readonly payload: { threadId: string };
    }
  | {
      readonly type: "thread.stopTurn";
      readonly payload: { threadId: string };
    }
  | {
      readonly type: "thread.retryTurn";
      readonly payload: { threadId: string };
    }
  | {
      readonly type: "thread.resume";
      readonly payload: { threadId: string; afterSequence?: number };
    }
  | {
      readonly type: "tool.approval.respond";
      readonly payload: {
        threadId: string;
        toolCallId: string;
        decision: "approved" | "rejected";
      };
    }
  | {
      readonly type: "provider.auth.read";
      readonly payload: { providerKey: ProviderKey; refreshToken?: boolean };
    }
  | {
      readonly type: "provider.auth.login.start";
      readonly payload: { providerKey: ProviderKey; mode: "chatgpt" };
    }
  | {
      readonly type: "provider.auth.login.cancel";
      readonly payload: { providerKey: ProviderKey; loginId: string };
    }
  | {
      readonly type: "provider.auth.logout";
      readonly payload: { providerKey: ProviderKey };
    };
