import { Effect } from "effect";

import type { ThreadRecord } from "@magick/contracts/chat";

import type {
  ProviderRegistryService,
  ProviderSessionRuntime,
} from "../../providers/providerTypes";
import { NotFoundError } from "../../runtime/errors";
import type { RuntimeStateService } from "../../runtime/runtime";
import { fromSync } from "../domain/threadEffect";
import type { ProviderSessionRepository } from "../persistence/providerSessionRepository";

export class ProviderSessionRuntimeService {
  readonly #providerRegistry: ProviderRegistryService;
  readonly #providerSessionRepository: ProviderSessionRepository;
  readonly #runtimeState: RuntimeStateService;
  readonly #clock: { readonly now: () => string };

  constructor(args: {
    providerRegistry: ProviderRegistryService;
    providerSessionRepository: ProviderSessionRepository;
    runtimeState: RuntimeStateService;
    clock: { readonly now: () => string };
  }) {
    this.#providerRegistry = args.providerRegistry;
    this.#providerSessionRepository = args.providerSessionRepository;
    this.#runtimeState = args.runtimeState;
    this.#clock = args.clock;
  }

  readonly getOrCreateSessionRuntime = (thread: ThreadRecord) =>
    Effect.gen(
      function* (this: ProviderSessionRuntimeService) {
        const sessionRecord = yield* fromSync(() =>
          this.#providerSessionRepository.get(thread.providerSessionId),
        );
        if (!sessionRecord) {
          return yield* Effect.fail(
            new NotFoundError({
              entity: "provider_session",
              id: thread.providerSessionId,
            }),
          );
        }

        const cached = this.#runtimeState.getSessionRuntime(sessionRecord.id);
        if (cached && sessionRecord.status === "active") {
          return cached;
        }

        if (cached) {
          this.#runtimeState.clearSessionRuntime(sessionRecord.id);
        }

        const adapter = yield* fromSync(() =>
          this.#providerRegistry.get(thread.providerKey),
        );

        const session = sessionRecord.providerSessionRef
          ? yield* adapter.resumeSession({
              workspaceId: thread.workspaceId,
              sessionId: sessionRecord.id,
              providerSessionRef: sessionRecord.providerSessionRef,
              providerThreadRef: sessionRecord.providerThreadRef,
            })
          : yield* adapter.createSession({
              workspaceId: thread.workspaceId,
              sessionId: sessionRecord.id,
            });

        const runtime: ProviderSessionRuntime = {
          recordId: sessionRecord.id,
          session,
          adapter,
        };

        if (
          session.providerSessionRef !== sessionRecord.providerSessionRef ||
          session.providerThreadRef !== sessionRecord.providerThreadRef
        ) {
          yield* fromSync(() =>
            this.#providerSessionRepository.updateRefs(sessionRecord.id, {
              providerSessionRef: session.providerSessionRef,
              providerThreadRef: session.providerThreadRef,
              updatedAt: this.#clock.now(),
            }),
          );
        }

        this.#runtimeState.setSessionRuntime(sessionRecord.id, runtime);
        return runtime;
      }.bind(this),
    );
}
