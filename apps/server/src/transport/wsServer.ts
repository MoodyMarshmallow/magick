import type { Server } from "node:http";

import { type WebSocket, WebSocketServer } from "ws";

import type { DomainEvent } from "../../../../packages/contracts/src/chat";
import type {
  CommandEnvelope,
  CommandResponseEnvelope,
} from "../../../../packages/contracts/src/ws";
import {
  MagickError,
  toErrorMessage,
} from "../../../../packages/shared/src/errors";
import { createId } from "../../../../packages/shared/src/id";
import type { ReplayService } from "../application/replayService";
import type { ThreadOrchestrator } from "../application/threadOrchestrator";
import type { EventPublisher } from "../providers/providerTypes";
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

export class WebSocketCommandServer implements EventPublisher {
  readonly #orchestrator: ThreadOrchestrator;
  readonly #replayService: ReplayService;
  readonly #connections: ConnectionRegistry;
  readonly #server: WebSocketServer;

  constructor(args: {
    httpServer: Server;
    orchestrator: ThreadOrchestrator;
    replayService: ReplayService;
    connections?: ConnectionRegistry;
  }) {
    this.#orchestrator = args.orchestrator;
    this.#replayService = args.replayService;
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
                message: toErrorMessage(error),
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
    try {
      const result = await (async () => {
        switch (envelope.command.type) {
          case "app.bootstrap": {
            const summaries = this.#orchestrator.listThreads(
              envelope.command.payload.workspaceId,
            );
            const activeThread = envelope.command.payload.threadId
              ? this.#orchestrator.openThread(envelope.command.payload.threadId)
              : null;
            if (envelope.command.payload.threadId) {
              this.#connections.subscribeThread(
                connectionId,
                envelope.command.payload.threadId,
              );
            }

            return {
              ok: true as const,
              data: {
                kind: "bootstrap" as const,
                threadSummaries: summaries,
                activeThread,
                capabilities: null,
              },
            };
          }
          case "thread.list":
            return {
              ok: true as const,
              data: {
                kind: "threadList" as const,
                threadSummaries: this.#orchestrator.listThreads(
                  envelope.command.payload.workspaceId,
                ),
              },
            };
          case "thread.create": {
            const thread = await this.#orchestrator.createThread(
              envelope.command.payload,
            );
            this.#connections.subscribeThread(connectionId, thread.threadId);
            return {
              ok: true as const,
              data: {
                kind: "threadState" as const,
                thread,
              },
            };
          }
          case "thread.open": {
            const thread = this.#orchestrator.openThread(
              envelope.command.payload.threadId,
            );
            this.#connections.subscribeThread(connectionId, thread.threadId);
            return {
              ok: true as const,
              data: {
                kind: "threadState" as const,
                thread,
              },
            };
          }
          case "thread.sendMessage": {
            this.#connections.subscribeThread(
              connectionId,
              envelope.command.payload.threadId,
            );
            await this.#orchestrator.sendMessage(
              envelope.command.payload.threadId,
              envelope.command.payload.content,
            );
            return {
              ok: true as const,
              data: {
                kind: "accepted" as const,
                threadId: envelope.command.payload.threadId,
              },
            };
          }
          case "thread.stopTurn": {
            const thread = await this.#orchestrator.stopTurn(
              envelope.command.payload.threadId,
            );
            return {
              ok: true as const,
              data: {
                kind: "threadState" as const,
                thread,
              },
            };
          }
          case "thread.retryTurn": {
            await this.#orchestrator.retryTurn(
              envelope.command.payload.threadId,
            );
            return {
              ok: true as const,
              data: {
                kind: "accepted" as const,
                threadId: envelope.command.payload.threadId,
              },
            };
          }
          case "thread.resume": {
            this.#connections.subscribeThread(
              connectionId,
              envelope.command.payload.threadId,
            );
            const thread = await this.#orchestrator.ensureSession(
              envelope.command.payload.threadId,
            );
            const replayedEvents = await this.#replayService.replayThread(
              envelope.command.payload.threadId,
              envelope.command.payload.afterSequence ?? 0,
            );

            return {
              ok: true as const,
              data: {
                kind: "threadState" as const,
                thread,
                replayedEvents,
              },
            };
          }
        }
      })();

      return {
        requestId: envelope.requestId,
        result,
      };
    } catch (error) {
      const magickError =
        error instanceof MagickError
          ? error
          : new MagickError("internal_error", toErrorMessage(error));

      return {
        requestId: envelope.requestId,
        result: {
          ok: false,
          error: {
            code: magickError.code,
            message: magickError.message,
          },
        },
      };
    }
  }
}
