import { mkdirSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { resolveLocalWorkspaceDir } from "../../../packages/shared/src/localWorkspaceNode";

import { ProviderAuthService } from "./application/providerAuthService";
import { ProviderRegistry } from "./application/providerRegistry";
import { ReplayService } from "./application/replayService";
import { ThreadOrchestrator } from "./application/threadOrchestrator";
import {
  createClock,
  createIdGenerator,
  createRuntimeState,
} from "./core/runtime";
import type { EventPublisherService } from "./core/runtime";
import { createDatabase } from "./persistence/database";
import { EventStore } from "./persistence/eventStore";
import { ProviderAuthRepositoryClient } from "./persistence/providerAuthRepository";
import { ProviderSessionRepository } from "./persistence/providerSessionRepository";
import { ThreadRepository } from "./persistence/threadRepository";
import {
  CodexProviderAdapter,
  createCodexRuntimeFactory,
} from "./providers/codex/codexProviderAdapter";
import {
  FakeProviderAdapter,
  type FakeProviderResponse,
} from "./providers/fake/fakeProviderAdapter";
import type { ProviderAdapter } from "./providers/providerTypes";
import { PathPresentationPolicy } from "./tools/pathPresentationPolicy";
import { ToolExecutor } from "./tools/toolExecutor";
import { WebContentService } from "./tools/webContentService";
import { WorkspaceAccessService } from "./tools/workspaceAccessService";
import { WorkspacePathPolicy } from "./tools/workspacePathPolicy";
import { ConnectionRegistry } from "./transport/connectionRegistry";
import { WebSocketCommandServer } from "./transport/wsServer";

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

export const createBackendServices = (
  options: BackendServiceOptions = {},
): BackendServices => {
  const databasePath = options.databasePath ?? resolveDefaultDatabasePath();
  const workspaceRoot = options.workspaceRoot ?? resolveDefaultWorkspaceRoot();
  mkdirSync(dirname(databasePath), { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });

  const database = createDatabase(databasePath);
  const connections = new ConnectionRegistry();

  const clock = createClock();
  const idGenerator = createIdGenerator();
  const runtimeState = createRuntimeState();
  const eventStore = new EventStore(database);
  const providerAuthRepository = new ProviderAuthRepositoryClient(database);
  const threadRepository = new ThreadRepository(database);
  const providerSessionRepository = new ProviderSessionRepository(database);
  const workspaceAccess = new WorkspaceAccessService({
    pathPolicy: new WorkspacePathPolicy(workspaceRoot),
    presentationPolicy: new PathPresentationPolicy("workspace-relative"),
  });
  const webContent = new WebContentService();
  const toolExecutor = new ToolExecutor();
  const providers: ProviderAdapter[] = [
    new CodexProviderAdapter(
      createCodexRuntimeFactory({
        authRepository: providerAuthRepository,
      }),
    ),
  ];
  if (options.includeFakeProviders) {
    providers.push(
      new FakeProviderAdapter({ mode: "stateful" }),
      new FakeProviderAdapter({
        key: "fake-tools",
        mode: "stateful",
        responder: ({ userMessage }): FakeProviderResponse => {
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
          connections.publishToThread(event.threadId, {
            channel: "orchestration.domainEvent",
            threadId: event.threadId,
            event,
          }),
        ),
      );
    },
  };

  const replayService = new ReplayService({
    eventStore,
    threadRepository,
  });
  const providerAuthService = new ProviderAuthService({
    authRepository: providerAuthRepository,
  });
  const threadOrchestrator = new ThreadOrchestrator({
    providerRegistry,
    eventStore,
    threadRepository,
    providerSessionRepository,
    publisher,
    runtimeState,
    clock,
    idGenerator,
    toolExecutor,
    workspaceAccess,
    webContent,
  });

  return {
    database,
    databasePath,
    connections,
    providerRegistry,
    providerAuthService,
    replayService,
    threadOrchestrator,
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
