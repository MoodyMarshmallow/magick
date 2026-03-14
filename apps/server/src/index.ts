import type { Server } from "node:http";

import { ProviderRegistry } from "./application/providerRegistry";
import { ReplayService } from "./application/replayService";
import { ThreadOrchestrator } from "./application/threadOrchestrator";
import { createDatabase } from "./persistence/database";
import { EventStore } from "./persistence/eventStore";
import { ProviderSessionRepository } from "./persistence/providerSessionRepository";
import { ThreadRepository } from "./persistence/threadRepository";
import { FakeProviderAdapter } from "./providers/fake/fakeProviderAdapter";
import { ConnectionRegistry } from "./transport/connectionRegistry";
import { WebSocketCommandServer } from "./transport/wsServer";

export interface BackendServices {
  readonly database: ReturnType<typeof createDatabase>;
  readonly eventStore: EventStore;
  readonly threadRepository: ThreadRepository;
  readonly providerSessionRepository: ProviderSessionRepository;
  readonly providerRegistry: ProviderRegistry;
  readonly replayService: ReplayService;
  readonly orchestrator: ThreadOrchestrator;
  readonly connections: ConnectionRegistry;
}

export const createBackendServices = (): BackendServices => {
  const database = createDatabase();
  const eventStore = new EventStore(database);
  const threadRepository = new ThreadRepository(database);
  const providerSessionRepository = new ProviderSessionRepository(database);
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(new FakeProviderAdapter({ mode: "stateful" }));
  providerRegistry.register(
    new FakeProviderAdapter({ key: "fake-stateless", mode: "stateless" }),
  );
  const connections = new ConnectionRegistry();
  const replayService = new ReplayService(eventStore, threadRepository);
  const orchestrator = new ThreadOrchestrator({
    providerRegistry,
    eventStore,
    threadRepository,
    providerSessionRepository,
    publisher: {
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
    },
  });

  return {
    database,
    eventStore,
    threadRepository,
    providerSessionRepository,
    providerRegistry,
    replayService,
    orchestrator,
    connections,
  };
};

export const attachWebSocketServer = (
  httpServer: Server,
  services: BackendServices,
): WebSocketCommandServer => {
  return new WebSocketCommandServer({
    httpServer,
    orchestrator: services.orchestrator,
    replayService: services.replayService,
    connections: services.connections,
  });
};
