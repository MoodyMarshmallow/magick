// Tracks websocket connections and per-thread subscriptions for server push delivery.

import type { ServerPushEnvelope } from "@magick/contracts/ws";

export interface PushConnection {
  readonly id: string;
  send(message: ServerPushEnvelope): Promise<void>;
}

export class ConnectionRegistry {
  readonly #connections = new Map<string, PushConnection>();
  readonly #threadSubscriptions = new Map<string, Set<string>>();

  async #sendToConnection(
    connection: PushConnection,
    message: ServerPushEnvelope,
  ): Promise<void> {
    try {
      await connection.send(message);
    } catch {
      this.unregister(connection.id);
    }
  }

  register(connection: PushConnection): void {
    this.#connections.set(connection.id, connection);
  }

  unregister(connectionId: string): void {
    this.#connections.delete(connectionId);
    for (const subscribers of this.#threadSubscriptions.values()) {
      subscribers.delete(connectionId);
    }
  }

  subscribeThread(connectionId: string, threadId: string): void {
    const subscribers =
      this.#threadSubscriptions.get(threadId) ?? new Set<string>();
    subscribers.add(connectionId);
    this.#threadSubscriptions.set(threadId, subscribers);
  }

  async publishToThread(
    threadId: string,
    message: ServerPushEnvelope,
  ): Promise<void> {
    const subscribers = this.#threadSubscriptions.get(threadId);
    if (!subscribers) {
      return;
    }

    await Promise.all(
      [...subscribers]
        .map((connectionId) => this.#connections.get(connectionId))
        .filter((connection): connection is PushConnection =>
          Boolean(connection),
        )
        .map((connection) => this.#sendToConnection(connection, message)),
    );
  }

  async broadcast(message: ServerPushEnvelope): Promise<void> {
    await Promise.all(
      [...this.#connections.values()].map((connection) =>
        this.#sendToConnection(connection, message),
      ),
    );
  }
}
