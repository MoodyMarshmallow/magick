// Verifies websocket command handling and transport-level error mapping.

import { createServer } from "node:http";

import { Effect, Layer } from "effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

import {
  ProviderAuthService,
  type ProviderAuthServiceApi,
} from "../application/providerAuthService";
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

type TestRuntime =
  | ProviderAuthServiceApi
  | ReplayServiceApi
  | ThreadOrchestratorApi;

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

  const authLayer = Layer.succeed(ProviderAuthService, {
    read: (providerKey: string) =>
      Effect.succeed({
        providerKey,
        requiresOpenaiAuth: providerKey === "codex",
        account: null,
        activeLoginId: null,
      }),
    startChatGptLogin: (providerKey: string) =>
      Effect.succeed({
        providerKey,
        loginId: "login_1",
        authUrl: "https://chatgpt.com/login",
      }),
    cancelLogin: () => Effect.void,
    logout: () => Effect.void,
  });

  return {
    runtime: ManagedRuntime.make(Layer.mergeAll(appLayer, authLayer)),
    adapter,
  };
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

  it("returns codex auth status from the provider auth service", async () => {
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
        requestId: "req_auth_1",
        command: {
          type: "provider.auth.read",
          payload: { providerKey: "codex" },
        },
      },
      "conn_auth_1",
    );

    expect(response).toMatchObject({
      requestId: "req_auth_1",
      result: {
        ok: true,
        data: {
          kind: "providerAuthState",
          auth: {
            providerKey: "codex",
            requiresOpenaiAuth: true,
            account: null,
            activeLoginId: null,
          },
        },
      },
    });

    await closeServer(server);
  });

  it("handles bootstrap, list, create, stop, retry, resume, and auth commands", async () => {
    const { runtime, adapter } = makeRuntime();
    const server = createServer();
    await listen(server);
    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      runtime: runtime as ManagedRuntime.ManagedRuntime<TestRuntime, never>,
      connections: new ConnectionRegistry(),
    });

    const bootstrap = await wsServer.handleCommand(
      {
        requestId: "req_bootstrap",
        command: {
          type: "app.bootstrap",
          payload: { workspaceId: "workspace_1" },
        },
      },
      "conn_bootstrap",
    );
    expect(bootstrap.result.ok).toBe(true);

    const create = await wsServer.handleCommand(
      {
        requestId: "req_create",
        command: {
          type: "thread.create",
          payload: { workspaceId: "workspace_1", providerKey: adapter.key },
        },
      },
      "conn_create",
    );
    expect(create).toMatchObject({
      result: { ok: true, data: { kind: "threadState" } },
    });
    const threadId =
      create.result.ok && create.result.data.kind === "threadState"
        ? create.result.data.thread.threadId
        : "";

    const list = await wsServer.handleCommand(
      {
        requestId: "req_list",
        command: {
          type: "thread.list",
          payload: { workspaceId: "workspace_1" },
        },
      },
      "conn_list",
    );
    expect(list).toMatchObject({
      result: { ok: true, data: { kind: "threadList" } },
    });

    const open = await wsServer.handleCommand(
      {
        requestId: "req_open",
        command: {
          type: "thread.open",
          payload: { threadId },
        },
      },
      "conn_open",
    );
    expect(open).toMatchObject({
      result: { ok: true, data: { kind: "threadState" } },
    });

    await wsServer.handleCommand(
      {
        requestId: "req_send",
        command: {
          type: "thread.sendMessage",
          payload: { threadId, content: "Hello" },
        },
      },
      "conn_send",
    );

    const stop = await wsServer.handleCommand(
      {
        requestId: "req_stop",
        command: {
          type: "thread.stopTurn",
          payload: { threadId },
        },
      },
      "conn_stop",
    );
    expect(stop).toMatchObject({
      result: { ok: true, data: { kind: "threadState" } },
    });

    const retry = await wsServer.handleCommand(
      {
        requestId: "req_retry",
        command: {
          type: "thread.retryTurn",
          payload: { threadId },
        },
      },
      "conn_retry",
    );
    expect(retry).toMatchObject({
      result: { ok: true, data: { kind: "accepted", threadId } },
    });

    const resume = await wsServer.handleCommand(
      {
        requestId: "req_resume",
        command: {
          type: "thread.resume",
          payload: { threadId, afterSequence: 0 },
        },
      },
      "conn_resume",
    );
    expect(resume).toMatchObject({
      result: { ok: true, data: { kind: "threadState" } },
    });

    const loginStart = await wsServer.handleCommand(
      {
        requestId: "req_auth_start",
        command: {
          type: "provider.auth.login.start",
          payload: { providerKey: "codex", mode: "chatgpt" },
        },
      },
      "conn_auth_start",
    );
    expect(loginStart).toMatchObject({
      result: { ok: true, data: { kind: "providerAuthLoginStart" } },
    });

    const cancel = await wsServer.handleCommand(
      {
        requestId: "req_auth_cancel",
        command: {
          type: "provider.auth.login.cancel",
          payload: { providerKey: "codex", loginId: "login_1" },
        },
      },
      "conn_auth_cancel",
    );
    expect(cancel).toMatchObject({
      result: { ok: true, data: { kind: "providerAuthState" } },
    });

    const logout = await wsServer.handleCommand(
      {
        requestId: "req_auth_logout",
        command: {
          type: "provider.auth.logout",
          payload: { providerKey: "codex" },
        },
      },
      "conn_auth_logout",
    );
    expect(logout).toMatchObject({
      result: { ok: true, data: { kind: "providerAuthState" } },
    });

    await closeServer(server);
  });

  it("publishes pushed domain events to subscribed connections", async () => {
    const { runtime, adapter } = makeRuntime();
    const server = createServer();
    await listen(server);
    const connections = new ConnectionRegistry();
    const pushed: unknown[] = [];
    connections.register({
      id: "conn_push",
      send: async (message) => {
        pushed.push(message);
      },
    });

    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      runtime: runtime as ManagedRuntime.ManagedRuntime<TestRuntime, never>,
      connections,
    });

    const orchestrator = await runtime.runPromise(ThreadOrchestrator);
    const thread = await runtime.runPromise(
      orchestrator.createThread({
        workspaceId: "workspace_1",
        providerKey: adapter.key,
      }),
    );
    connections.subscribeThread("conn_push", thread.threadId);

    await wsServer.publish([
      {
        eventId: "event_1",
        threadId: thread.threadId,
        providerSessionId: thread.providerSessionId,
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "thread.created",
        payload: {
          workspaceId: "workspace_1",
          providerKey: adapter.key,
          title: "Chat",
        },
      },
    ]);

    expect(pushed).toHaveLength(1);
    await closeServer(server);
  });

  it("maps unexpected runtime failures to internal_error responses", async () => {
    const server = createServer();
    await listen(server);
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        Layer.succeed(ThreadOrchestrator, {
          createThread: () => Effect.die(new Error("boom")),
          listThreads: () => Effect.die(new Error("boom")),
          openThread: () => Effect.die(new Error("boom")),
          sendMessage: () => Effect.die(new Error("boom")),
          stopTurn: () => Effect.die(new Error("boom")),
          retryTurn: () => Effect.die(new Error("boom")),
          ensureSession: () => Effect.die(new Error("boom")),
        }),
        Layer.succeed(ReplayService, {
          getThreadState: () => Effect.die(new Error("boom")),
          replayThread: () => Effect.die(new Error("boom")),
        }),
        Layer.succeed(ProviderAuthService, {
          read: () => Effect.die(new Error("boom")),
          startChatGptLogin: () => Effect.die(new Error("boom")),
          cancelLogin: () => Effect.die(new Error("boom")),
          logout: () => Effect.die(new Error("boom")),
        }),
      ),
    );
    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      runtime: runtime as ManagedRuntime.ManagedRuntime<TestRuntime, never>,
      connections: new ConnectionRegistry(),
    });

    const response = await wsServer.handleCommand(
      {
        requestId: "req_internal",
        command: {
          type: "thread.list",
          payload: { workspaceId: "workspace_1" },
        },
      },
      "conn_internal",
    );

    expect(response).toMatchObject({
      requestId: "req_internal",
      result: { ok: false, error: { code: "replay_failure" } },
    });

    await closeServer(server);
  });
});
