import type {
  ProviderCapabilities,
  ProviderKey,
} from "@magick/contracts/provider";
import type { Stream } from "effect";
import type { ProviderFailureError } from "../../shared/errors";
import type {
  ConversationHistoryItem,
  ProviderEvent,
  ProviderToolDefinition,
} from "./providerTypes";

export type ProviderRuntimeEvent = ProviderEvent;
export type ProviderRuntimeToolDefinition = ProviderToolDefinition;

export interface ProviderCatalogEntry {
  readonly key: ProviderKey;
  listCapabilities(): ProviderCapabilities;
}

export interface ProviderCatalogInterface {
  list(): readonly ProviderCatalogEntry[];
}

export interface StartProviderTurnInput {
  readonly bookmarkId: string;
  readonly providerKey: ProviderKey;
  readonly turnId: string;
  readonly messageId: string;
  readonly userMessage: string;
  readonly instructions: string;
  readonly historyItems: readonly ConversationHistoryItem[];
  readonly tools: readonly ProviderToolDefinition[];
}

export interface ContinueProviderTurnInput {
  readonly bookmarkId: string;
  readonly turnId: string;
  readonly instructions: string;
  readonly historyItems: readonly ConversationHistoryItem[];
  readonly tools: readonly ProviderToolDefinition[];
  readonly toolResults: readonly {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly output: string;
  }[];
}

export interface InterruptProviderTurnInput {
  readonly bookmarkId: string;
  readonly turnId: string;
  readonly reason: string;
}

export interface GenerateProviderTitleInput {
  readonly providerKey: ProviderKey;
  readonly firstMessage: string;
  readonly instructions: string;
}

export interface ProviderRuntimeInterface {
  startTurn(
    input: StartProviderTurnInput,
  ): Promise<Stream.Stream<ProviderEvent, ProviderFailureError>>;
  continueTurn(
    input: ContinueProviderTurnInput,
  ): Promise<Stream.Stream<ProviderEvent, ProviderFailureError>>;
  interruptTurn(input: InterruptProviderTurnInput): Promise<void>;
  generateTitle(input: GenerateProviderTitleInput): Promise<string | null>;
}
