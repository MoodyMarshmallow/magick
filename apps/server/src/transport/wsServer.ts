// Handles websocket commands and bridges transport requests into backend Effect services.

import type { Server } from "node:http";

import { Cause, Effect, Exit, Option } from "effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import { type WebSocket, WebSocketServer } from "ws";

import type { DomainEvent } from "../../../../packages/contracts/src/chat";
import type {
  CommandEnvelope,
  CommandResponseEnvelope,
} from "../../../../packages/contracts/src/ws";
import { createId } from "../../../../packages/shared/src/id";
import {
  ProviderAuthService,
  type ProviderAuthServiceApi,
} from "../application/providerAuthService";
import {
  ReplayService,
  type ReplayServiceApi,
} from "../application/replayService";
import {
  ThreadOrchestrator,
  type ThreadOrchestratorApi,
} from "../application/threadOrchestrator";
import type { BackendError } from "../effect/errors";
import { backendErrorCode, backendErrorMessage } from "../effect/errors";
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

type TransportRuntime =
  | ProviderAuthServiceApi
  | ReplayServiceApi
  | ThreadOrchestratorApi;

export class WebSocketCommandServer {
  readonly #connections: ConnectionRegistry;
  readonly #runtime: ManagedRuntime.ManagedRuntime<TransportRuntime, never>;
  readonly #server: WebSocketServer;

  constructor(args: {
    httpServer: Server;
    runtime: ManagedRuntime.ManagedRuntime<TransportRuntime, never>;
    connections?: ConnectionRegistry;
  }) {
    this.#runtime = args.runtime;
    this.#connections = args.connections ?? new ConnectionRegistry();
    this.#server = new WebSocketServer({ server: args.httpServer });
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

  async handleCommand(
    envelope: CommandEnvelope,
    connectionId: string,
  ): Promise<CommandResponseEnvelope> {
    const connections = this.#connections;
    const program = Effect.gen(function* () {
      const orchestrator = yield* ThreadOrchestrator;
      const providerAuth = yield* ProviderAuthService;
      const replayService = yield* ReplayService;

      switch (envelope.command.type) {
        case "app.bootstrap": {
          const threadSummaries = yield* orchestrator.listThreads(
            envelope.command.payload.workspaceId,
          );
          const activeThread = envelope.command.payload.threadId
            ? yield* orchestrator.openThread(envelope.command.payload.threadId)
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
              ok: true as const,
              data: {
                kind: "bootstrap" as const,
                threadSummaries,
                activeThread,
                capabilities: null,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.list":
          return {
            requestId: envelope.requestId,
            result: {
              ok: true as const,
              data: {
                kind: "threadList" as const,
                threadSummaries: yield* orchestrator.listThreads(
                  envelope.command.payload.workspaceId,
                ),
              },
            },
          } satisfies CommandResponseEnvelope;
        case "thread.create": {
          const thread = yield* orchestrator.createThread(
            envelope.command.payload,
          );
          connections.subscribeThread(connectionId, thread.threadId);
          return {
            requestId: envelope.requestId,
            result: {
              ok: true as const,
              data: {
                kind: "threadState" as const,
                thread,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.open": {
          const thread = yield* orchestrator.openThread(
            envelope.command.payload.threadId,
          );
          connections.subscribeThread(connectionId, thread.threadId);
          return {
            requestId: envelope.requestId,
            result: {
              ok: true as const,
              data: {
                kind: "threadState" as const,
                thread,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.sendMessage":
          connections.subscribeThread(
            connectionId,
            envelope.command.payload.threadId,
          );
          yield* orchestrator.sendMessage(
            envelope.command.payload.threadId,
            envelope.command.payload.content,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true as const,
              data: {
                kind: "accepted" as const,
                threadId: envelope.command.payload.threadId,
              },
            },
          } satisfies CommandResponseEnvelope;
        case "thread.stopTurn": {
          const thread = yield* orchestrator.stopTurn(
            envelope.command.payload.threadId,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true as const,
              data: {
                kind: "threadState" as const,
                thread,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "thread.retryTurn":
          yield* orchestrator.retryTurn(envelope.command.payload.threadId);
          return {
            requestId: envelope.requestId,
            result: {
              ok: true as const,
              data: {
                kind: "accepted" as const,
                threadId: envelope.command.payload.threadId,
              },
            },
          } satisfies CommandResponseEnvelope;
        case "thread.resume": {
          connections.subscribeThread(
            connectionId,
            envelope.command.payload.threadId,
          );
          const thread = yield* orchestrator.ensureSession(
            envelope.command.payload.threadId,
          );
          const replayedEvents = yield* replayService.replayThread(
            envelope.command.payload.threadId,
            envelope.command.payload.afterSequence ?? 0,
          );

          return {
            requestId: envelope.requestId,
            result: {
              ok: true as const,
              data: {
                kind: "threadState" as const,
                thread,
                replayedEvents,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "provider.auth.read": {
          const auth = yield* providerAuth.read(
            envelope.command.payload.providerKey,
            envelope.command.payload.refreshToken ?? false,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true as const,
              data: {
                kind: "providerAuthState" as const,
                auth,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "provider.auth.login.start": {
          const auth = yield* providerAuth.startChatGptLogin(
            envelope.command.payload.providerKey,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true as const,
              data: {
                kind: "providerAuthLoginStart" as const,
                auth,
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "provider.auth.login.cancel": {
          yield* providerAuth.cancelLogin(
            envelope.command.payload.providerKey,
            envelope.command.payload.loginId,
          );
          return {
            requestId: envelope.requestId,
            result: {
              ok: true as const,
              data: {
                kind: "providerAuthState" as const,
                auth: yield* providerAuth.read(
                  envelope.command.payload.providerKey,
                ),
              },
            },
          } satisfies CommandResponseEnvelope;
        }
        case "provider.auth.logout": {
          yield* providerAuth.logout(envelope.command.payload.providerKey);
          return {
            requestId: envelope.requestId,
            result: {
              ok: true as const,
              data: {
                kind: "providerAuthState" as const,
                auth: yield* providerAuth.read(
                  envelope.command.payload.providerKey,
                ),
              },
            },
          } satisfies CommandResponseEnvelope;
        }
      }
    });

    return this.#runtime.runPromiseExit(program).then((exit) => {
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }

      const failure = Cause.failureOption(exit.cause);
      const backendError = Option.isSome(failure)
        ? (failure.value as BackendError)
        : ({
            _tag: "ReplayError",
            threadId: "unknown",
            detail: "Unhandled runtime failure",
          } as BackendError);

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
    });
  }
}
