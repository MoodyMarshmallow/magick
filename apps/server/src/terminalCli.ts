// Starts a local backend server and provides an interactive terminal client over WebSocket for end-to-end manual testing.

import { createServer } from "node:http";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { WebSocket } from "ws";

import type {
  CommandEnvelope,
  CommandResponseEnvelope,
  ServerPushEnvelope,
} from "@magick/contracts/ws";
import { createId } from "@magick/shared/id";
import { attachWebSocketServer, createBackendServices } from "./index";

const COMMAND_TIMEOUT_MS = 10_000;

type CliSocket = Pick<WebSocket, "on" | "off" | "send" | "readyState">;

type CliState = {
  readonly workspaceId: string;
  activeThreadId: string | null;
  readonly streamingTurns: Map<string, string>;
};

type ParsedCommand =
  | { readonly type: "help" }
  | { readonly type: "quit" }
  | { readonly type: "bootstrap" }
  | { readonly type: "threads" }
  | { readonly type: "new"; readonly providerKey: string }
  | { readonly type: "open"; readonly threadId: string }
  | { readonly type: "send"; readonly content: string }
  | { readonly type: "stop" }
  | { readonly type: "retry" }
  | { readonly type: "resume" }
  | { readonly type: "authStatus" }
  | { readonly type: "login" }
  | { readonly type: "logout" };

const helpText = `
Commands:
  /help                     Show this help.
  /threads                  List threads for the current workspace.
  /new [provider]           Create a new thread. Defaults to codex.
  /open <threadId>          Open an existing thread.
  /send <message>           Send a user message to the active thread.
  /stop                     Stop the active turn.
  /retry                    Retry the last user message in the active thread.
  /resume                   Resume the active thread and replay events.
  /auth-status              Show Codex auth state.
  /login                    Start browser OAuth login for Codex.
  /logout                   Clear stored Codex auth.
  /quit                     Exit the terminal client.

Anything not starting with '/' is treated as '/send <text>'.
`.trim();

const parseCommand = (line: string): ParsedCommand => {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { type: "help" };
  }

  if (!trimmed.startsWith("/")) {
    return { type: "send", content: trimmed };
  }

  const [command, ...rest] = trimmed.slice(1).split(/\s+/);
  const argument = rest.join(" ").trim();

  switch (command) {
    case "help":
      return { type: "help" };
    case "quit":
    case "exit":
      return { type: "quit" };
    case "bootstrap":
      return { type: "bootstrap" };
    case "threads":
      return { type: "threads" };
    case "new":
      return { type: "new", providerKey: argument || "codex" };
    case "open":
      if (!argument) {
        throw new Error("Usage: /open <threadId>");
      }
      return { type: "open", threadId: argument };
    case "send":
      if (!argument) {
        throw new Error("Usage: /send <message>");
      }
      return { type: "send", content: argument };
    case "stop":
      return { type: "stop" };
    case "retry":
      return { type: "retry" };
    case "resume":
      return { type: "resume" };
    case "auth-status":
      return { type: "authStatus" };
    case "login":
      return { type: "login" };
    case "logout":
      return { type: "logout" };
    default:
      throw new Error(`Unknown command '/${command}'. Try /help.`);
  }
};

const requireActiveThread = (state: CliState): string => {
  if (!state.activeThreadId) {
    throw new Error("No active thread. Use /new or /open first.");
  }

  return state.activeThreadId;
};

const printResponse = (
  response: CommandResponseEnvelope,
  state: CliState,
): void => {
  if (!response.result.ok) {
    output.write(
      `error [${response.result.error.code}]: ${response.result.error.message}\n`,
    );
    return;
  }

  const { data } = response.result;
  switch (data.kind) {
    case "bootstrap":
      output.write(`bootstrapped workspace '${state.workspaceId}'\n`);
      output.write(`threads: ${data.threadSummaries.length}\n`);
      if (data.activeThread) {
        state.activeThreadId = data.activeThread.threadId;
        output.write(`active thread: ${data.activeThread.threadId}\n`);
      }
      return;
    case "threadList":
      if (data.threadSummaries.length === 0) {
        output.write("no threads\n");
        return;
      }
      for (const summary of data.threadSummaries) {
        output.write(
          `${summary.threadId} | ${summary.status} | ${summary.title} | ${summary.providerKey}\n`,
        );
      }
      return;
    case "threadState":
      state.activeThreadId = data.thread.threadId;
      output.write(
        `thread ${data.thread.threadId} | ${data.thread.status} | messages=${data.thread.messages.length}\n`,
      );
      if (data.replayedEvents && data.replayedEvents.length > 0) {
        output.write(`replayed ${data.replayedEvents.length} event(s)\n`);
      }
      return;
    case "accepted":
      output.write(`accepted command for thread ${data.threadId}\n`);
      return;
    case "providerAuthState":
      output.write(
        `auth ${data.auth.providerKey}: account=${data.auth.account?.type ?? "none"}, activeLogin=${data.auth.activeLoginId ?? "none"}\n`,
      );
      if (data.auth.account?.type === "chatgpt") {
        output.write(
          `chatgpt email=${data.auth.account.email ?? "unknown"} plan=${data.auth.account.planType ?? "unknown"}\n`,
        );
      }
      return;
    case "providerAuthLoginStart":
      output.write(`login started: ${data.auth.loginId}\n`);
      output.write(`open this URL in your browser:\n${data.auth.authUrl}\n`);
      return;
  }
};

const printPush = (message: ServerPushEnvelope, state: CliState): void => {
  switch (message.channel) {
    case "orchestration.domainEvent":
      if (message.event.type === "turn.delta") {
        const current =
          state.streamingTurns.get(message.event.payload.turnId) ?? "";
        state.streamingTurns.set(
          message.event.payload.turnId,
          `${current}${message.event.payload.delta}`,
        );

        if (current.length === 0) {
          output.write("assistant> ");
        }
        output.write(message.event.payload.delta);
        return;
      }
      if (message.event.type === "turn.failed") {
        if (state.streamingTurns.has(message.event.payload.turnId)) {
          output.write("\n");
        }
        state.streamingTurns.delete(message.event.payload.turnId);
        output.write(`turn failed: ${message.event.payload.error}\n`);
        return;
      }
      if (message.event.type === "turn.completed") {
        if (state.streamingTurns.has(message.event.payload.turnId)) {
          output.write("\n");
        }
        state.streamingTurns.delete(message.event.payload.turnId);
        return;
      }
      if (message.event.type === "turn.interrupted") {
        if (state.streamingTurns.has(message.event.payload.turnId)) {
          output.write("\n");
        }
        state.streamingTurns.delete(message.event.payload.turnId);
        output.write(`turn interrupted: ${message.event.payload.reason}\n`);
        return;
      }

      output.write(
        `push ${message.threadId} #${message.event.sequence} ${message.event.type}\n`,
      );
      if (message.event.type === "message.user.created") {
        output.write(`you> ${message.event.payload.content}\n`);
      }
      return;
    case "transport.connectionState":
      output.write(`connection ${message.state}: ${message.detail}\n`);
      return;
    case "transport.replayRequired":
      output.write(
        `replay required for ${message.threadId} after sequence ${message.latestSequence}\n`,
      );
      return;
  }
};

const sendCommand = (
  socket: CliSocket,
  command: CommandEnvelope["command"],
  options?: { readonly timeoutMs?: number },
): Promise<CommandResponseEnvelope> => {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error("WebSocket is not connected."));
      return;
    }

    const requestId = createId("request");
    const timeoutMs = options?.timeoutMs ?? COMMAND_TIMEOUT_MS;
    let settled = false;

    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
      clearTimeout(timeoutId);
    };

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const onMessage = (raw: Buffer) => {
      try {
        const parsed = JSON.parse(raw.toString()) as
          | CommandResponseEnvelope
          | ServerPushEnvelope;
        if ("requestId" in parsed && parsed.requestId === requestId) {
          settle(() => resolve(parsed));
        }
      } catch (error) {
        settle(() => reject(error));
      }
    };

    const onClose = () => {
      settle(() =>
        reject(new Error("WebSocket closed before a response arrived.")),
      );
    };

    const onError = (error: Error) => {
      settle(() => reject(error));
    };

    const timeoutId = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `Command timed out after ${timeoutMs}ms without a response.`,
          ),
        ),
      );
    }, timeoutMs);

    socket.on("message", onMessage);
    socket.on("close", onClose);
    socket.on("error", onError);
    socket.send(
      JSON.stringify({ requestId, command } satisfies CommandEnvelope),
    );
  });
};

const run = async () => {
  const services = createBackendServices();
  const server = createServer();
  attachWebSocketServer(server, services);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind local test server.");
  }

  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  socket.on("message", (raw) => {
    try {
      const parsed = JSON.parse(raw.toString()) as
        | CommandResponseEnvelope
        | ServerPushEnvelope;
      if ("channel" in parsed) {
        printPush(parsed, state);
      }
    } catch {
      output.write(`raw: ${raw.toString()}\n`);
    }
  });

  const state: CliState = {
    workspaceId: process.env.MAGICK_WORKSPACE_ID ?? "workspace_1",
    activeThreadId: null,
    streamingTurns: new Map(),
  };

  output.write("Magick terminal client\n");
  output.write(`db: ${services.databasePath}\n`);
  output.write(`${helpText}\n\n`);
  printPush(
    {
      channel: "transport.connectionState",
      state: "connected",
      detail: `local websocket ws://127.0.0.1:${address.port}`,
    },
    state,
  );

  const rl = createInterface({ input, output });
  try {
    printResponse(
      await sendCommand(socket, {
        type: "app.bootstrap",
        payload: { workspaceId: state.workspaceId },
      }),
      state,
    );

    while (true) {
      const line = await rl.question(
        `[${state.workspaceId}${state.activeThreadId ? `:${state.activeThreadId}` : ""}]> `,
      );

      let parsed: ParsedCommand;
      try {
        parsed = parseCommand(line);
      } catch (error) {
        output.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        continue;
      }

      if (parsed.type === "help") {
        output.write(`${helpText}\n`);
        continue;
      }
      if (parsed.type === "quit") {
        break;
      }

      try {
        const response = await (async (): Promise<CommandResponseEnvelope> => {
          switch (parsed.type) {
            case "bootstrap":
              return sendCommand(socket, {
                type: "app.bootstrap",
                payload: {
                  workspaceId: state.workspaceId,
                  ...(state.activeThreadId
                    ? { threadId: state.activeThreadId }
                    : {}),
                },
              });
            case "threads":
              return sendCommand(socket, {
                type: "thread.list",
                payload: { workspaceId: state.workspaceId },
              });
            case "new":
              return sendCommand(socket, {
                type: "thread.create",
                payload: {
                  workspaceId: state.workspaceId,
                  providerKey: parsed.providerKey,
                },
              });
            case "open":
              return sendCommand(socket, {
                type: "thread.open",
                payload: { threadId: parsed.threadId },
              });
            case "send":
              return sendCommand(socket, {
                type: "thread.sendMessage",
                payload: {
                  threadId: requireActiveThread(state),
                  content: parsed.content,
                },
              });
            case "stop":
              return sendCommand(socket, {
                type: "thread.stopTurn",
                payload: { threadId: requireActiveThread(state) },
              });
            case "retry":
              return sendCommand(socket, {
                type: "thread.retryTurn",
                payload: { threadId: requireActiveThread(state) },
              });
            case "resume":
              return sendCommand(socket, {
                type: "thread.resume",
                payload: {
                  threadId: requireActiveThread(state),
                  afterSequence: 0,
                },
              });
            case "authStatus":
              return sendCommand(socket, {
                type: "provider.auth.read",
                payload: { providerKey: "codex", refreshToken: true },
              });
            case "login":
              return sendCommand(socket, {
                type: "provider.auth.login.start",
                payload: { providerKey: "codex", mode: "chatgpt" },
              });
            case "logout":
              return sendCommand(socket, {
                type: "provider.auth.logout",
                payload: { providerKey: "codex" },
              });
          }
        })();

        printResponse(response, state);
      } catch (error) {
        output.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
  } finally {
    rl.close();
    socket.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
};

if (import.meta.main) {
  void run().catch((error) => {
    output.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

export { parseCommand, sendCommand };
