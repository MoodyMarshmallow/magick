// Handles websocket commands and bridges transport requests into backend modules.

import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import type { ProviderAuthState } from "@magick/contracts/provider";
import type {
  CommandEnvelope,
  CommandResponseEnvelope,
} from "@magick/contracts/ws";
import { createId } from "@magick/shared/id";
import type { ProviderAuthServiceApi } from "../../../auth/providerAuthService";
import {
  type BackendError,
  InvalidStateError,
  NotFoundError,
  PersistenceError,
  ProviderFailureError,
  ProviderUnavailableError,
  backendErrorCode,
  backendErrorMessage,
} from "../../shared/errors";
import type { AssistantTurnEngineInterface } from "../assistant-turn-engine/assistantTurnEngineInterface";
import type { ContextCoreInterface } from "../context-core/contextCoreInterface";
import type { ProviderCatalogInterface } from "../provider-runtime/providerRuntimeInterface";
import type { AgentTransportInterface } from "./agentTransportInterface";
import { ConnectionRegistry, type PushConnection } from "./connectionRegistry";

class WsPushConnection implements PushConnection {
  readonly id: string;
  readonly #socket: WebSocket;

  constructor(id: string, socket: WebSocket) {
    this.id = id;
    this.#socket = socket;
  }

  async send(message: unknown): Promise<void> {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }

    await new Promise<void>((resolve, reject) => {
      this.#socket.send(JSON.stringify(message), (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

const toBackendError = (error: unknown): BackendError => {
  if (
    error instanceof NotFoundError ||
    error instanceof InvalidStateError ||
    error instanceof ProviderUnavailableError ||
    error instanceof ProviderFailureError ||
    error instanceof PersistenceError
  ) {
    return error;
  }

  return new InvalidStateError({
    code: "backend_unexpected_error",
    detail: error instanceof Error ? error.message : String(error),
  });
};

export class WebSocketCommandServer implements AgentTransportInterface {
  readonly #connections: ConnectionRegistry;
  readonly #contextCore: ContextCoreInterface;
  readonly #assistantTurnEngine: AssistantTurnEngineInterface;
  readonly #providerAuth: ProviderAuthServiceApi;
  readonly #providerCatalog: ProviderCatalogInterface;
  readonly #server: WebSocketServer;

  constructor(args: {
    readonly httpServer: Server;
    readonly contextCore: ContextCoreInterface;
    readonly assistantTurnEngine: AssistantTurnEngineInterface;
    readonly providerAuth: ProviderAuthServiceApi;
    readonly providerRegistry: ProviderCatalogInterface;
    readonly connections?: ConnectionRegistry;
  }) {
    this.#contextCore = args.contextCore;
    this.#assistantTurnEngine = args.assistantTurnEngine;
    this.#providerAuth = args.providerAuth;
    this.#providerCatalog = args.providerRegistry;
    this.#connections = args.connections ?? new ConnectionRegistry();
    this.#server = new WebSocketServer({ server: args.httpServer });
    this.#providerAuth.subscribe(async (auth) => {
      await this.#connections.broadcast({
        channel: "provider.authStateChanged",
        auth,
      });
    });
    this.#server.on("connection", (socket) => {
      const connectionId = createId("conn");
      const connection = new WsPushConnection(connectionId, socket);
      this.#connections.register(connection);

      socket.send(
        JSON.stringify({
          channel: "transport.connectionState",
          state: "connected",
          detail: "WebSocket connected",
        }),
      );

      socket.on("message", async (rawMessage) => {
        try {
          const envelope = JSON.parse(rawMessage.toString()) as CommandEnvelope;
          const response = await this.handleCommand(envelope, connectionId);
          socket.send(JSON.stringify(response));
        } catch (error) {
          socket.send(
            JSON.stringify({
              requestId: createId("request"),
              result: {
                ok: false,
                error: {
                  code: "invalid_request",
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              },
            } satisfies CommandResponseEnvelope),
          );
        }
      });

      socket.on("close", () => {
        this.#connections.unregister(connectionId);
      });
    });
  }

  async #readProviderAuthState(
    providerKey: string,
  ): Promise<ProviderAuthState> {
    if (providerKey === "codex") {
      return this.#providerAuth.read(providerKey);
    }

    return {
      providerKey,
      requiresOpenaiAuth: false,
      account: null,
      login: {
        status: "idle",
        loginId: null,
        authUrl: null,
        startedAt: null,
        expiresAt: null,
        error: null,
      },
    };
  }

  async #readBootstrapState() {
    const providerAuthEntries = await Promise.all(
      this.#providerCatalog
        .list()
        .map(
          async (provider) =>
            [
              provider.key,
              await this.#readProviderAuthState(provider.key),
            ] as const,
        ),
    );
    const providerCapabilityEntries = this.#providerCatalog
      .list()
      .map((provider) => [provider.key, provider.listCapabilities()] as const);

    return {
      providerAuth: Object.fromEntries(providerAuthEntries),
      providerCapabilities: Object.fromEntries(providerCapabilityEntries),
    };
  }

  async handleCommand(
    envelope: CommandEnvelope,
    connectionId: string,
  ): Promise<CommandResponseEnvelope> {
    try {
      switch (envelope.command.type) {
        case "app.bootstrap": {
          const bootstrapState = await this.#readBootstrapState();
          const activeBranch = envelope.command.payload.bookmarkId
            ? this.#contextCore.selectBookmark({
                bookmarkId: envelope.command.payload.bookmarkId,
              })
            : null;
          if (activeBranch) {
            this.#connections.subscribeBookmark(
              connectionId,
              activeBranch.bookmarkId,
            );
          }
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "bootstrap",
                bootstrap: {
                  bookmarkSummaries: this.#contextCore.listBookmarks(),
                  activeBranch,
                  providerAuth: bootstrapState.providerAuth,
                  providerCapabilities: bootstrapState.providerCapabilities,
                },
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "bookmark.list":
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "bookmarkList",
                bookmarkSummaries: this.#contextCore.listBookmarks(),
              },
            },
          } satisfies CommandResponseEnvelope;
        case "bookmark.create": {
          const branch = this.#contextCore.createBookmark(
            envelope.command.payload,
          );
          this.#connections.subscribeBookmark(connectionId, branch.bookmarkId);
          return this.#branchResponse(envelope.requestId, branch);
        }
        case "bookmark.select": {
          const branch = this.#contextCore.selectBookmark(
            envelope.command.payload,
          );
          this.#connections.subscribeBookmark(connectionId, branch.bookmarkId);
          return this.#branchResponse(envelope.requestId, branch);
        }
        case "bookmark.rename":
          return this.#branchResponse(
            envelope.requestId,
            this.#contextCore.renameBookmark(envelope.command.payload),
          );
        case "bookmark.delete": {
          this.#contextCore.deleteBookmark(envelope.command.payload);
          await this.#connections.broadcast({
            channel: "bookmark.deleted",
            bookmarkId: envelope.command.payload.bookmarkId,
          });
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "bookmarkDeleted",
                bookmarkId: envelope.command.payload.bookmarkId,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "bookmark.sendMessage":
          this.#connections.subscribeBookmark(
            connectionId,
            envelope.command.payload.bookmarkId,
          );
          void this.#assistantTurnEngine.sendMessage(envelope.command.payload);
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "accepted",
                bookmarkId: envelope.command.payload.bookmarkId,
              },
            },
          } satisfies CommandResponseEnvelope;
        case "bookmark.stopTurn":
          return this.#branchResponse(
            envelope.requestId,
            await this.#assistantTurnEngine.stopTurn(envelope.command.payload),
          );
        case "bookmark.retryTurn":
          this.#connections.subscribeBookmark(
            connectionId,
            envelope.command.payload.bookmarkId,
          );
          void this.#assistantTurnEngine.retryTurn(envelope.command.payload);
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "accepted",
                bookmarkId: envelope.command.payload.bookmarkId,
              },
            },
          } satisfies CommandResponseEnvelope;
        case "bookmark.resume": {
          const branch = this.#contextCore.selectBookmark(
            envelope.command.payload,
          );
          this.#connections.subscribeBookmark(connectionId, branch.bookmarkId);
          return this.#branchResponse(envelope.requestId, branch);
        }
        case "tool.approval.respond":
          throw new InvalidStateError({
            code: "tool_approval_not_supported",
            detail: "Interactive tool approvals are not wired yet.",
          });
        case "provider.auth.read": {
          const auth = await this.#providerAuth.read(
            envelope.command.payload.providerKey,
            envelope.command.payload.refreshToken ?? false,
          );
          return this.#authResponse(envelope.requestId, auth);
        }
        case "provider.auth.login.start": {
          const auth = await this.#providerAuth.startChatGptLogin(
            envelope.command.payload.providerKey,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: { kind: "providerAuthLoginStart", auth },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "provider.auth.login.cancel": {
          await this.#providerAuth.cancelLogin(
            envelope.command.payload.providerKey,
            envelope.command.payload.loginId,
          );
          return this.#authResponse(
            envelope.requestId,
            await this.#providerAuth.read(envelope.command.payload.providerKey),
          );
        }
        case "provider.auth.logout": {
          await this.#providerAuth.logout(envelope.command.payload.providerKey);
          return this.#authResponse(
            envelope.requestId,
            await this.#providerAuth.read(envelope.command.payload.providerKey),
          );
        }
      }
    } catch (error) {
      const backendError = toBackendError(error);
      return {
        requestId: envelope.requestId,
        result: {
          ok: false,
          error: {
            code: backendErrorCode(backendError),
            message: backendErrorMessage(backendError),
          },
        },
      } satisfies CommandResponseEnvelope;
    }
  }

  #branchResponse(
    requestId: string,
    branch: import("@magick/contracts/chat").BranchViewModel,
  ): CommandResponseEnvelope {
    return {
      requestId,
      result: {
        ok: true,
        data: { kind: "branchState", branch },
      },
    } satisfies CommandResponseEnvelope;
  }

  #authResponse(
    requestId: string,
    auth: ProviderAuthState,
  ): CommandResponseEnvelope {
    return {
      requestId,
      result: {
        ok: true,
        data: { kind: "providerAuthState", auth },
      },
    } satisfies CommandResponseEnvelope;
  }
}
