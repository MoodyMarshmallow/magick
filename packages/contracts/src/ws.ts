// Defines the websocket request, response, and push message contracts.

import type {
  BookmarkSummary,
  BranchUpdate,
  BranchViewModel,
  ClientCommand,
} from "./chat";
import type {
  ProviderAuthLoginStartResult,
  ProviderAuthState,
  ProviderCapabilities,
  ProviderKey,
} from "./provider";

export interface AppBootstrapData {
  readonly bookmarkSummaries: readonly BookmarkSummary[];
  readonly activeBranch: BranchViewModel | null;
  readonly providerAuth: Readonly<Record<ProviderKey, ProviderAuthState>>;
  readonly providerCapabilities: Readonly<
    Record<ProviderKey, ProviderCapabilities>
  >;
}

export interface CommandEnvelope {
  readonly requestId: string;
  readonly command: ClientCommand;
}

export type CommandResult =
  | {
      readonly ok: true;
      readonly data:
        | {
            readonly kind: "bootstrap";
            readonly bootstrap: AppBootstrapData;
          }
        | {
            readonly kind: "bookmarkList";
            readonly bookmarkSummaries: readonly BookmarkSummary[];
          }
        | {
            readonly kind: "branchState";
            readonly branch: BranchViewModel;
          }
        | {
            readonly kind: "accepted";
            readonly bookmarkId: string;
          }
        | {
            readonly kind: "bookmarkDeleted";
            readonly bookmarkId: string;
          }
        | {
            readonly kind: "providerAuthState";
            readonly auth: ProviderAuthState;
          }
        | {
            readonly kind: "providerAuthLoginStart";
            readonly auth: ProviderAuthLoginStartResult;
          };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

export interface CommandResponseEnvelope {
  readonly requestId: string;
  readonly result: CommandResult;
}

export type ServerPushEnvelope =
  | {
      readonly channel: "branch.updated";
      readonly bookmarkId: string;
      readonly update: BranchUpdate;
    }
  | {
      readonly channel: "bookmark.deleted";
      readonly bookmarkId: string;
    }
  | {
      readonly channel: "provider.authStateChanged";
      readonly auth: ProviderAuthState;
    }
  | {
      readonly channel: "transport.connectionState";
      readonly state:
        | "connecting"
        | "connected"
        | "reconnecting"
        | "replaying"
        | "degraded"
        | "disconnected";
      readonly detail: string;
    }
  | {
      readonly channel: "transport.replayRequired";
      readonly bookmarkId: string;
    };
