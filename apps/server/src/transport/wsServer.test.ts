import { createServer } from "node:http";

import { Effect, Layer } from "effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { makeProviderRegistryLayer } from "../application/providerRegistry";
import {
  ReplayService,
  type ReplayServiceApi,
  ReplayServiceLive,
} from "../application/replayService";
import {
  ThreadOrchestrator,
  type ThreadOrchestratorApi,
  ThreadOrchestratorLive,
} from "../application/threadOrchestrator";
import {
  ClockLive,
  EventPublisher,
  IdGeneratorLive,
  RuntimeStateLive,
} from "../effect/runtime";
import { createDatabase } from "../persistence/database";
import {
  type EventStoreService,
  makeEventStoreLayer,
} from "../persistence/eventStore";
import {
  type ProviderSessionRepositoryService,
  makeProviderSessionRepositoryLayer,
} from "../persistence/providerSessionRepository";
import {
  type ThreadRepositoryService,
  makeThreadRepositoryLayer,
} from "../persistence/threadRepository";
import { FakeProviderAdapter } from "../providers/fake/fakeProviderAdapter";
import type { ProviderRegistryService } from "../providers/providerTypes";
import { ConnectionRegistry } from "./connectionRegistry";
import { WebSocketCommandServer } from "./wsServer";

type TestRuntime = ReplayServiceApi | ThreadOrchestratorApi;

const makeRuntime = () => {
  const database = createDatabase();
  const adapter = new FakeProviderAdapter({ mode: "stateful" });

  const baseLayer = Layer.mergeAll(
    ClockLive,
    IdGeneratorLive,
    RuntimeStateLive,
    makeEventStoreLayer(database),
    makeThreadRepositoryLayer(database),
    makeProviderSessionRepositoryLayer(database),
    makeProviderRegistryLayer([adapter]),
    Layer.succeed(EventPublisher, {
      publish: () => Effect.void,
    }),
  );

  const appLayer = Layer.mergeAll(
    ReplayServiceLive,
    ThreadOrchestratorLive,
  ).pipe(Layer.provide(baseLayer));

  return { runtime: ManagedRuntime.make(appLayer), adapter };
};

const listen = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) => {
    server.listen(0, () => resolve());
    server.once("error", reject);
  });

const closeServer = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

describe("WebSocketCommandServer", () => {
  it("maps backend not found errors into command responses", async () => {
    const { runtime } = makeRuntime();
    const server = createServer();
    await listen(server);
    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      runtime: runtime as ManagedRuntime.ManagedRuntime<TestRuntime, never>,
      connections: new ConnectionRegistry(),
    });

    const response = await wsServer.handleCommand(
      {
        requestId: "req_1",
        command: {
          type: "thread.open",
          payload: { threadId: "missing_thread" },
        },
      },
      "conn_1",
    );

    expect(response).toMatchObject({
      requestId: "req_1",
      result: {
        ok: false,
        error: {
          code: "not_found",
        },
      },
    });

    await closeServer(server);
  });

  it("returns accepted for sendMessage after creating a thread", async () => {
    const { runtime, adapter } = makeRuntime();
    const server = createServer();
    await listen(server);
    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      runtime: runtime as ManagedRuntime.ManagedRuntime<TestRuntime, never>,
      connections: new ConnectionRegistry(),
    });

    const orchestrator = await runtime.runPromise(ThreadOrchestrator);
    const thread = await runtime.runPromise(
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );

    const response = await wsServer.handleCommand(
      {
        requestId: "req_2",
        command: {
          type: "thread.sendMessage",
          payload: { threadId: thread.threadId, content: "Hello" },
        },
      },
      "conn_2",
    );

    expect(response).toMatchObject({
      requestId: "req_2",
      result: {
        ok: true,
        data: {
          kind: "accepted",
          threadId: thread.threadId,
        },
      },
    });

    await closeServer(server);
  });
});
