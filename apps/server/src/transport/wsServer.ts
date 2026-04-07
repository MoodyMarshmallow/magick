// Handles websocket commands and bridges transport requests into backend services.

import type { Server } from "node:http";

import { Cause, Effect, Exit, Option } from "effect";
import { type WebSocket, WebSocketServer } from "ws";

import type { DomainEvent } from "@magick/contracts/chat";
import type { ProviderAuthState } from "@magick/contracts/provider";
import type {
  CommandEnvelope,
  CommandResponseEnvelope,
} from "@magick/contracts/ws";
import { createId } from "@magick/shared/id";
import type { ProviderAuthServiceApi } from "../application/providerAuthService";
import type { ProviderRegistry } from "../application/providerRegistry";
import type { ReplayServiceApi } from "../application/replayService";
import type { ThreadOrchestratorApi } from "../application/threadOrchestrator";
import type { BackendError } from "../core/errors";
import {
  InvalidStateError,
  NotFoundError,
  PersistenceError,
  ProviderFailureError,
  ProviderUnavailableError,
  ReplayError,
  backendErrorCode,
  backendErrorMessage,
} from "../core/errors";
import { ConnectionRegistry, type PushConnection } from "./connectionRegistry";

class WsPushConnection implements PushConnection {
  readonly id: string;
  readonly #socket: WebSocket;

  constructor(id: string, socket: WebSocket) {
    this.id = id;
    this.#socket = socket;
  }

  async send(message: unknown): Promise<void> {
    this.#socket.send(JSON.stringify(message));
  }
}

const toBackendError = (error: unknown): BackendError => {
  if (
    error instanceof NotFoundError ||
    error instanceof InvalidStateError ||
    error instanceof ProviderUnavailableError ||
    error instanceof ProviderFailureError ||
    error instanceof PersistenceError ||
    error instanceof ReplayError
  ) {
    return error;
  }

  return new InvalidStateError({
    code: "backend_unexpected_error",
    detail: error instanceof Error ? error.message : String(error),
  });
};

const runBackendEffect = <A>(
  effect: Effect.Effect<A, BackendError>,
): Promise<A> =>
  Effect.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) {
      return exit.value;
    }

    const failure = Cause.failureOption(exit.cause);
    if (Option.isSome(failure)) {
      throw failure.value;
    }

    throw new Error("Unhandled backend effect failure");
  });

export class WebSocketCommandServer {
  readonly #connections: ConnectionRegistry;
  readonly #providerAuth: ProviderAuthServiceApi;
  readonly #providerRegistry: ProviderRegistry;
  readonly #replayService: ReplayServiceApi;
  readonly #threadOrchestrator: ThreadOrchestratorApi;
  readonly #server: WebSocketServer;

  constructor(args: {
    httpServer: Server;
    providerAuth: ProviderAuthServiceApi;
    providerRegistry: ProviderRegistry;
    replayService: ReplayServiceApi;
    threadOrchestrator: ThreadOrchestratorApi;
    connections?: ConnectionRegistry;
  }) {
    this.#providerAuth = args.providerAuth;
    this.#providerRegistry = args.providerRegistry;
    this.#replayService = args.replayService;
    this.#threadOrchestrator = args.threadOrchestrator;
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
          const response: CommandResponseEnvelope = {
            requestId: createId("request"),
            result: {
              ok: false,
              error: {
                code: "invalid_request",
                message: error instanceof Error ? error.message : String(error),
              },
            },
          };
          socket.send(JSON.stringify(response));
        }
      });

      socket.on("close", () => {
        this.#connections.unregister(connectionId);
      });
    });
  }

  async publish(events: readonly DomainEvent[]): Promise<void> {
    await Promise.all(
      events.map((event) =>
        this.#connections.publishToThread(event.threadId, {
          channel: "orchestration.domainEvent",
          threadId: event.threadId,
          event,
        }),
      ),
    );
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
      activeLoginId: null,
    };
  }

  async #readBootstrapState() {
    const providerAuthEntries = await Promise.all(
      this.#providerRegistry
        .list()
        .map(
          async (provider) =>
            [
              provider.key,
              await this.#readProviderAuthState(provider.key),
            ] as const,
        ),
    );
    const providerCapabilityEntries = this.#providerRegistry
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
    const connections = this.#connections;

    try {
      switch (envelope.command.type) {
        case "app.bootstrap": {
          const bootstrapState = await this.#readBootstrapState();
          const threadSummaries = await this.#threadOrchestrator.listThreads(
            envelope.command.payload.workspaceId,
          );
          const activeThread = envelope.command.payload.threadId
            ? await this.#threadOrchestrator.openThread(
                envelope.command.payload.threadId,
              )
            : null;

          if (envelope.command.payload.threadId) {
            connections.subscribeThread(
              connectionId,
              envelope.command.payload.threadId,
            );
          }

          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "bootstrap",
                bootstrap: {
                  threadSummaries,
                  activeThread,
                  providerAuth: bootstrapState.providerAuth,
                  providerCapabilities: bootstrapState.providerCapabilities,
                },
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.list":
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "threadList",
                threadSummaries: await this.#threadOrchestrator.listThreads(
                  envelope.command.payload.workspaceId,
                ),
              },
            },
          } satisfies CommandResponseEnvelope;
        case "thread.create": {
          const thread = await this.#threadOrchestrator.createThread(
            envelope.command.payload,
          );
          connections.subscribeThread(connectionId, thread.threadId);
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "threadState",
                thread,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.open": {
          const thread = await this.#threadOrchestrator.openThread(
            envelope.command.payload.threadId,
          );
          connections.subscribeThread(connectionId, thread.threadId);
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "threadState",
                thread,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.rename": {
          const thread = await this.#threadOrchestrator.renameThread(
            envelope.command.payload.threadId,
            envelope.command.payload.title,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "threadState",
                thread,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.delete": {
          const deletedThread = await this.#threadOrchestrator.deleteThread(
            envelope.command.payload.threadId,
          );
          await connections.broadcast({
            channel: "thread.deleted",
            threadId: deletedThread.threadId,
            workspaceId: deletedThread.workspaceId,
          });
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "threadDeleted",
                threadId: envelope.command.payload.threadId,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.sendMessage":
          connections.subscribeThread(
            connectionId,
            envelope.command.payload.threadId,
          );
          await runBackendEffect(
            this.#threadOrchestrator.sendMessage(
              envelope.command.payload.threadId,
              envelope.command.payload.content,
            ),
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "accepted",
                threadId: envelope.command.payload.threadId,
              },
            },
          } satisfies CommandResponseEnvelope;
        case "thread.resolve": {
          const thread = await this.#threadOrchestrator.resolveThread(
            envelope.command.payload.threadId,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "threadState",
                thread,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.reopen": {
          const thread = await this.#threadOrchestrator.reopenThread(
            envelope.command.payload.threadId,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "threadState",
                thread,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.stopTurn": {
          const thread = await runBackendEffect(
            this.#threadOrchestrator.stopTurn(
              envelope.command.payload.threadId,
            ),
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "threadState",
                thread,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.retryTurn":
          await runBackendEffect(
            this.#threadOrchestrator.retryTurn(
              envelope.command.payload.threadId,
            ),
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "accepted",
                threadId: envelope.command.payload.threadId,
              },
            },
          } satisfies CommandResponseEnvelope;
        case "tool.approval.respond":
          throw new InvalidStateError({
            code: "tool_approval_not_supported",
            detail: "Interactive tool approvals are not wired yet.",
          });
        case "thread.resume": {
          connections.subscribeThread(
            connectionId,
            envelope.command.payload.threadId,
          );
          const thread = await this.#threadOrchestrator.ensureSession(
            envelope.command.payload.threadId,
          );
          const replayedEvents = this.#replayService.replayThread(
            envelope.command.payload.threadId,
            envelope.command.payload.afterSequence ?? 0,
          );

          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "threadState",
                thread,
                replayedEvents,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "provider.auth.read": {
          const auth = await this.#providerAuth.read(
            envelope.command.payload.providerKey,
            envelope.command.payload.refreshToken ?? false,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "providerAuthState",
                auth,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "provider.auth.login.start": {
          const auth = await this.#providerAuth.startChatGptLogin(
            envelope.command.payload.providerKey,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "providerAuthLoginStart",
                auth,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "provider.auth.login.cancel": {
          await this.#providerAuth.cancelLogin(
            envelope.command.payload.providerKey,
            envelope.command.payload.loginId,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "providerAuthState",
                auth: await this.#providerAuth.read(
                  envelope.command.payload.providerKey,
                ),
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "provider.auth.logout": {
          await this.#providerAuth.logout(envelope.command.payload.providerKey);
          return {
            requestId: envelope.requestId,
            result: {
              ok: true,
              data: {
                kind: "providerAuthState",
                auth: await this.#providerAuth.read(
                  envelope.command.payload.providerKey,
                ),
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        default:
          throw new InvalidStateError({
            code: "unsupported_command",
            detail: `Unsupported command '${(envelope.command as { type: string }).type}'.`,
          });
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
}
