import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import type { ThreadViewModel } from "@magick/contracts/chat";
import { DocumentService } from "../../../../editor/documents/documentService";
import { PathPresentationPolicy } from "../../../../editor/workspace/pathPresentationPolicy";
import { WorkspacePathPolicy } from "../../../../editor/workspace/workspacePathPolicy";
import { WorkspaceQueryService } from "../../../../editor/workspace/workspaceQueryService";
import { createDatabase } from "../../../../persistence/database";
import { FakeProviderAdapter } from "../../providers/fake/fakeProviderAdapter";
import { ProviderRegistry } from "../../providers/providerRegistry";
import type {
  ProviderAdapter,
  ProviderRegistryService,
} from "../../providers/providerTypes";
import {
  type EventPublisherService,
  createRuntimeState,
} from "../../runtime/runtime";
import { ToolExecutor } from "../../tools/toolExecutor";
import { WebContentService } from "../../tools/webContentService";
import { ThreadHistoryBuilder } from "../domain/threadHistoryBuilder";
import { ThreadCrudService } from "../lifecycle/threadCrudService";
import { EventStore } from "../persistence/eventStore";
import { ProviderSessionRepository } from "../persistence/providerSessionRepository";
import { ThreadRepository } from "../persistence/threadRepository";
import { ReplayService } from "../replayService";
import { ProviderSessionRuntimeService } from "../runtime/providerSessionRuntimeService";
import { ThreadAutoTitleService } from "../runtime/threadAutoTitleService";
import { ThreadEventPersistence } from "../runtime/threadEventPersistence";
import { ThreadTurnRunner } from "../runtime/threadTurnRunner";
import { ThreadOrchestrator } from "../threadOrchestrator";

export const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect);

const createFixedClock = (now = "2026-04-17T00:00:00.000Z") => ({
  now: () => now,
});

const createSequentialIdGenerator = () => {
  let count = 0;
  return {
    next: (prefix: string) => {
      count += 1;
      return `${prefix}_${count}`;
    },
  };
};

export const createThreadRecord = (
  overrides: Partial<{
    id: string;
    workspaceId: string;
    providerKey: string;
    providerSessionId: string;
    title: string;
    resolutionState: "open" | "resolved";
    createdAt: string;
    updatedAt: string;
  }> = {},
) => ({
  id: overrides.id ?? "thread_1",
  workspaceId: overrides.workspaceId ?? "workspace_1",
  providerKey: overrides.providerKey ?? "fake",
  providerSessionId: overrides.providerSessionId ?? "session_1",
  title: overrides.title ?? "New chat",
  resolutionState: overrides.resolutionState ?? "open",
  createdAt: overrides.createdAt ?? "2026-04-17T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-04-17T00:00:00.000Z",
});

export const createThreadViewModel = (
  overrides: Partial<ThreadViewModel> = {},
): ThreadViewModel => ({
  threadId: overrides.threadId ?? "thread_1",
  workspaceId: overrides.workspaceId ?? "workspace_1",
  providerKey: overrides.providerKey ?? "fake",
  providerSessionId: overrides.providerSessionId ?? "session_1",
  title: overrides.title ?? "New chat",
  resolutionState: overrides.resolutionState ?? "open",
  runtimeState: overrides.runtimeState ?? "idle",
  messages: overrides.messages ?? [],
  toolActivities: overrides.toolActivities ?? [],
  pendingToolApproval: overrides.pendingToolApproval ?? null,
  activeTurnId: overrides.activeTurnId ?? null,
  latestSequence: overrides.latestSequence ?? 0,
  lastError: overrides.lastError ?? null,
  lastUserMessageAt: overrides.lastUserMessageAt ?? null,
  lastAssistantMessageAt: overrides.lastAssistantMessageAt ?? null,
  latestActivityAt: overrides.latestActivityAt ?? "2026-04-17T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-04-17T00:00:00.000Z",
});

const createEditorServices = (workspaceRoot?: string) => {
  const resolvedRoot =
    workspaceRoot ?? mkdtempSync(join(tmpdir(), "magick-thread-tests-"));
  const pathPolicy = new WorkspacePathPolicy(resolvedRoot);
  const presentationPolicy = new PathPresentationPolicy("workspace-relative");
  const documents = new DocumentService({
    pathPolicy,
    presentationPolicy,
  });

  return {
    workspaceRoot: resolvedRoot,
    documents,
    workspaceQuery: new WorkspaceQueryService({
      pathPolicy,
      presentationPolicy,
      documents,
    }),
    webContent: new WebContentService(),
  };
};

export const createThreadServicesContext = (
  options: {
    readonly adapters?: readonly ProviderAdapter[];
    readonly providerRegistry?: ProviderRegistryService;
    readonly workspaceRoot?: string;
    readonly publisher?: EventPublisherService;
  } = {},
) => {
  const database = createDatabase();
  const runtimeState = createRuntimeState();
  const clock = createFixedClock();
  const idGenerator = createSequentialIdGenerator();
  const threadRepository = new ThreadRepository(database);
  const eventStore = new EventStore(database);
  const providerSessionRepository = new ProviderSessionRepository(database);
  const editor = createEditorServices(options.workspaceRoot);
  const toolExecutor = new ToolExecutor();
  const publishedEvents: string[] = [];
  const publisher: EventPublisherService = options.publisher ?? {
    publish: async (events) => {
      publishedEvents.push(...events.map((event) => event.type));
    },
  };
  const providerRegistry =
    options.providerRegistry ??
    new ProviderRegistry(
      options.adapters ?? [new FakeProviderAdapter({ mode: "stateful" })],
    );

  const historyBuilder = new ThreadHistoryBuilder({ eventStore });
  const eventPersistence = new ThreadEventPersistence({
    eventStore,
    threadRepository,
    providerSessionRepository,
    publisher,
    clock,
    idGenerator,
  });
  const runtimeService = new ProviderSessionRuntimeService({
    providerRegistry,
    providerSessionRepository,
    runtimeState,
    clock,
  });
  const crudService = new ThreadCrudService({
    providerRegistry,
    eventStore,
    threadRepository,
    providerSessionRepository,
    runtimeState,
    clock,
    idGenerator,
    eventPersistence,
    runtimeService,
  });
  const autoTitleService = new ThreadAutoTitleService({
    providerRegistry,
    renameThread: (threadId, title) =>
      run(crudService.renameThreadEffect(threadId, title)),
  });
  const turnRunner = new ThreadTurnRunner({
    runtimeState,
    clock,
    idGenerator,
    toolExecutor,
    documents: editor.documents,
    workspaceQuery: editor.workspaceQuery,
    webContent: editor.webContent,
    historyBuilder,
    eventPersistence,
    runtimeService,
    crudService,
    autoTitleService,
  });
  const orchestrator = new ThreadOrchestrator({
    providerRegistry,
    eventStore,
    threadRepository,
    providerSessionRepository,
    publisher,
    runtimeState,
    clock,
    idGenerator,
    toolExecutor,
    documents: editor.documents,
    workspaceQuery: editor.workspaceQuery,
    webContent: editor.webContent,
  });

  return {
    database,
    runtimeState,
    clock,
    idGenerator,
    threadRepository,
    eventStore,
    providerSessionRepository,
    toolExecutor,
    providerRegistry,
    publisher,
    publishedEvents,
    replayService: new ReplayService({ eventStore, threadRepository }),
    historyBuilder,
    eventPersistence,
    runtimeService,
    crudService,
    autoTitleService,
    turnRunner,
    orchestrator,
    ...editor,
  };
};
