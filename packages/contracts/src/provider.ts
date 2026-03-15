export type ProviderKey = "codex" | string;

export type ResumeStrategy = "native" | "rebuild";

export interface ProviderCapabilities {
  readonly supportsNativeResume: boolean;
  readonly supportsInterrupt: boolean;
  readonly supportsAttachments: boolean;
  readonly supportsToolCalls: boolean;
  readonly supportsApprovals: boolean;
  readonly supportsServerSideSessions: boolean;
}

export interface ProviderSessionRecord {
  readonly id: string;
  readonly providerKey: ProviderKey;
  readonly workspaceId: string;
  readonly status: "active" | "disconnected" | "disposed";
  readonly providerSessionRef: string | null;
  readonly providerThreadRef: string | null;
  readonly capabilities: ProviderCapabilities;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ProviderAuthAccount =
  | {
      readonly type: "apiKey";
    }
  | {
      readonly type: "chatgpt";
      readonly email: string | null;
      readonly planType: string | null;
    };

export interface ProviderAuthState {
  readonly providerKey: ProviderKey;
  readonly requiresOpenaiAuth: boolean;
  readonly account: ProviderAuthAccount | null;
  readonly activeLoginId: string | null;
}

export interface ProviderAuthLoginStartResult {
  readonly providerKey: ProviderKey;
  readonly loginId: string;
  readonly authUrl: string;
}
