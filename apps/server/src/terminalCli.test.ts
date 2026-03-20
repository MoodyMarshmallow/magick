// Verifies the terminal CLI command parser understands the supported manual test commands.

import { parseCommand, sendCommand } from "./terminalCli";

type MessageHandler = (raw: Buffer) => void;
type CloseHandler = () => void;
type ErrorHandler = (error: Error) => void;

class MockSocket {
  readyState = 1;
  sentPayloads: string[] = [];

  readonly handlers = {
    message: new Set<MessageHandler>(),
    close: new Set<CloseHandler>(),
    error: new Set<ErrorHandler>(),
  };

  on(event: "message" | "close" | "error", handler: unknown): this {
    if (event === "message") {
      this.handlers.message.add(handler as MessageHandler);
      return this;
    }

    if (event === "close") {
      this.handlers.close.add(handler as CloseHandler);
      return this;
    }

    this.handlers.error.add(handler as ErrorHandler);
    return this;
  }

  off(event: "message" | "close" | "error", handler: unknown): this {
    if (event === "message") {
      this.handlers.message.delete(handler as MessageHandler);
      return this;
    }

    if (event === "close") {
      this.handlers.close.delete(handler as CloseHandler);
      return this;
    }

    this.handlers.error.delete(handler as ErrorHandler);
    return this;
  }

  send(payload: string): void {
    this.sentPayloads.push(payload);
  }

  emitMessage(payload: unknown): void {
    const raw = Buffer.from(JSON.stringify(payload));
    for (const handler of this.handlers.message) {
      handler(raw);
    }
  }

  emitClose(): void {
    for (const handler of this.handlers.close) {
      handler();
    }
  }

  emitError(error: Error): void {
    for (const handler of this.handlers.error) {
      handler(error);
    }
  }
}

describe("parseCommand", () => {
  it("parses slash commands and plain text sends", () => {
    expect(parseCommand("hello")).toEqual({ type: "send", content: "hello" });
    expect(parseCommand("/threads")).toEqual({ type: "threads" });
    expect(parseCommand("/new fake")).toEqual({
      type: "new",
      providerKey: "fake",
    });
    expect(parseCommand("/login")).toEqual({ type: "login" });
  });

  it("rejects invalid or incomplete commands", () => {
    expect(() => parseCommand("/open")).toThrow("Usage: /open <threadId>");
    expect(() => parseCommand("/send")).toThrow("Usage: /send <message>");
    expect(() => parseCommand("/wat")).toThrow("Unknown command '/wat'");
  });
});

describe("sendCommand", () => {
  it("rejects when the socket closes before the response arrives", async () => {
    const socket = new MockSocket();
    const pending = sendCommand(
      socket as never,
      {
        type: "thread.list",
        payload: { workspaceId: "workspace_1" },
      },
      { timeoutMs: 50 },
    );

    socket.emitClose();

    await expect(pending).rejects.toThrow(
      "WebSocket closed before a response arrived.",
    );
  });

  it("times out when no matching response arrives", async () => {
    vi.useFakeTimers();

    try {
      const socket = new MockSocket();
      const pending = sendCommand(
        socket as never,
        {
          type: "thread.list",
          payload: { workspaceId: "workspace_1" },
        },
        { timeoutMs: 25 },
      );
      const expectation = expect(pending).rejects.toThrow(
        "Command timed out after 25ms without a response.",
      );

      await vi.advanceTimersByTimeAsync(25);

      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
