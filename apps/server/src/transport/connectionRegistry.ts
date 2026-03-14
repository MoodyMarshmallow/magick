import type { ServerPushEnvelope } from "../../../../packages/contracts/src/ws";

export interface PushConnection {
  readonly id: string;
  send(message: ServerPushEnvelope): Promise<void>;
}

export class ConnectionRegistry {
  readonly #connections = new Map<string, PushConnection>();
  readonly #threadSubscriptions = new Map<string, Set<string>>();

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
        .map((connection) => connection.send(message)),
    );
  }

  async broadcast(message: ServerPushEnvelope): Promise<void> {
    await Promise.all(
      [...this.#connections.values()].map((connection) =>
        connection.send(message),
      ),
    );
  }
}
