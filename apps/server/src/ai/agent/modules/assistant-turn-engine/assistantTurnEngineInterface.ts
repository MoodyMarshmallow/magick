import type { BranchViewModel } from "@magick/contracts/chat";

export interface BookmarkTurnInput {
  readonly bookmarkId: string;
}

export interface SendMessageInput extends BookmarkTurnInput {
  readonly content: string;
}

export interface AssistantTurnEngineInterface {
  sendMessage(input: SendMessageInput): Promise<BranchViewModel>;
  stopTurn(input: BookmarkTurnInput): Promise<BranchViewModel>;
  retryTurn(input: BookmarkTurnInput): Promise<BranchViewModel>;
}
