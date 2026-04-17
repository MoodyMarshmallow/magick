import type { ThreadRecord, ThreadViewModel } from "@magick/contracts/chat";

import { DEFAULT_THREAD_TITLE_INSTRUCTIONS } from "../../providers/providerPrompts";
import type { ProviderRegistryService } from "../../providers/providerTypes";
import { backendErrorMessage } from "../../runtime/errors";
import { fromPromise, fromSync } from "../domain/threadEffect";

export class ThreadAutoTitleService {
  readonly #providerRegistry: ProviderRegistryService;
  readonly #renameThread: (
    threadId: string,
    title: string,
  ) => Promise<ThreadViewModel>;

  constructor(args: {
    providerRegistry: ProviderRegistryService;
    renameThread: (threadId: string, title: string) => Promise<ThreadViewModel>;
  }) {
    this.#providerRegistry = args.providerRegistry;
    this.#renameThread = args.renameThread;
  }

  readonly shouldAutoNameThread = (args: {
    readonly thread: ThreadRecord;
    readonly snapshot: ThreadViewModel;
  }): boolean => {
    if (args.thread.title !== "New chat") {
      return false;
    }

    return !args.snapshot.messages.some((message) => message.role === "user");
  };

  readonly autoNameThreadFromFirstMessage = (args: {
    readonly thread: ThreadRecord;
    readonly content: string;
  }): Effect.Effect<void, never> =>
    Effect.gen(
      function* (this: ThreadAutoTitleService) {
        const adapter = yield* fromSync(() =>
          this.#providerRegistry.get(args.thread.providerKey),
        ).pipe(
          Effect.catchAll((error) => {
            console.warn("Failed to load provider for thread auto-naming.", {
              threadId: args.thread.id,
              providerKey: args.thread.providerKey,
              error: backendErrorMessage(error),
            });
            return Effect.succeed(null);
          }),
        );
        if (!adapter) {
          return;
        }

        const generatedTitle = yield* adapter
          .generateThreadTitle({
            firstMessage: args.content,
            instructions: DEFAULT_THREAD_TITLE_INSTRUCTIONS,
          })
          .pipe(
            Effect.catchAll((error) => {
              console.warn("Provider thread auto-naming failed.", {
                threadId: args.thread.id,
                providerKey: args.thread.providerKey,
                error: backendErrorMessage(error),
              });
              return Effect.succeed(null);
            }),
          );
        if (!generatedTitle?.trim()) {
          return;
        }

        yield* fromPromise(() =>
          this.#renameThread(args.thread.id, generatedTitle),
        ).pipe(
          Effect.catchAll((error) => {
            console.warn("Failed to persist auto-generated thread title.", {
              threadId: args.thread.id,
              providerKey: args.thread.providerKey,
              error: backendErrorMessage(error),
            });
            return Effect.void;
          }),
        );
      }.bind(this),
    ).pipe(Effect.asVoid);
}

import { Effect } from "effect";
