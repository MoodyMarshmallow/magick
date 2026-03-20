// Defines the provider runtime interfaces shared by orchestration and provider adapters.

import { Context, type Effect, type Stream } from "effect";

import type {
  ProviderCapabilities,
  ProviderKey,
  ResumeStrategy,
} from "@magick/contracts/provider";
import type {
  ProviderFailureError,
  ProviderUnavailableError,
} from "../effect/errors";

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
  readonly dispose: () => Effect.Effect<void>;
}

export interface ProviderAdapter {
  readonly key: ProviderKey;
  readonly createSession: (
    input: CreateProviderSessionInput,
  ) => Effect.Effect<ProviderSessionHandle, ProviderFailureError>;
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
  readonly get: (
    providerKey: ProviderKey,
  ) => Effect.Effect<ProviderAdapter, ProviderUnavailableError>;
}

export const ProviderRegistry = Context.GenericTag<ProviderRegistryService>(
  "@magick/ProviderRegistry",
);
