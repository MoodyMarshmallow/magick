import type {
  ThreadRecord,
  ThreadResolutionState,
  ThreadSummary,
  ThreadViewModel,
} from "@magick/contracts/chat";
import type { ProviderSessionRecord } from "@magick/contracts/provider";
import { maxThreadTitleLength } from "@magick/shared/threadTitle";

import type { ProviderRegistryService } from "../../providers/providerTypes";
import { InvalidStateError, NotFoundError } from "../../runtime/errors";
import type {
  ClockService,
  IdGeneratorService,
  RuntimeStateService,
} from "../../runtime/runtime";
import { fromPromise, fromSync } from "../domain/threadEffect";
import type { EventStore } from "../persistence/eventStore";
import type { ProviderSessionRepository } from "../persistence/providerSessionRepository";
import type { ThreadRepository } from "../persistence/threadRepository";
import type { ProviderSessionRuntimeService } from "../runtime/providerSessionRuntimeService";
import type { ThreadEventPersistence } from "../runtime/threadEventPersistence";

export class ThreadCrudService {
  readonly #providerRegistry: ProviderRegistryService;
  readonly #eventStore: EventStore;
  readonly #threadRepository: ThreadRepository;
  readonly #providerSessionRepository: ProviderSessionRepository;
  readonly #runtimeState: RuntimeStateService;
  readonly #clock: ClockService;
  readonly #idGenerator: IdGeneratorService;
  readonly #eventPersistence: ThreadEventPersistence;
  readonly #runtimeService: ProviderSessionRuntimeService;

  constructor(args: {
    providerRegistry: ProviderRegistryService;
    eventStore: EventStore;
    threadRepository: ThreadRepository;
    providerSessionRepository: ProviderSessionRepository;
    runtimeState: RuntimeStateService;
    clock: ClockService;
    idGenerator: IdGeneratorService;
    eventPersistence: ThreadEventPersistence;
    runtimeService: ProviderSessionRuntimeService;
  }) {
    this.#providerRegistry = args.providerRegistry;
    this.#eventStore = args.eventStore;
    this.#threadRepository = args.threadRepository;
    this.#providerSessionRepository = args.providerSessionRepository;
    this.#runtimeState = args.runtimeState;
    this.#clock = args.clock;
    this.#idGenerator = args.idGenerator;
    this.#eventPersistence = args.eventPersistence;
    this.#runtimeService = args.runtimeService;
  }

  readonly normalizeThreadTitle = (title: string, fallback?: string) => {
    const normalized = title.trim();
    if (normalized.length === 0) {
      if (fallback) {
        return fallback;
      }

      throw new InvalidStateError({
        code: "thread_title_invalid",
        detail: "Thread title must not be empty.",
      });
    }

    if (normalized.length > maxThreadTitleLength) {
      throw new InvalidStateError({
        code: "thread_title_too_long",
        detail: `Thread title must be ${maxThreadTitleLength} characters or fewer.`,
      });
    }

    return normalized;
  };

  readonly requireThread = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadCrudService) {
        const thread = yield* fromSync(() =>
          this.#threadRepository.get(threadId),
        );
        if (!thread) {
          return yield* Effect.fail(
            new NotFoundError({ entity: "thread", id: threadId }),
          );
        }

        return thread;
      }.bind(this),
    );

  readonly openThreadEffect = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadCrudService) {
        const snapshot = yield* fromSync(() =>
          this.#threadRepository.getSnapshot(threadId),
        );
        if (!snapshot) {
          return yield* Effect.fail(
            new NotFoundError({ entity: "thread", id: threadId }),
          );
        }

        return snapshot;
      }.bind(this),
    );

  readonly createThreadEffect = (input: {
    readonly workspaceId: string;
    readonly providerKey: string;
    readonly title?: string;
  }) =>
    Effect.gen(
      function* (this: ThreadCrudService) {
        const adapter = yield* fromSync(() =>
          this.#providerRegistry.get(input.providerKey),
        );
        const now = this.#clock.now();
        const providerSessionId = this.#idGenerator.next("session");
        const threadId = this.#idGenerator.next("thread");

        const sessionRecord: ProviderSessionRecord = {
          id: providerSessionId,
          providerKey: input.providerKey,
          workspaceId: input.workspaceId,
          status: "active",
          providerSessionRef: null,
          providerThreadRef: null,
          capabilities: adapter.listCapabilities(),
          createdAt: now,
          updatedAt: now,
        };
        yield* fromSync(() =>
          this.#providerSessionRepository.create(sessionRecord),
        );

        const threadRecord: ThreadRecord = {
          id: threadId,
          workspaceId: input.workspaceId,
          providerKey: input.providerKey,
          providerSessionId,
          title: this.normalizeThreadTitle(input.title ?? "", "New chat"),
          resolutionState: "open",
          createdAt: now,
          updatedAt: now,
        };
        yield* fromSync(() => this.#threadRepository.create(threadRecord));

        const created = yield* this.#eventPersistence.persistAndProject(
          threadId,
          [
            {
              eventId: this.#idGenerator.next("event"),
              threadId,
              providerSessionId,
              occurredAt: now,
              type: "thread.created",
              payload: {
                workspaceId: input.workspaceId,
                providerKey: input.providerKey,
                title: threadRecord.title,
              },
            },
            {
              eventId: this.#idGenerator.next("event"),
              threadId,
              providerSessionId,
              occurredAt: now,
              type: "provider.session.started",
              payload: {
                providerKey: input.providerKey,
                resumeStrategy: adapter.getResumeStrategy(),
              },
            },
          ],
        );

        return created.thread;
      }.bind(this),
    );

  readonly renameThreadEffect = (threadId: string, title: string) =>
    Effect.gen(
      function* (this: ThreadCrudService) {
        const thread = yield* this.requireThread(threadId);
        const normalizedTitle = this.normalizeThreadTitle(title);
        if (thread.title === normalizedTitle) {
          return yield* this.openThreadEffect(threadId);
        }

        const occurredAt = this.#clock.now();
        yield* fromSync(() =>
          this.#threadRepository.updateTitle(
            threadId,
            normalizedTitle,
            occurredAt,
          ),
        );

        const projected = yield* this.#eventPersistence.persistAndProject(
          threadId,
          [
            {
              eventId: this.#idGenerator.next("event"),
              threadId,
              providerSessionId: thread.providerSessionId,
              occurredAt,
              type: "thread.renamed",
              payload: {
                title: normalizedTitle,
              },
            },
          ],
        );

        return projected.thread;
      }.bind(this),
    );

  readonly deleteThreadEffect = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadCrudService) {
        const thread = yield* this.requireThread(threadId);
        const activeTurn = this.#runtimeState.getActiveTurn(threadId);
        if (activeTurn) {
          return yield* Effect.fail(
            new InvalidStateError({
              code: "thread_delete_while_running",
              detail: `Thread '${threadId}' cannot be deleted while a turn is running.`,
            }),
          );
        }

        const sessionRuntime = this.#runtimeState.getSessionRuntime(
          thread.providerSessionId,
        );
        if (sessionRuntime) {
          yield* sessionRuntime.session.dispose();
          yield* Effect.sync(() =>
            this.#runtimeState.clearSessionRuntime(thread.providerSessionId),
          );
        }

        yield* fromSync(() => this.#eventStore.deleteThreadEvents(threadId));
        yield* fromSync(() => this.#threadRepository.delete(threadId));
        yield* fromSync(() =>
          this.#providerSessionRepository.delete(thread.providerSessionId),
        );

        return {
          threadId,
          workspaceId: thread.workspaceId,
        } as const;
      }.bind(this),
    );

  readonly setThreadResolutionStateEffect = (
    threadId: string,
    resolutionState: ThreadResolutionState,
  ) =>
    Effect.gen(
      function* (this: ThreadCrudService) {
        const thread = yield* this.openThreadEffect(threadId);
        if (thread.resolutionState === resolutionState) {
          return thread;
        }

        const occurredAt = this.#clock.now();
        const record = yield* this.requireThread(threadId);
        yield* fromSync(() =>
          this.#threadRepository.updateResolutionState(
            threadId,
            resolutionState,
            occurredAt,
          ),
        );

        const projected = yield* this.#eventPersistence.persistAndProject(
          threadId,
          [
            {
              eventId: this.#idGenerator.next("event"),
              threadId,
              providerSessionId: record.providerSessionId,
              occurredAt,
              type:
                resolutionState === "resolved"
                  ? "thread.resolved"
                  : "thread.reopened",
              payload: {},
            },
          ],
        );

        return projected.thread;
      }.bind(this),
    );

  readonly ensureSessionEffect = (threadId: string) =>
    Effect.gen(
      function* (this: ThreadCrudService) {
        const thread = yield* this.requireThread(threadId);
        yield* this.#runtimeService.getOrCreateSessionRuntime(thread);
        return yield* this.openThreadEffect(threadId);
      }.bind(this),
    );

  readonly listThreads = async (
    workspaceId: string,
  ): Promise<readonly ThreadSummary[]> =>
    this.#threadRepository.listByWorkspace(workspaceId);
}

import { Effect } from "effect";
