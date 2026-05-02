// Verifies websocket command handling and transport-level error mapping.

import { createServer } from "node:http";

import { Effect } from "effect";

import { DocumentService } from "../../../editor/documents/documentService";
import { PathPresentationPolicy } from "../../../editor/workspace/pathPresentationPolicy";
import { WorkspacePathPolicy } from "../../../editor/workspace/workspacePathPolicy";
import { WorkspaceQueryService } from "../../../editor/workspace/workspaceQueryService";
import { createDatabase } from "../../../persistence/database";
import { FakeProviderAdapter } from "../providers/fake/fakeProviderAdapter";
import { ProviderRegistry } from "../providers/providerRegistry";
import {
  createClock,
  createIdGenerator,
  createRuntimeState,
} from "../runtime/runtime";
import { EventStore } from "../threads/persistence/eventStore";
import { ProviderSessionRepository } from "../threads/persistence/providerSessionRepository";
import { ThreadRepository } from "../threads/persistence/threadRepository";
import { ReplayService } from "../threads/replayService";
import { ThreadOrchestrator } from "../threads/threadOrchestrator";
import { ToolExecutor } from "../tools/toolExecutor";
import { WebContentService } from "../tools/webContentService";
import { ConnectionRegistry } from "./connectionRegistry";
import { WebSocketCommandServer } from "./wsServer";

const idleLoginState = {
  status: "idle",
  loginId: null,
  authUrl: null,
  startedAt: null,
  expiresAt: null,
  error: null,
} as const;

const createToolServices = () => {
  const pathPolicy = new WorkspacePathPolicy(process.cwd());
  const presentationPolicy = new PathPresentationPolicy("workspace-relative");
  const documents = new DocumentService({
    pathPolicy,
    presentationPolicy,
  });

  return {
    toolExecutor: new ToolExecutor(),
    documents,
    workspaceQuery: new WorkspaceQueryService({
      pathPolicy,
      presentationPolicy,
      documents,
    }),
    webContent: new WebContentService(),
  };
};

const makeServices = () => {
  const database = createDatabase();
  const adapter = new FakeProviderAdapter({ mode: "stateful" });
  const threadRepository = new ThreadRepository(database);
  const eventStore = new EventStore(database);
  const toolServices = createToolServices();

  return {
    adapter,
    providerRegistry: new ProviderRegistry([adapter]),
    providerAuth: {
      read: async (providerKey: string) => ({
        providerKey,
        requiresOpenaiAuth: providerKey === "codex",
        account: null,
        login: idleLoginState,
      }),
      startChatGptLogin: async (providerKey: string) => ({
        providerKey,
        loginId: "login_1",
        authUrl: "https://chatgpt.com/login",
      }),
      cancelLogin: async () => undefined,
      logout: async () => undefined,
      subscribe: () => () => undefined,
    },
    replayService: new ReplayService({
      eventStore,
      threadRepository,
    }),
    threadOrchestrator: new ThreadOrchestrator({
      providerRegistry: new ProviderRegistry([adapter]),
      eventStore,
      threadRepository,
      providerSessionRepository: new ProviderSessionRepository(database),
      publisher: {
        publish: async () => undefined,
      },
      runtimeState: createRuntimeState(),
      clock: createClock(),
      idGenerator: createIdGenerator(),
      ...toolServices,
    }),
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
    const services = makeServices();
    const server = createServer();
    await listen(server);
    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      providerAuth: services.providerAuth,
      providerRegistry: services.providerRegistry,
      replayService: services.replayService,
      threadOrchestrator: services.threadOrchestrator,
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
    const services = makeServices();
    const server = createServer();
    await listen(server);
    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      providerAuth: services.providerAuth,
      providerRegistry: services.providerRegistry,
      replayService: services.replayService,
      threadOrchestrator: services.threadOrchestrator,
      connections: new ConnectionRegistry(),
    });

    const thread = await services.threadOrchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: services.adapter.key,
    });

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

  it("rejects approval responses until interactive approvals are wired", async () => {
    const services = makeServices();
    const server = createServer();
    await listen(server);
    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      providerAuth: services.providerAuth,
      providerRegistry: services.providerRegistry,
      replayService: services.replayService,
      threadOrchestrator: services.threadOrchestrator,
      connections: new ConnectionRegistry(),
    });

    const response = await wsServer.handleCommand(
      {
        requestId: "req_tool_approval",
        command: {
          type: "tool.approval.respond",
          payload: {
            threadId: "thread_1",
            toolCallId: "tool_1",
            decision: "rejected",
          },
        },
      },
      "conn_1",
    );

    expect(response).toMatchObject({
      requestId: "req_tool_approval",
      result: {
        ok: false,
        error: {
          code: "tool_approval_not_supported",
        },
      },
    });

    await closeServer(server);
  });

  it("returns codex auth status from the provider auth service", async () => {
    const services = makeServices();
    const server = createServer();
    await listen(server);
    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      providerAuth: services.providerAuth,
      providerRegistry: services.providerRegistry,
      replayService: services.replayService,
      threadOrchestrator: services.threadOrchestrator,
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
            login: idleLoginState,
          },
        },
      },
    });

    await closeServer(server);
  });

  it("handles bootstrap, list, create, stop, retry, resume, and auth commands", async () => {
    const services = makeServices();
    const server = createServer();
    await listen(server);
    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      providerAuth: services.providerAuth,
      providerRegistry: services.providerRegistry,
      replayService: services.replayService,
      threadOrchestrator: services.threadOrchestrator,
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
          payload: {
            workspaceId: "workspace_1",
            providerKey: services.adapter.key,
          },
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

    const rename = await wsServer.handleCommand(
      {
        requestId: "req_rename",
        command: {
          type: "thread.rename",
          payload: { threadId, title: "Renamed chat" },
        },
      },
      "conn_rename",
    );
    expect(rename).toMatchObject({
      result: {
        ok: true,
        data: {
          kind: "threadState",
          thread: { title: "Renamed chat" },
        },
      },
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

    const deleted = await wsServer.handleCommand(
      {
        requestId: "req_delete",
        command: {
          type: "thread.delete",
          payload: { threadId },
        },
      },
      "conn_delete",
    );
    expect(deleted).toMatchObject({
      result: { ok: true, data: { kind: "threadDeleted", threadId } },
    });

    await closeServer(server);
  });

  it("broadcasts thread deletion to connected clients", async () => {
    const services = makeServices();
    const server = createServer();
    await listen(server);
    const connections = new ConnectionRegistry();
    const pushed: unknown[] = [];
    connections.register({
      id: "conn_watch",
      send: async (message) => {
        pushed.push(message);
      },
    });

    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      providerAuth: services.providerAuth,
      providerRegistry: services.providerRegistry,
      replayService: services.replayService,
      threadOrchestrator: services.threadOrchestrator,
      connections,
    });

    const thread = await services.threadOrchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: services.adapter.key,
    });

    await wsServer.handleCommand(
      {
        requestId: "req_delete_broadcast",
        command: {
          type: "thread.delete",
          payload: { threadId: thread.threadId },
        },
      },
      "conn_delete",
    );

    expect(pushed).toContainEqual({
      channel: "thread.deleted",
      threadId: thread.threadId,
      workspaceId: "workspace_1",
    });

    await closeServer(server);
  });

  it("publishes pushed domain events to subscribed connections", async () => {
    const services = makeServices();
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
      providerAuth: services.providerAuth,
      providerRegistry: services.providerRegistry,
      replayService: services.replayService,
      threadOrchestrator: services.threadOrchestrator,
      connections,
    });

    const thread = await services.threadOrchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: services.adapter.key,
    });
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
          providerKey: services.adapter.key,
          title: "Chat",
        },
      },
    ]);

    expect(pushed).toHaveLength(1);
    await closeServer(server);
  });

  it("maps unexpected runtime failures to backend_unexpected_error responses", async () => {
    const server = createServer();
    await listen(server);
    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      providerAuth: {
        read: async () => {
          throw new Error("boom");
        },
        startChatGptLogin: async () => {
          throw new Error("boom");
        },
        cancelLogin: async () => {
          throw new Error("boom");
        },
        logout: async () => {
          throw new Error("boom");
        },
        subscribe: () => () => undefined,
      },
      providerRegistry: new ProviderRegistry([]),
      replayService: {
        getThreadState: () => {
          throw new Error("boom");
        },
        replayThread: () => {
          throw new Error("boom");
        },
      },
      threadOrchestrator: {
        createThread: async () => {
          throw new Error("boom");
        },
        listThreads: async () => {
          throw new Error("boom");
        },
        openThread: async () => {
          throw new Error("boom");
        },
        renameThread: async () => {
          throw new Error("boom");
        },
        deleteThread: async () => {
          throw new Error("boom");
        },
        sendMessage: () => Effect.die(new Error("boom")),
        resolveThread: async () => {
          throw new Error("boom");
        },
        reopenThread: async () => {
          throw new Error("boom");
        },
        stopTurn: () => Effect.die(new Error("boom")),
        retryTurn: () => Effect.die(new Error("boom")),
        ensureSession: async () => {
          throw new Error("boom");
        },
      },
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
      result: { ok: false, error: { code: "backend_unexpected_error" } },
    });

    await closeServer(server);
  });

  it("subscribes retryTurn callers so they can receive follow-up thread events", async () => {
    const services = makeServices();
    const server = createServer();
    await listen(server);
    const connections = new ConnectionRegistry();
    const received: unknown[] = [];
    connections.register({
      id: "conn_retry_subscribed",
      send: async (message) => {
        received.push(message);
      },
    });
    const wsServer = new WebSocketCommandServer({
      httpServer: server,
      providerAuth: services.providerAuth,
      providerRegistry: services.providerRegistry,
      replayService: services.replayService,
      threadOrchestrator: services.threadOrchestrator,
      connections,
    });

    const thread = await services.threadOrchestrator.createThread({
      workspaceId: "workspace_1",
      providerKey: services.adapter.key,
    });
    await Effect.runPromise(
      services.threadOrchestrator.sendMessage(thread.threadId, "Hello"),
    );

    const response = await wsServer.handleCommand(
      {
        requestId: "req_retry_subscribed",
        command: {
          type: "thread.retryTurn",
          payload: { threadId: thread.threadId },
        },
      },
      "conn_retry_subscribed",
    );

    expect(response).toMatchObject({
      requestId: "req_retry_subscribed",
      result: {
        ok: true,
        data: {
          kind: "accepted",
          threadId: thread.threadId,
        },
      },
    });

    await connections.publishToThread(thread.threadId, {
      channel: "transport.connectionState",
      state: "connected",
      detail: "after retry",
    });

    expect(received).toContainEqual({
      channel: "transport.connectionState",
      state: "connected",
      detail: "after retry",
    });

    await closeServer(server);
  });
});
