// Verifies connection subscription and unsubscribe behavior for websocket push delivery.

import { ConnectionRegistry } from "./connectionRegistry";

describe("ConnectionRegistry", () => {
  it("publishes only to subscribed thread connections", async () => {
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

    registry.subscribeThread("conn_a", "thread_1");
    registry.subscribeThread("conn_b", "thread_2");

    await registry.publishToThread("thread_1", {
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

    registry.subscribeThread("conn_a", "thread_1");
    registry.unregister("conn_a");

    await registry.publishToThread("thread_1", {
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

    registry.subscribeThread("conn_bad", "thread_1");
    registry.subscribeThread("conn_good", "thread_1");

    await expect(
      registry.publishToThread("thread_1", {
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
