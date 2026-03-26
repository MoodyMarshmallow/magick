import { mkdirSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join } from "node:path";

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
import { FakeProviderAdapter } from "./providers/fake/fakeProviderAdapter";
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
}

const defaultDatabasePath = (): string => {
  return (
    process.env.MAGICK_DB_PATH ?? join(process.cwd(), ".magick", "backend.db")
  );
};

export const createBackendServices = (
  options: BackendServiceOptions = {},
): BackendServices => {
  const databasePath = options.databasePath ?? defaultDatabasePath();
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = createDatabase(databasePath);
  const connections = new ConnectionRegistry();

  const clock = createClock();
  const idGenerator = createIdGenerator();
  const runtimeState = createRuntimeState();
  const eventStore = new EventStore(database);
  const providerAuthRepository = new ProviderAuthRepositoryClient(database);
  const threadRepository = new ThreadRepository(database);
  const providerSessionRepository = new ProviderSessionRepository(database);
  const providerRegistry = new ProviderRegistry([
    new CodexProviderAdapter(
      createCodexRuntimeFactory({
        authRepository: providerAuthRepository,
      }),
    ),
    new FakeProviderAdapter({ mode: "stateful" }),
    new FakeProviderAdapter({ key: "fake-stateless", mode: "stateless" }),
  ]);

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
    replayService: services.replayService,
    threadOrchestrator: services.threadOrchestrator,
    connections: services.connections,
  });
};
