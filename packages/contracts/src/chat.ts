import type { ProviderKey, ResumeStrategy } from "./provider";

export type ThreadStatus = "idle" | "running" | "interrupted" | "failed";

export interface ThreadRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly providerKey: ProviderKey;
  readonly providerSessionId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TranscriptMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly status: "streaming" | "complete" | "interrupted" | "failed";
}

export interface ThreadViewModel {
  readonly threadId: string;
  readonly workspaceId: string;
  readonly providerKey: ProviderKey;
  readonly providerSessionId: string;
  readonly title: string;
  readonly status: ThreadStatus;
  readonly messages: readonly TranscriptMessage[];
  readonly activeTurnId: string | null;
  readonly latestSequence: number;
  readonly lastError: string | null;
  readonly lastUserMessageAt: string | null;
  readonly lastAssistantMessageAt: string | null;
  readonly updatedAt: string;
}

export interface ThreadSummary {
  readonly threadId: string;
  readonly workspaceId: string;
  readonly providerKey: ProviderKey;
  readonly title: string;
  readonly status: ThreadStatus;
  readonly latestSequence: number;
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
      "turn.delta",
      { turnId: string; messageId: string; delta: string }
    >
  | EventBase<"turn.completed", { turnId: string; messageId: string }>
  | EventBase<"turn.interrupted", { turnId: string; reason: string }>
  | EventBase<"turn.failed", { turnId: string; error: string }>;

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
      readonly type: "thread.sendMessage";
      readonly payload: { threadId: string; content: string };
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
