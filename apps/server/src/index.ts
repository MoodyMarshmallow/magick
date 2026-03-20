import { mkdirSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join } from "node:path";

import { Effect, Layer } from "effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

import {
  ProviderAuthService,
  type ProviderAuthServiceApi,
  ProviderAuthServiceLive,
} from "./application/providerAuthService";
import { makeProviderRegistryLayer } from "./application/providerRegistry";
import {
  ReplayService,
  type ReplayServiceApi,
  ReplayServiceLive,
} from "./application/replayService";
import {
  ThreadOrchestrator,
  type ThreadOrchestratorApi,
  ThreadOrchestratorLive,
} from "./application/threadOrchestrator";
import {
  Clock,
  ClockLive,
  EventPublisher,
  IdGenerator,
  IdGeneratorLive,
  RuntimeState,
  RuntimeStateLive,
} from "./effect/runtime";
import { createDatabase } from "./persistence/database";
import {
  EventStore,
  type EventStoreService,
  makeEventStoreLayer,
} from "./persistence/eventStore";
import {
  ProviderAuthRepository,
  ProviderAuthRepositoryClient,
  type ProviderAuthRepositoryService,
  makeProviderAuthRepositoryLayer,
} from "./persistence/providerAuthRepository";
import {
  ProviderSessionRepository,
  type ProviderSessionRepositoryService,
  makeProviderSessionRepositoryLayer,
} from "./persistence/providerSessionRepository";
import {
  ThreadRepository,
  type ThreadRepositoryService,
  makeThreadRepositoryLayer,
} from "./persistence/threadRepository";
import {
  CodexProviderAdapter,
  createCodexRuntimeFactory,
} from "./providers/codex/codexProviderAdapter";
import { FakeProviderAdapter } from "./providers/fake/fakeProviderAdapter";
import {
  ProviderRegistry,
  type ProviderRegistryService,
} from "./providers/providerTypes";
import { ConnectionRegistry } from "./transport/connectionRegistry";
import { WebSocketCommandServer } from "./transport/wsServer";

type BackendRuntime =
  | ProviderAuthServiceApi
  | ReplayServiceApi
  | ThreadOrchestratorApi;

export interface BackendServices {
  readonly database: ReturnType<typeof createDatabase>;
  readonly databasePath: string;
  readonly connections: ConnectionRegistry;
  readonly runtime: ManagedRuntime.ManagedRuntime<BackendRuntime, never>;
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

  const providerAuthRepository = new ProviderAuthRepositoryClient(database);

  const publisherLayer = Layer.succeed(EventPublisher, {
    publish: (events) =>
      Effect.promise(() =>
        Promise.all(
          events.map((event) =>
            connections.publishToThread(event.threadId, {
              channel: "orchestration.domainEvent",
              threadId: event.threadId,
              event,
            }),
          ),
        ).then(() => undefined),
      ),
  });

  const baseLayer = Layer.mergeAll(
    ClockLive,
    IdGeneratorLive,
    RuntimeStateLive,
    makeEventStoreLayer(database),
    makeProviderAuthRepositoryLayer(database),
    makeThreadRepositoryLayer(database),
    makeProviderSessionRepositoryLayer(database),
    makeProviderRegistryLayer([
      new CodexProviderAdapter(
        createCodexRuntimeFactory({
          authRepository: providerAuthRepository,
        }),
      ),
      new FakeProviderAdapter({ mode: "stateful" }),
      new FakeProviderAdapter({ key: "fake-stateless", mode: "stateless" }),
    ]),
    publisherLayer,
  );

  const appLayer = Layer.mergeAll(
    ReplayServiceLive,
    ThreadOrchestratorLive,
  ).pipe(Layer.provide(baseLayer));

  const authLayer = ProviderAuthServiceLive({
    authRepository: providerAuthRepository,
  });

  const layer = Layer.mergeAll(baseLayer, appLayer, authLayer);

  const runtime = ManagedRuntime.make(layer);

  return {
    database,
    databasePath,
    connections,
    runtime,
  };
};

export const attachWebSocketServer = (
  httpServer: Server,
  services: BackendServices,
): WebSocketCommandServer => {
  return new WebSocketCommandServer({
    httpServer,
    runtime: services.runtime,
    connections: services.connections,
  });
};

export {
  Clock,
  EventPublisher,
  EventStore,
  IdGenerator,
  ProviderAuthService,
  ProviderAuthRepository,
  ProviderRegistry,
  ProviderSessionRepository,
  ReplayService,
  RuntimeState,
  ThreadOrchestrator,
  ThreadRepository,
};
