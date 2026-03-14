import type { DomainEvent } from "../../../../packages/contracts/src/chat";
import type {
  ProviderCapabilities,
  ProviderKey,
  ResumeStrategy,
} from "../../../../packages/contracts/src/provider";

export interface ProviderError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ConversationContextMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface CreateProviderSessionInput {
  readonly workspaceId: string;
  readonly sessionId: string;
}

export interface ResumeProviderSessionInput extends CreateProviderSessionInput {
  readonly providerSessionRef: string | null;
  readonly providerThreadRef: string | null;
}

export interface StartTurnInput {
  readonly threadId: string;
  readonly turnId: string;
  readonly messageId: string;
  readonly userMessage: string;
  readonly contextMessages: readonly ConversationContextMessage[];
}

export interface InterruptTurnInput {
  readonly turnId: string;
  readonly reason: string;
}

export type ProviderEvent =
  | {
      readonly type: "output.delta";
      readonly turnId: string;
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: "output.completed";
      readonly turnId: string;
      readonly messageId: string;
    }
  | {
      readonly type: "turn.failed";
      readonly turnId: string;
      readonly error: string;
    }
  | {
      readonly type: "session.disconnected";
      readonly reason: string;
    }
  | {
      readonly type: "session.recovered";
      readonly reason: string;
    };

export interface ProviderTurnHandle {
  readonly turnId: string;
  events(): AsyncIterable<ProviderEvent>;
}

export interface ProviderSessionHandle {
  readonly sessionId: string;
  readonly providerSessionRef: string | null;
  readonly providerThreadRef: string | null;
  startTurn(input: StartTurnInput): Promise<ProviderTurnHandle>;
  interruptTurn(input: InterruptTurnInput): Promise<void>;
  dispose(): Promise<void>;
}

export interface ProviderAdapter {
  readonly key: ProviderKey;
  createSession(
    input: CreateProviderSessionInput,
  ): Promise<ProviderSessionHandle>;
  resumeSession(
    input: ResumeProviderSessionInput,
  ): Promise<ProviderSessionHandle>;
  listCapabilities(): ProviderCapabilities;
  getResumeStrategy(): ResumeStrategy;
  normalizeError(error: unknown): ProviderError;
}

export interface ProviderSessionRuntime {
  readonly recordId: string;
  readonly session: ProviderSessionHandle;
  readonly adapter: ProviderAdapter;
}

export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}
