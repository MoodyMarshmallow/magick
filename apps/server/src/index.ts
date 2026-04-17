import { mkdirSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { resolveLocalWorkspaceDir } from "../../../packages/shared/src/localWorkspaceNode";

import {
  CodexProviderAdapter,
  createCodexRuntimeFactory,
} from "./ai/agent/providers/codex/codexProviderAdapter";
import {
  FakeProviderAdapter,
  type FakeProviderResponse,
} from "./ai/agent/providers/fake/fakeProviderAdapter";
import { ProviderRegistry } from "./ai/agent/providers/providerRegistry";
import type { ProviderAdapter } from "./ai/agent/providers/providerTypes";
import {
  createClock,
  createIdGenerator,
  createRuntimeState,
} from "./ai/agent/runtime/runtime";
import type { EventPublisherService } from "./ai/agent/runtime/runtime";
import { EventStore } from "./ai/agent/threads/persistence/eventStore";
import { ProviderSessionRepository } from "./ai/agent/threads/persistence/providerSessionRepository";
import { ThreadRepository } from "./ai/agent/threads/persistence/threadRepository";
import { ReplayService } from "./ai/agent/threads/replayService";
import { ThreadOrchestrator } from "./ai/agent/threads/threadOrchestrator";
import { ToolExecutor } from "./ai/agent/tools/toolExecutor";
import { WebContentService } from "./ai/agent/tools/webContentService";
import { ConnectionRegistry } from "./ai/agent/transport/connectionRegistry";
import { WebSocketCommandServer } from "./ai/agent/transport/wsServer";
import { ProviderAuthRepositoryClient } from "./ai/auth/providerAuthRepository";
import { ProviderAuthService } from "./ai/auth/providerAuthService";
import { DocumentService } from "./editor/documents/documentService";
import { PathPresentationPolicy } from "./editor/workspace/pathPresentationPolicy";
import { WorkspacePathPolicy } from "./editor/workspace/workspacePathPolicy";
import { WorkspaceQueryService } from "./editor/workspace/workspaceQueryService";
import { type DatabaseClient, createDatabase } from "./persistence/database";

export interface BackendServices {
  readonly database: ReturnType<typeof createDatabase>;
  readonly databasePath: string;
  readonly connections: ConnectionRegistry;
  readonly providerRegistry: ProviderRegistry;
  readonly providerAuthService: ProviderAuthService;
  readonly replayService: ReplayService;
  readonly threadOrchestrator: ThreadOrchestrator;
}

export interface BackendServiceOptions {
  readonly databasePath?: string;
  readonly workspaceRoot?: string;
  readonly includeFakeProviders?: boolean;
}

export const resolveBackendRepoRoot = (): string =>
  resolve(import.meta.dirname, "../../..");

export const resolveDefaultDatabasePath = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  return (
    env.MAGICK_DB_PATH ??
    join(resolveBackendRepoRoot(), ".magick", "backend.db")
  );
};

export const resolveDefaultWorkspaceRoot = (
  env: NodeJS.ProcessEnv = process.env,
): string =>
  resolveLocalWorkspaceDir({
    env,
    cwd: resolveBackendRepoRoot(),
  });

const createEditorServices = (workspaceRoot: string) => {
  const pathPolicy = new WorkspacePathPolicy(workspaceRoot);
  const presentationPolicy = new PathPresentationPolicy("workspace-relative");
  const documents = new DocumentService({
    pathPolicy,
    presentationPolicy,
  });

  return {
    documents,
    workspaceQuery: new WorkspaceQueryService({
      pathPolicy,
      presentationPolicy,
      documents,
    }),
  };
};

const createAiServices = (args: {
  readonly database: DatabaseClient;
  readonly connections: ConnectionRegistry;
  readonly includeFakeProviders?: boolean;
  readonly documents: DocumentService;
  readonly workspaceQuery: WorkspaceQueryService;
}) => {
  const clock = createClock();
  const idGenerator = createIdGenerator();
  const runtimeState = createRuntimeState();
  const eventStore = new EventStore(args.database);
  const providerAuthRepository = new ProviderAuthRepositoryClient(
    args.database,
  );
  const threadRepository = new ThreadRepository(args.database);
  const providerSessionRepository = new ProviderSessionRepository(
    args.database,
  );
  const webContent = new WebContentService();
  const toolExecutor = new ToolExecutor();
  const providers: ProviderAdapter[] = [
    new CodexProviderAdapter(
      createCodexRuntimeFactory({
        authRepository: providerAuthRepository,
      }),
    ),
  ];
  if (args.includeFakeProviders) {
    providers.push(
      new FakeProviderAdapter({ mode: "stateful" }),
      new FakeProviderAdapter({
        key: "fake-tools",
        mode: "stateful",
        responder: ({
          userMessage,
        }: { readonly userMessage: string }): FakeProviderResponse => {
          const normalizedMessage = userMessage.toLowerCase();
          if (normalizedMessage.includes("list")) {
            return {
              toolName: "list",
              input: { path: "." },
              onResult: (output: string) => `Listed workspace root.\n${output}`,
            };
          }
          if (normalizedMessage.includes("patch")) {
            return {
              toolName: "apply_patch",
              input: {
                path: "notes.md",
                patches: [{ find: "world", replace: "magick" }],
              },
              onResult: (output: string) =>
                `Patched workspace note.\n${output}`,
            };
          }
          if (normalizedMessage.includes("read missing")) {
            return {
              toolName: "read",
              input: { path: "missing.md" },
              onResult: (output: string) => `Read attempt finished.\n${output}`,
            };
          }
          if (normalizedMessage.includes("fetch fail")) {
            return {
              toolName: "fetch",
              input: { url: "http://127.0.0.1:9/unreachable" },
              onResult: (output: string) =>
                `Fetch attempt finished.\n${output}`,
            };
          }

          return {
            toolName: "read",
            input: { path: "notes.md" },
            onResult: (output: string) => `Read workspace note.\n${output}`,
          };
        },
      }),
      new FakeProviderAdapter({ key: "fake-stateless", mode: "stateless" }),
    );
  }

  const providerRegistry = new ProviderRegistry(providers);
  const publisher: EventPublisherService = {
    publish: async (events) => {
      await Promise.all(
        events.map((event) =>
          args.connections.publishToThread(event.threadId, {
            channel: "orchestration.domainEvent",
            threadId: event.threadId,
            event,
          }),
        ),
      );
    },
  };

  return {
    providerRegistry,
    providerAuthService: new ProviderAuthService({
      authRepository: providerAuthRepository,
    }),
    replayService: new ReplayService({
      eventStore,
      threadRepository,
    }),
    threadOrchestrator: new ThreadOrchestrator({
      providerRegistry,
      eventStore,
      threadRepository,
      providerSessionRepository,
      publisher,
      runtimeState,
      clock,
      idGenerator,
      toolExecutor,
      documents: args.documents,
      workspaceQuery: args.workspaceQuery,
      webContent,
    }),
  };
};

export const createBackendServices = (
  options: BackendServiceOptions = {},
): BackendServices => {
  const databasePath = options.databasePath ?? resolveDefaultDatabasePath();
  const workspaceRoot = options.workspaceRoot ?? resolveDefaultWorkspaceRoot();
  mkdirSync(dirname(databasePath), { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });

  const database = createDatabase(databasePath);
  const connections = new ConnectionRegistry();
  const editorServices = createEditorServices(workspaceRoot);
  const aiServices = createAiServices({
    database,
    connections,
    ...(options.includeFakeProviders === undefined
      ? {}
      : { includeFakeProviders: options.includeFakeProviders }),
    ...editorServices,
  });

  return {
    database,
    databasePath,
    connections,
    providerRegistry: aiServices.providerRegistry,
    providerAuthService: aiServices.providerAuthService,
    replayService: aiServices.replayService,
    threadOrchestrator: aiServices.threadOrchestrator,
  };
};

export const attachWebSocketServer = (
  httpServer: Server,
  services: BackendServices,
): WebSocketCommandServer => {
  return new WebSocketCommandServer({
    httpServer,
    providerAuth: services.providerAuthService,
    providerRegistry: services.providerRegistry,
    replayService: services.replayService,
    threadOrchestrator: services.threadOrchestrator,
    connections: services.connections,
  });
};
