import type { Server } from "node:http";

import { Effect, Layer } from "effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

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
  ProviderSessionRepository,
  type ProviderSessionRepositoryService,
  makeProviderSessionRepositoryLayer,
} from "./persistence/providerSessionRepository";
import {
  ThreadRepository,
  type ThreadRepositoryService,
  makeThreadRepositoryLayer,
} from "./persistence/threadRepository";
import { FakeProviderAdapter } from "./providers/fake/fakeProviderAdapter";
import {
  ProviderRegistry,
  type ProviderRegistryService,
} from "./providers/providerTypes";
import { ConnectionRegistry } from "./transport/connectionRegistry";
import { WebSocketCommandServer } from "./transport/wsServer";

type BackendRuntime = ReplayServiceApi | ThreadOrchestratorApi;

export interface BackendServices {
  readonly database: ReturnType<typeof createDatabase>;
  readonly connections: ConnectionRegistry;
  readonly runtime: ManagedRuntime.ManagedRuntime<BackendRuntime, never>;
}

export const createBackendServices = (): BackendServices => {
  const database = createDatabase();
  const connections = new ConnectionRegistry();

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
    makeThreadRepositoryLayer(database),
    makeProviderSessionRepositoryLayer(database),
    makeProviderRegistryLayer([
      new FakeProviderAdapter({ mode: "stateful" }),
      new FakeProviderAdapter({ key: "fake-stateless", mode: "stateless" }),
    ]),
    publisherLayer,
  );

  const appLayer = Layer.mergeAll(
    ReplayServiceLive,
    ThreadOrchestratorLive,
  ).pipe(Layer.provide(baseLayer));

  const layer = Layer.mergeAll(baseLayer, appLayer);

  const runtime = ManagedRuntime.make(layer);

  return {
    database,
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
  ProviderRegistry,
  ProviderSessionRepository,
  ReplayService,
  RuntimeState,
  ThreadOrchestrator,
  ThreadRepository,
};
