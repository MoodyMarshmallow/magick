import type {
  AssistantCompletionReason,
  AssistantOutputChannel,
  BookmarkSummary,
  BranchRuntimeState,
  BranchViewModel,
  ProviderPayloadItem,
  ToolActivityView,
} from "@magick/contracts/chat";
import type { ProviderKey } from "@magick/contracts/provider";

export interface ProviderPayload {
  readonly instructions: string;
  readonly historyItems: readonly ProviderPayloadItem[];
}

export interface CreateBookmarkInput {
  readonly providerKey: ProviderKey;
  readonly title?: string;
}

export interface BookmarkInput {
  readonly bookmarkId: string;
}

export interface RenameBookmarkInput extends BookmarkInput {
  readonly title: string;
}

export interface AppendUserMessageInput extends BookmarkInput {
  readonly messageId: string;
  readonly content: string;
}

export interface BeginAssistantMessageInput extends BookmarkInput {
  readonly turnId: string;
  readonly messageId: string;
  readonly channel: AssistantOutputChannel;
}

export interface AppendAssistantDeltaInput extends BookmarkInput {
  readonly messageId: string;
  readonly delta: string;
}

export interface CompleteAssistantMessageInput extends BookmarkInput {
  readonly messageId: string;
  readonly reason: AssistantCompletionReason;
}

export interface AppendToolCallInput extends BookmarkInput {
  readonly turnId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly title: string;
  readonly argsPreview: string | null;
  readonly input: unknown;
  readonly path: string | null;
  readonly url: string | null;
}

export interface AppendToolResultInput extends BookmarkInput {
  readonly turnId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: "completed" | "failed";
  readonly resultPreview: string | null;
  readonly modelOutput: string;
  readonly path: string | null;
  readonly url: string | null;
  readonly diff: ToolActivityView["diff"];
  readonly error: string | null;
}

export interface SetBookmarkRuntimeStateInput extends BookmarkInput {
  readonly runtimeState: BranchRuntimeState;
  readonly activeTurnId: string | null;
  readonly lastError?: string | null;
}

export interface ContextCoreInterface {
  bootstrap(input: { readonly instructions: string }): void;
  listBookmarks(): readonly BookmarkSummary[];
  createBookmark(input: CreateBookmarkInput): BranchViewModel;
  selectBookmark(input: BookmarkInput): BranchViewModel;
  renameBookmark(input: RenameBookmarkInput): BranchViewModel;
  deleteBookmark(input: BookmarkInput): void;
  appendUserMessage(input: AppendUserMessageInput): BranchViewModel;
  beginAssistantMessage(input: BeginAssistantMessageInput): BranchViewModel;
  appendAssistantDelta(input: AppendAssistantDeltaInput): BranchViewModel;
  completeAssistantMessage(
    input: CompleteAssistantMessageInput,
  ): BranchViewModel;
  appendToolCall(input: AppendToolCallInput): BranchViewModel;
  appendToolResult(input: AppendToolResultInput): BranchViewModel;
  setBookmarkRuntimeState(input: SetBookmarkRuntimeStateInput): BranchViewModel;
  buildBranchView(input: BookmarkInput): BranchViewModel;
  buildProviderPayload(input: BookmarkInput): ProviderPayload;
}
