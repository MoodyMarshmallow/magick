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
