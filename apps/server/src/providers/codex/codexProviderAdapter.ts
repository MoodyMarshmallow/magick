import type { Effect } from "effect";
import type { ProviderCapabilities } from "../../../../../packages/contracts/src/provider";
import type { ProviderFailureError } from "../../effect/errors";
import type {
  CreateProviderSessionInput,
  ProviderAdapter,
  ProviderSessionHandle,
  ResumeProviderSessionInput,
} from "../providerTypes";

export interface CodexRuntimeFactory {
  readonly createSession: (
    input: CreateProviderSessionInput,
  ) => Effect.Effect<ProviderSessionHandle, ProviderFailureError>;
  readonly resumeSession: (
    input: ResumeProviderSessionInput,
  ) => Effect.Effect<ProviderSessionHandle, ProviderFailureError>;
}

export class CodexProviderAdapter implements ProviderAdapter {
  readonly key = "codex";
  readonly #runtimeFactory: CodexRuntimeFactory;

  constructor(runtimeFactory: CodexRuntimeFactory) {
    this.#runtimeFactory = runtimeFactory;
  }

  readonly listCapabilities = (): ProviderCapabilities => ({
    supportsNativeResume: true,
    supportsInterrupt: true,
    supportsAttachments: false,
    supportsToolCalls: true,
    supportsApprovals: true,
    supportsServerSideSessions: true,
  });

  readonly getResumeStrategy = () => "native" as const;

  readonly createSession = (input: CreateProviderSessionInput) =>
    this.#runtimeFactory.createSession(input);

  readonly resumeSession = (input: ResumeProviderSessionInput) =>
    this.#runtimeFactory.resumeSession(input);
}
