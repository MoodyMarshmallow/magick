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
});
