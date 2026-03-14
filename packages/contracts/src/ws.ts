import type {
  ClientCommand,
  DomainEvent,
  ThreadSummary,
  ThreadViewModel,
} from "./chat";
import type { ProviderCapabilities } from "./provider";

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
            readonly threadSummaries: readonly ThreadSummary[];
            readonly activeThread: ThreadViewModel | null;
            readonly capabilities: ProviderCapabilities | null;
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
