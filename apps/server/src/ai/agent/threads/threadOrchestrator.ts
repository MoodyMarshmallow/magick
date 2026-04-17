// Coordinates thread lifecycle by composing focused thread services behind one API.

import type { ThreadSummary, ThreadViewModel } from "@magick/contracts/chat";
import type { DocumentService } from "../../../editor/documents/documentService";
import type { WorkspaceQueryService } from "../../../editor/workspace/workspaceQueryService";
import type { ProviderRegistryService } from "../providers/providerTypes";
import type { BackendError } from "../runtime/errors";
import type {
  ClockService,
  EventPublisherService,
  IdGeneratorService,
  RuntimeStateService,
} from "../runtime/runtime";
import type { ToolExecutor } from "../tools/toolExecutor";
import type { WebContentService } from "../tools/webContentService";
import { runThreadEffect } from "./domain/threadEffect";
import { ThreadHistoryBuilder } from "./domain/threadHistoryBuilder";
import { ThreadCrudService } from "./lifecycle/threadCrudService";
import type { EventStore } from "./persistence/eventStore";
import type { ProviderSessionRepository } from "./persistence/providerSessionRepository";
import type { ThreadRepository } from "./persistence/threadRepository";
import { ProviderSessionRuntimeService } from "./runtime/providerSessionRuntimeService";
import { ThreadAutoTitleService } from "./runtime/threadAutoTitleService";
import { ThreadEventPersistence } from "./runtime/threadEventPersistence";
import { ThreadTurnRunner } from "./runtime/threadTurnRunner";

export interface CreateThreadInput {
  readonly workspaceId: string;
  readonly providerKey: string;
  readonly title?: string;
}

export interface ThreadOrchestratorApi {
  readonly createThread: (input: CreateThreadInput) => Promise<ThreadViewModel>;
  readonly listThreads: (
    workspaceId: string,
  ) => Promise<readonly ThreadSummary[]>;
  readonly openThread: (threadId: string) => Promise<ThreadViewModel>;
  readonly renameThread: (
    threadId: string,
    title: string,
  ) => Promise<ThreadViewModel>;
  readonly deleteThread: (
    threadId: string,
  ) => Promise<{ readonly threadId: string; readonly workspaceId: string }>;
  readonly sendMessage: (
    threadId: string,
    content: string,
  ) => import("effect").Effect.Effect<ThreadViewModel, BackendError>;
  readonly stopTurn: (
    threadId: string,
  ) => import("effect").Effect.Effect<ThreadViewModel, BackendError>;
  readonly resolveThread: (threadId: string) => Promise<ThreadViewModel>;
  readonly reopenThread: (threadId: string) => Promise<ThreadViewModel>;
  readonly retryTurn: (
    threadId: string,
  ) => import("effect").Effect.Effect<ThreadViewModel, BackendError>;
  readonly ensureSession: (threadId: string) => Promise<ThreadViewModel>;
}

export class ThreadOrchestrator implements ThreadOrchestratorApi {
  readonly #crudService: ThreadCrudService;
  readonly #turnRunner: ThreadTurnRunner;

  constructor(args: {
    providerRegistry: ProviderRegistryService;
    eventStore: EventStore;
    threadRepository: ThreadRepository;
    providerSessionRepository: ProviderSessionRepository;
    publisher: EventPublisherService;
    runtimeState: RuntimeStateService;
    clock: ClockService;
    idGenerator: IdGeneratorService;
    toolExecutor: ToolExecutor;
    documents: DocumentService;
    workspaceQuery: WorkspaceQueryService;
    webContent: WebContentService;
  }) {
    const historyBuilder = new ThreadHistoryBuilder({
      eventStore: args.eventStore,
    });
    const eventPersistence = new ThreadEventPersistence({
      eventStore: args.eventStore,
      threadRepository: args.threadRepository,
      providerSessionRepository: args.providerSessionRepository,
      publisher: args.publisher,
      clock: args.clock,
      idGenerator: args.idGenerator,
    });
    const runtimeService = new ProviderSessionRuntimeService({
      providerRegistry: args.providerRegistry,
      providerSessionRepository: args.providerSessionRepository,
      runtimeState: args.runtimeState,
      clock: args.clock,
    });

    this.#crudService = new ThreadCrudService({
      providerRegistry: args.providerRegistry,
      eventStore: args.eventStore,
      threadRepository: args.threadRepository,
      providerSessionRepository: args.providerSessionRepository,
      runtimeState: args.runtimeState,
      clock: args.clock,
      idGenerator: args.idGenerator,
      eventPersistence,
      runtimeService,
    });

    const autoTitleService = new ThreadAutoTitleService({
      providerRegistry: args.providerRegistry,
      renameThread: (threadId, title) => this.renameThread(threadId, title),
    });

    this.#turnRunner = new ThreadTurnRunner({
      runtimeState: args.runtimeState,
      clock: args.clock,
      idGenerator: args.idGenerator,
      toolExecutor: args.toolExecutor,
      documents: args.documents,
      workspaceQuery: args.workspaceQuery,
      webContent: args.webContent,
      historyBuilder,
      eventPersistence,
      runtimeService,
      crudService: this.#crudService,
      autoTitleService,
    });
  }

  readonly createThread = (input: CreateThreadInput) =>
    runThreadEffect(this.#crudService.createThreadEffect(input));

  readonly listThreads = (workspaceId: string) =>
    this.#crudService.listThreads(workspaceId);

  readonly openThread = (threadId: string) =>
    runThreadEffect(this.#crudService.openThreadEffect(threadId));

  readonly renameThread = (threadId: string, title: string) =>
    runThreadEffect(this.#crudService.renameThreadEffect(threadId, title));

  readonly deleteThread = (threadId: string) =>
    runThreadEffect(this.#crudService.deleteThreadEffect(threadId));

  readonly sendMessage = (threadId: string, content: string) =>
    this.#turnRunner.sendMessage(threadId, content);

  readonly stopTurn = (threadId: string) => this.#turnRunner.stopTurn(threadId);

  readonly resolveThread = (threadId: string) =>
    runThreadEffect(
      this.#crudService.setThreadResolutionStateEffect(threadId, "resolved"),
    );

  readonly reopenThread = (threadId: string) =>
    runThreadEffect(
      this.#crudService.setThreadResolutionStateEffect(threadId, "open"),
    );

  readonly retryTurn = (threadId: string) =>
    this.#turnRunner.retryTurn(threadId);

  readonly ensureSession = (threadId: string) =>
    runThreadEffect(this.#crudService.ensureSessionEffect(threadId));
}
