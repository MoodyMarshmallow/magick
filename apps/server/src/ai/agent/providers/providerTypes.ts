// Defines the provider runtime interfaces shared by orchestration and provider adapters.

import type { Effect, Stream } from "effect";

import type {
  AssistantCompletionReason,
  AssistantOutputChannel,
} from "@magick/contracts/chat";
import type {
  ProviderCapabilities,
  ProviderKey,
  ResumeStrategy,
} from "@magick/contracts/provider";
import type {
  ProviderFailureError,
  ProviderUnavailableError,
} from "../runtime/errors";

export interface ConversationContextMessage {
  readonly role: "user" | "assistant";
  readonly channel: AssistantOutputChannel | null;
  readonly content: string;
  readonly reason?: AssistantCompletionReason | null;
}

export type ConversationHistoryItem =
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
  readonly instructions: string;
  readonly contextMessages: readonly ConversationContextMessage[];
  readonly historyItems: readonly ConversationHistoryItem[];
  readonly tools: readonly ProviderToolDefinition[];
}

export interface ProviderToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface ProviderToolResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: string;
}

export interface SubmitToolResultsInput {
  readonly turnId: string;
  readonly toolResults: readonly ProviderToolResult[];
  readonly instructions: string;
  readonly historyItems: readonly ConversationHistoryItem[];
  readonly tools: readonly ProviderToolDefinition[];
}

export interface GenerateThreadTitleInput {
  readonly firstMessage: string;
  readonly instructions: string;
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
      readonly channel: AssistantOutputChannel;
      readonly delta: string;
    }
  | {
      readonly type: "output.message.completed";
      readonly turnId: string;
      readonly messageId: string;
      readonly channel: AssistantOutputChannel;
      readonly reason: AssistantCompletionReason;
    }
  | {
      readonly type: "turn.completed";
      readonly turnId: string;
    }
  | {
      readonly type: "tool.call.requested";
      readonly turnId: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: unknown;
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

export interface ProviderSessionHandle {
  readonly sessionId: string;
  readonly providerSessionRef: string | null;
  readonly providerThreadRef: string | null;
  readonly startTurn: (
    input: StartTurnInput,
  ) => Effect.Effect<
    Stream.Stream<ProviderEvent, ProviderFailureError>,
    ProviderFailureError
  >;
  readonly interruptTurn: (
    input: InterruptTurnInput,
  ) => Effect.Effect<void, ProviderFailureError>;
  readonly submitToolResults: (
    input: SubmitToolResultsInput,
  ) => Effect.Effect<
    Stream.Stream<ProviderEvent, ProviderFailureError>,
    ProviderFailureError
  >;
  readonly dispose: () => Effect.Effect<void>;
}

export interface ProviderAdapter {
  readonly key: ProviderKey;
  readonly createSession: (
    input: CreateProviderSessionInput,
  ) => Effect.Effect<ProviderSessionHandle, ProviderFailureError>;
  readonly generateThreadTitle: (
    input: GenerateThreadTitleInput,
  ) => Effect.Effect<string | null, ProviderFailureError>;
  readonly resumeSession: (
    input: ResumeProviderSessionInput,
  ) => Effect.Effect<ProviderSessionHandle, ProviderFailureError>;
  readonly listCapabilities: () => ProviderCapabilities;
  readonly getResumeStrategy: () => ResumeStrategy;
}

export interface ProviderSessionRuntime {
  readonly recordId: string;
  readonly session: ProviderSessionHandle;
  readonly adapter: ProviderAdapter;
}

export interface ProviderRegistryService {
  readonly get: (providerKey: ProviderKey) => ProviderAdapter;
  readonly list: () => readonly ProviderAdapter[];
}
