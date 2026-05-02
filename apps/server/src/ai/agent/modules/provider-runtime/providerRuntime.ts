import type { ProviderKey } from "@magick/contracts/provider";
import { Cause, Effect, Exit, Option, type Stream } from "effect";
import { ProviderFailureError } from "../../shared/errors";
import type {
  ContinueProviderTurnInput,
  GenerateProviderTitleInput,
  InterruptProviderTurnInput,
  ProviderRuntimeInterface,
  StartProviderTurnInput,
} from "./providerRuntimeInterface";
import type {
  ProviderEvent,
  ProviderRegistryService,
  ProviderSessionHandle,
} from "./providerTypes";

const runProviderEffect = async <A>(
  effect: Effect.Effect<A, ProviderFailureError>,
): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    throw failure.value;
  }
  throw new ProviderFailureError({
    providerKey: "unknown",
    code: "provider_runtime_failure",
    detail: "Unhandled provider runtime failure.",
    retryable: false,
  });
};

export class ProviderRuntime implements ProviderRuntimeInterface {
  readonly #providerRegistry: ProviderRegistryService;
  readonly #sessionsByBookmark = new Map<string, ProviderSessionHandle>();

  constructor(args: { readonly providerRegistry: ProviderRegistryService }) {
    this.#providerRegistry = args.providerRegistry;
  }

  async startTurn(
    input: StartProviderTurnInput,
  ): Promise<Stream.Stream<ProviderEvent, ProviderFailureError>> {
    const session = await this.#getOrCreateSession(input);
    return runProviderEffect(
      session.startTurn({
        bookmarkId: input.bookmarkId,
        turnId: input.turnId,
        messageId: input.messageId,
        userMessage: input.userMessage,
        instructions: input.instructions,
        contextMessages: input.historyItems
          .filter((item) => item.type === "message")
          .map((item) => ({
            role: item.role,
            channel: item.channel,
            content: item.content,
            reason: item.reason ?? null,
          })),
        historyItems: input.historyItems,
        tools: input.tools,
      }),
    );
  }

  async continueTurn(
    input: ContinueProviderTurnInput,
  ): Promise<Stream.Stream<ProviderEvent, ProviderFailureError>> {
    const session = this.#sessionsByBookmark.get(input.bookmarkId);
    if (!session) {
      throw new ProviderFailureError({
        providerKey: "unknown",
        code: "provider_session_missing",
        detail: `No provider session for bookmark '${input.bookmarkId}'.`,
        retryable: true,
      });
    }
    return runProviderEffect(
      session.submitToolResults({
        turnId: input.turnId,
        instructions: input.instructions,
        historyItems: input.historyItems,
        tools: input.tools,
        toolResults: input.toolResults,
      }),
    );
  }

  async interruptTurn(input: InterruptProviderTurnInput): Promise<void> {
    const session = this.#sessionsByBookmark.get(input.bookmarkId);
    if (!session) {
      return;
    }
    await runProviderEffect(
      session.interruptTurn({ turnId: input.turnId, reason: input.reason }),
    );
  }

  async generateTitle(
    input: GenerateProviderTitleInput,
  ): Promise<string | null> {
    const adapter = this.#providerRegistry.get(input.providerKey);
    return runProviderEffect(
      adapter.generateBookmarkTitle({
        firstMessage: input.firstMessage,
        instructions: input.instructions,
      }),
    );
  }

  async #getOrCreateSession(input: {
    readonly bookmarkId: string;
    readonly providerKey: ProviderKey;
  }): Promise<ProviderSessionHandle> {
    const existing = this.#sessionsByBookmark.get(input.bookmarkId);
    if (existing) {
      return existing;
    }

    const adapter = this.#providerRegistry.get(input.providerKey);
    const session = await runProviderEffect(
      adapter.createSession({
        workspaceId: "global",
        sessionId: input.bookmarkId,
      }),
    );
    this.#sessionsByBookmark.set(input.bookmarkId, session);
    return session;
  }
}
