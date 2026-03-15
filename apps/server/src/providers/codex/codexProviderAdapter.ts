import { Effect, type Stream } from "effect";

import type { ProviderCapabilities } from "../../../../../packages/contracts/src/provider";
import { ProviderFailureError } from "../../effect/errors";
import type {
  CreateProviderSessionInput,
  InterruptTurnInput,
  ProviderAdapter,
  ProviderEvent,
  ProviderSessionHandle,
  ResumeProviderSessionInput,
  StartTurnInput,
} from "../providerTypes";
import {
  type CodexAppServerClient,
  type CodexClientFactoryOptions,
  createCodexAppServerClient,
} from "./codexAppServerClient";

export interface CodexRuntimeFactory {
  readonly createSession: (
    input: CreateProviderSessionInput,
  ) => Effect.Effect<ProviderSessionHandle, ProviderFailureError>;
  readonly resumeSession: (
    input: ResumeProviderSessionInput,
  ) => Effect.Effect<ProviderSessionHandle, ProviderFailureError>;
}

export interface CodexProviderOptions extends CodexClientFactoryOptions {
  readonly resolveWorkspaceCwd?: (workspaceId: string) => string;
  readonly defaultModel?: string;
  readonly defaultApprovalPolicy?: string;
  readonly defaultSandboxPolicy?:
    | string
    | {
        readonly type: string;
        readonly writableRoots?: readonly string[];
        readonly networkAccess?: boolean;
      };
  readonly defaultPersonality?: "friendly" | "pragmatic" | "none";
}

const toProviderFailure = (code: string, detail: string, retryable = true) =>
  new ProviderFailureError({
    providerKey: "codex",
    code,
    detail,
    retryable,
  });

class CodexSessionHandle implements ProviderSessionHandle {
  readonly sessionId: string;
  readonly providerSessionRef: string | null;
  readonly providerThreadRef: string | null;
  readonly #threadId: string;
  readonly #client: CodexAppServerClient;

  constructor(args: {
    sessionId: string;
    threadId: string;
    client: CodexAppServerClient;
  }) {
    this.sessionId = args.sessionId;
    this.providerSessionRef = args.threadId;
    this.providerThreadRef = args.threadId;
    this.#threadId = args.threadId;
    this.#client = args.client;
  }

  readonly startTurn = (
    input: StartTurnInput,
  ): Effect.Effect<
    Stream.Stream<ProviderEvent, ProviderFailureError>,
    ProviderFailureError
  > =>
    this.#client
      .startTurn(this.#threadId, [
        {
          type: "text",
          text: input.userMessage,
        },
      ])
      .pipe(
        Effect.map(({ turnId }) =>
          this.#client.streamTurn(turnId, input.messageId),
        ),
      );

  readonly interruptTurn = (
    input: InterruptTurnInput,
  ): Effect.Effect<void, ProviderFailureError> =>
    this.#client.interruptTurn(this.#threadId, input.turnId);

  readonly dispose = (): Effect.Effect<void> => this.#client.dispose();
}

export const createCodexRuntimeFactory = (
  options: CodexProviderOptions = {},
): CodexRuntimeFactory => {
  const resolveWorkspaceCwd =
    options.resolveWorkspaceCwd ?? ((workspaceId) => workspaceId);

  const buildThreadParams = (workspaceId: string) => {
    const cwd = resolveWorkspaceCwd(workspaceId);
    return {
      cwd,
      ...(options.defaultModel ? { model: options.defaultModel } : {}),
      ...(options.defaultApprovalPolicy
        ? { approvalPolicy: options.defaultApprovalPolicy }
        : {}),
      ...(options.defaultSandboxPolicy
        ? { sandboxPolicy: options.defaultSandboxPolicy }
        : {}),
      ...(options.defaultPersonality
        ? { personality: options.defaultPersonality }
        : {}),
    } satisfies Record<string, unknown>;
  };

  const createClient = (workspaceId: string) =>
    createCodexAppServerClient({
      ...options,
      cwd: resolveWorkspaceCwd(workspaceId),
    });

  return {
    createSession: (input) =>
      createClient(input.workspaceId).pipe(
        Effect.flatMap((client) =>
          client.startThread(buildThreadParams(input.workspaceId)).pipe(
            Effect.map(
              (threadId) =>
                new CodexSessionHandle({
                  sessionId: input.sessionId,
                  threadId,
                  client,
                }),
            ),
            Effect.catchAll((error) =>
              client.dispose().pipe(Effect.zipRight(Effect.fail(error))),
            ),
          ),
        ),
      ),
    resumeSession: (input) => {
      const threadId = input.providerThreadRef ?? input.providerSessionRef;
      if (!threadId) {
        return Effect.fail(
          toProviderFailure(
            "resume_missing_thread_ref",
            "Cannot resume Codex session without a thread reference.",
            false,
          ),
        );
      }

      return createClient(input.workspaceId).pipe(
        Effect.flatMap((client) =>
          client
            .resumeThread(threadId, buildThreadParams(input.workspaceId))
            .pipe(
              Effect.map(
                (resumedThreadId) =>
                  new CodexSessionHandle({
                    sessionId: input.sessionId,
                    threadId: resumedThreadId,
                    client,
                  }),
              ),
              Effect.catchAll((error) =>
                client.dispose().pipe(Effect.zipRight(Effect.fail(error))),
              ),
            ),
        ),
      );
    },
  };
};

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
