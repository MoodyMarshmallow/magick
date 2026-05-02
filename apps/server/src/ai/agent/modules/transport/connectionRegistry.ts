// Tracks websocket connections and per-bookmark subscriptions for server push delivery.

import type { ServerPushEnvelope } from "@magick/contracts/ws";

export interface PushConnection {
  readonly id: string;
  send(message: ServerPushEnvelope): Promise<void>;
}

export class ConnectionRegistry {
  readonly #connections = new Map<string, PushConnection>();
  readonly #bookmarkSubscriptions = new Map<string, Set<string>>();

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
    for (const [
      bookmarkId,
      subscribers,
    ] of this.#bookmarkSubscriptions.entries()) {
      subscribers.delete(connectionId);
      if (subscribers.size === 0) {
        this.#bookmarkSubscriptions.delete(bookmarkId);
      }
    }
  }

  subscribeBookmark(connectionId: string, bookmarkId: string): void {
    if (!this.#connections.has(connectionId)) {
      return;
    }

    const subscribers =
      this.#bookmarkSubscriptions.get(bookmarkId) ?? new Set<string>();
    subscribers.add(connectionId);
    this.#bookmarkSubscriptions.set(bookmarkId, subscribers);
  }

  async publishToBookmark(
    bookmarkId: string,
    message: ServerPushEnvelope,
  ): Promise<void> {
    const subscribers = this.#bookmarkSubscriptions.get(bookmarkId);
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
