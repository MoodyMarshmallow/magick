import type { ProviderCapabilities } from "../../../../../packages/contracts/src/provider";
import type {
  CreateProviderSessionInput,
  ProviderAdapter,
  ProviderError,
  ProviderSessionHandle,
  ResumeProviderSessionInput,
} from "../providerTypes";

export interface CodexRuntimeFactory {
  createSession(
    input: CreateProviderSessionInput,
  ): Promise<ProviderSessionHandle>;
  resumeSession(
    input: ResumeProviderSessionInput,
  ): Promise<ProviderSessionHandle>;
}

export class CodexProviderAdapter implements ProviderAdapter {
  readonly key = "codex";
  readonly #runtimeFactory: CodexRuntimeFactory;

  constructor(runtimeFactory: CodexRuntimeFactory) {
    this.#runtimeFactory = runtimeFactory;
  }

  listCapabilities(): ProviderCapabilities {
    return {
      supportsNativeResume: true,
      supportsInterrupt: true,
      supportsAttachments: false,
      supportsToolCalls: true,
      supportsApprovals: true,
      supportsServerSideSessions: true,
    };
  }

  getResumeStrategy() {
    return "native" as const;
  }

  async createSession(
    input: CreateProviderSessionInput,
  ): Promise<ProviderSessionHandle> {
    return this.#runtimeFactory.createSession(input);
  }

  async resumeSession(
    input: ResumeProviderSessionInput,
  ): Promise<ProviderSessionHandle> {
    return this.#runtimeFactory.resumeSession(input);
  }

  normalizeError(error: unknown): ProviderError {
    return {
      code: "codex_provider_error",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}
