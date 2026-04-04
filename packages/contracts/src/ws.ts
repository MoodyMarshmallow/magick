// Defines the websocket request, response, and push message contracts.

import type {
  ClientCommand,
  DomainEvent,
  ThreadSummary,
  ThreadViewModel,
} from "./chat";
import type {
  ProviderAuthLoginStartResult,
  ProviderAuthState,
  ProviderCapabilities,
  ProviderKey,
} from "./provider";

export interface AppBootstrapData {
  readonly threadSummaries: readonly ThreadSummary[];
  readonly activeThread: ThreadViewModel | null;
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
            readonly kind: "threadList";
            readonly threadSummaries: readonly ThreadSummary[];
          }
        | {
            readonly kind: "threadState";
            readonly thread: ThreadViewModel;
            readonly replayedEvents?: readonly DomainEvent[];
          }
        | {
            readonly kind: "accepted";
            readonly threadId: string;
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
      readonly channel: "orchestration.domainEvent";
      readonly threadId: string;
      readonly event: DomainEvent;
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
      readonly threadId: string;
      readonly latestSequence: number;
    };
