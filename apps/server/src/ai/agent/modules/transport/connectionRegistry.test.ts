// Verifies connection subscription and unsubscribe behavior for websocket push delivery.

import { ConnectionRegistry } from "./connectionRegistry";

describe("ConnectionRegistry", () => {
  it("publishes only to subscribed bookmark connections", async () => {
    const registry = new ConnectionRegistry();
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];

    registry.register({
      id: "conn_a",
      send: async (message) => {
        receivedA.push(message);
      },
    });
    registry.register({
      id: "conn_b",
      send: async (message) => {
        receivedB.push(message);
      },
    });

    registry.subscribeBookmark("conn_a", "bookmark_1");
    registry.subscribeBookmark("conn_b", "bookmark_2");

    await registry.publishToBookmark("bookmark_1", {
      channel: "transport.connectionState",
      state: "connected",
      detail: "ok",
    });

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(0);
  });

  it("removes subscriptions when a connection unregisters", async () => {
    const registry = new ConnectionRegistry();
    const received: unknown[] = [];

    registry.register({
      id: "conn_a",
      send: async (message) => {
        received.push(message);
      },
    });

    registry.subscribeBookmark("conn_a", "bookmark_1");
    registry.unregister("conn_a");

    await registry.publishToBookmark("bookmark_1", {
      channel: "transport.connectionState",
      state: "connected",
      detail: "ok",
    });

    expect(received).toHaveLength(0);
  });

  it("ignores subscriptions for unknown connections", async () => {
    const registry = new ConnectionRegistry();
    const received: unknown[] = [];

    registry.register({
      id: "conn_a",
      send: async (message) => {
        received.push(message);
      },
    });

    registry.subscribeBookmark("missing_conn", "bookmark_1");

    await registry.publishToBookmark("bookmark_1", {
      channel: "transport.connectionState",
      state: "connected",
      detail: "ok",
    });

    expect(received).toHaveLength(0);
  });

  it("broadcasts connection messages to all registered connections", async () => {
    const registry = new ConnectionRegistry();
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];

    registry.register({
      id: "conn_a",
      send: async (message) => {
        receivedA.push(message);
      },
    });
    registry.register({
      id: "conn_b",
      send: async (message) => {
        receivedB.push(message);
      },
    });

    await registry.broadcast({
      channel: "transport.connectionState",
      state: "connected",
      detail: "all good",
    });

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
  });

  it("drops failed connections without failing delivery to healthy subscribers", async () => {
    const registry = new ConnectionRegistry();
    const received: unknown[] = [];

    registry.register({
      id: "conn_bad",
      send: async () => {
        throw new Error("socket closed");
      },
    });
    registry.register({
      id: "conn_good",
      send: async (message) => {
        received.push(message);
      },
    });

    registry.subscribeBookmark("conn_bad", "bookmark_1");
    registry.subscribeBookmark("conn_good", "bookmark_1");

    await expect(
      registry.publishToBookmark("bookmark_1", {
        channel: "transport.connectionState",
        state: "connected",
        detail: "ok",
      }),
    ).resolves.toBeUndefined();

    await expect(
      registry.broadcast({
        channel: "transport.connectionState",
        state: "connected",
        detail: "ok",
      }),
    ).resolves.toBeUndefined();

    expect(received).toHaveLength(2);
  });
});
