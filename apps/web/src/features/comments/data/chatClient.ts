import type { ClientCommand, ThreadViewModel } from "@magick/contracts/chat";
import type {
  ProviderAuthState,
  ProviderKey,
} from "@magick/contracts/provider";
import type {
  CommandEnvelope,
  CommandResponseEnvelope,
  CommandResult,
  ServerPushEnvelope,
} from "@magick/contracts/ws";

interface ChatBootstrap {
  readonly threads: readonly import("@magick/contracts/chat").ThreadSummary[];
  readonly activeThread: ThreadViewModel | null;
  readonly providerAuth: Readonly<Record<ProviderKey, ProviderAuthState>>;
}

interface ChatClient {
  getBootstrap: (args: {
    workspaceId: string;
    threadId?: string;
  }) => Promise<ChatBootstrap>;
  createThread: (args: {
    workspaceId: string;
    providerKey: ProviderKey;
    title?: string;
  }) => Promise<ThreadViewModel>;
  openThread: (threadId: string) => Promise<ThreadViewModel>;
  renameThread: (threadId: string, title: string) => Promise<ThreadViewModel>;
  deleteThread: (threadId: string) => Promise<void>;
  sendThreadMessage: (threadId: string, content: string) => Promise<void>;
  resolveThread: (threadId: string) => Promise<ThreadViewModel>;
  reopenThread: (threadId: string) => Promise<ThreadViewModel>;
  startLogin: (providerKey: ProviderKey) => Promise<void>;
  subscribe: (listener: (event: ServerPushEnvelope) => void) => () => void;
}

const defaultBackendUrl = (): string => {
  const configured = import.meta.env.VITE_MAGICK_BACKEND_URL;
  if (configured) {
    return configured;
  }

  return "ws://127.0.0.1:8787";
};

export const parseChatMessageData = async (
  data: MessageEvent["data"],
): Promise<CommandResponseEnvelope | ServerPushEnvelope> => {
  if (typeof data === "string") {
    return JSON.parse(data) as CommandResponseEnvelope | ServerPushEnvelope;
  }

  if (data instanceof Blob) {
    return JSON.parse(await data.text()) as
      | CommandResponseEnvelope
      | ServerPushEnvelope;
  }

  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(data)) as
      | CommandResponseEnvelope
      | ServerPushEnvelope;
  }

  if (ArrayBuffer.isView(data)) {
    return JSON.parse(new TextDecoder().decode(data)) as
      | CommandResponseEnvelope
      | ServerPushEnvelope;
  }

  throw new Error("Unsupported chat backend message payload.");
};

class WebSocketChatClient implements ChatClient {
  readonly #listeners = new Set<(event: ServerPushEnvelope) => void>();
  readonly #pending = new Map<
    string,
    {
      readonly resolve: (response: CommandResponseEnvelope) => void;
      readonly reject: (error: unknown) => void;
    }
  >();
  readonly #urlResolver: () => Promise<string>;
  #connectionPromise: Promise<WebSocket> | null = null;
  #requestCounter = 0;
  #socket: WebSocket | null = null;

  constructor(urlResolver: () => Promise<string>) {
    this.#urlResolver = urlResolver;
  }

  async #getSocket(): Promise<WebSocket> {
    if (this.#socket && this.#socket.readyState === WebSocket.OPEN) {
      return this.#socket;
    }

    if (this.#connectionPromise) {
      return this.#connectionPromise;
    }

    this.#connectionPromise = this.#urlResolver().then(
      (url) =>
        new Promise<WebSocket>((resolve, reject) => {
          const socket = new WebSocket(url);
          socket.addEventListener("open", () => {
            this.#socket = socket;
            resolve(socket);
          });
          socket.addEventListener("error", () => {
            this.#connectionPromise = null;
            reject(new Error(`Failed to connect to chat backend at ${url}.`));
          });
          socket.addEventListener("close", () => {
            for (const pending of this.#pending.values()) {
              pending.reject(new Error("Chat backend connection closed."));
            }
            this.#pending.clear();
            this.#socket = null;
            this.#connectionPromise = null;
          });
          socket.addEventListener("message", async (messageEvent) => {
            const payload = await parseChatMessageData(messageEvent.data);

            if ("requestId" in payload) {
              const pending = this.#pending.get(payload.requestId);
              if (!pending) {
                return;
              }

              this.#pending.delete(payload.requestId);
              pending.resolve(payload);
              return;
            }

            for (const listener of this.#listeners) {
              listener(payload);
            }
          });
        }),
    );

    return this.#connectionPromise;
  }

  async #send(
    command: ClientCommand,
  ): Promise<Extract<CommandResult, { readonly ok: true }>["data"]> {
    const socket = await this.#getSocket();
    const requestId = `request_${this.#requestCounter++}`;
    const envelope: CommandEnvelope = {
      requestId,
      command,
    };

    const response = await new Promise<CommandResponseEnvelope>(
      (resolve, reject) => {
        this.#pending.set(requestId, { resolve, reject });
        socket.send(JSON.stringify(envelope));
      },
    );

    if (!response.result.ok) {
      throw new Error(response.result.error.message);
    }

    return response.result.data;
  }

  async getBootstrap(args: { workspaceId: string; threadId?: string }) {
    const result = await this.#send({
      type: "app.bootstrap",
      payload: args,
    });
    if (result.kind !== "bootstrap") {
      throw new Error("Unexpected bootstrap response.");
    }

    return {
      threads: result.bootstrap.threadSummaries,
      activeThread: result.bootstrap.activeThread,
      providerAuth: result.bootstrap.providerAuth,
    };
  }

  async createThread(args: {
    workspaceId: string;
    providerKey: ProviderKey;
    title?: string;
  }) {
    const result = await this.#send({
      type: "thread.create",
      payload: args,
    });
    if (result.kind !== "threadState") {
      throw new Error("Unexpected thread create response.");
    }

    return result.thread;
  }

  async openThread(threadId: string) {
    const result = await this.#send({
      type: "thread.open",
      payload: { threadId },
    });
    if (result.kind !== "threadState") {
      throw new Error("Unexpected thread open response.");
    }

    return result.thread;
  }

  async renameThread(threadId: string, title: string) {
    const result = await this.#send({
      type: "thread.rename",
      payload: { threadId, title },
    });
    if (result.kind !== "threadState") {
      throw new Error("Unexpected thread rename response.");
    }

    return result.thread;
  }

  async deleteThread(threadId: string) {
    const result = await this.#send({
      type: "thread.delete",
      payload: { threadId },
    });
    if (result.kind !== "threadDeleted") {
      throw new Error("Unexpected thread delete response.");
    }
  }

  async sendThreadMessage(threadId: string, content: string) {
    await this.#send({
      type: "thread.sendMessage",
      payload: { threadId, content },
    });
  }

  async resolveThread(threadId: string) {
    const result = await this.#send({
      type: "thread.resolve",
      payload: { threadId },
    });
    if (result.kind !== "threadState") {
      throw new Error("Unexpected thread resolve response.");
    }

    return result.thread;
  }

  async reopenThread(threadId: string) {
    const result = await this.#send({
      type: "thread.reopen",
      payload: { threadId },
    });
    if (result.kind !== "threadState") {
      throw new Error("Unexpected thread reopen response.");
    }

    return result.thread;
  }

  async startLogin(providerKey: ProviderKey) {
    const result = await this.#send({
      type: "provider.auth.login.start",
      payload: { providerKey, mode: "chatgpt" },
    });
    if (result.kind !== "providerAuthLoginStart") {
      throw new Error("Unexpected login start response.");
    }

    window.open(result.auth.authUrl, "_blank", "noopener,noreferrer");
  }

  subscribe(listener: (event: ServerPushEnvelope) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

const resolveDesktopBackendUrl = async (): Promise<string> => {
  if (!window.magickDesktopRuntime) {
    return defaultBackendUrl();
  }

  return window.magickDesktopRuntime.getBackendUrl();
};

export const chatClient: ChatClient = new WebSocketChatClient(
  resolveDesktopBackendUrl,
);
