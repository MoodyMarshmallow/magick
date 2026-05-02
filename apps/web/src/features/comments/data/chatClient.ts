import type {
  BookmarkSummary,
  BranchViewModel,
  ClientCommand,
} from "@magick/contracts/chat";
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
  readonly bookmarks: readonly BookmarkSummary[];
  readonly activeBranch: BranchViewModel | null;
  readonly providerAuth: Readonly<Record<ProviderKey, ProviderAuthState>>;
}

interface ChatClient {
  getBootstrap: (args: { bookmarkId?: string }) => Promise<ChatBootstrap>;
  createBookmark: (args: {
    providerKey: ProviderKey;
    title?: string;
  }) => Promise<BranchViewModel>;
  selectBookmark: (bookmarkId: string) => Promise<BranchViewModel>;
  renameBookmark: (
    bookmarkId: string,
    title: string,
  ) => Promise<BranchViewModel>;
  deleteBookmark: (bookmarkId: string) => Promise<void>;
  sendBookmarkMessage: (bookmarkId: string, content: string) => Promise<void>;
  startLogin: (
    providerKey: ProviderKey,
  ) => Promise<{ loginId: string; popup: Window | null }>;
  cancelLogin: (providerKey: ProviderKey, loginId: string) => Promise<void>;
  logout: (providerKey: ProviderKey) => Promise<void>;
  subscribe: (listener: (event: ServerPushEnvelope) => void) => () => void;
}

const defaultBackendUrl = (): string => {
  const configured = import.meta.env.VITE_MAGICK_BACKEND_URL;
  if (configured) {
    return configured;
  }

  return "ws://127.0.0.1:8787";
};

const parseChatMessageData = async (
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
    const envelope: CommandEnvelope = { requestId, command };

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

  async getBootstrap(args: { bookmarkId?: string }) {
    const result = await this.#send({ type: "app.bootstrap", payload: args });
    if (result.kind !== "bootstrap") {
      throw new Error("Unexpected bootstrap response.");
    }

    return {
      bookmarks: result.bootstrap.bookmarkSummaries,
      activeBranch: result.bootstrap.activeBranch,
      providerAuth: result.bootstrap.providerAuth,
    };
  }

  async createBookmark(args: { providerKey: ProviderKey; title?: string }) {
    const result = await this.#send({ type: "bookmark.create", payload: args });
    if (result.kind !== "branchState") {
      throw new Error("Unexpected bookmark create response.");
    }
    return result.branch;
  }

  async selectBookmark(bookmarkId: string) {
    const result = await this.#send({
      type: "bookmark.select",
      payload: { bookmarkId },
    });
    if (result.kind !== "branchState") {
      throw new Error("Unexpected bookmark select response.");
    }
    return result.branch;
  }

  async renameBookmark(bookmarkId: string, title: string) {
    const result = await this.#send({
      type: "bookmark.rename",
      payload: { bookmarkId, title },
    });
    if (result.kind !== "branchState") {
      throw new Error("Unexpected bookmark rename response.");
    }
    return result.branch;
  }

  async deleteBookmark(bookmarkId: string) {
    const result = await this.#send({
      type: "bookmark.delete",
      payload: { bookmarkId },
    });
    if (result.kind !== "bookmarkDeleted") {
      throw new Error("Unexpected bookmark delete response.");
    }
  }

  async sendBookmarkMessage(bookmarkId: string, content: string) {
    await this.#send({
      type: "bookmark.sendMessage",
      payload: { bookmarkId, content },
    });
  }

  async startLogin(providerKey: ProviderKey) {
    const result = await this.#send({
      type: "provider.auth.login.start",
      payload: { providerKey, mode: "chatgpt" },
    });
    if (result.kind !== "providerAuthLoginStart") {
      throw new Error("Unexpected login start response.");
    }

    const popup = window.open(result.auth.authUrl, "_blank");
    return { loginId: result.auth.loginId, popup };
  }

  async cancelLogin(providerKey: ProviderKey, loginId: string) {
    const result = await this.#send({
      type: "provider.auth.login.cancel",
      payload: { providerKey, loginId },
    });
    if (result.kind !== "providerAuthState") {
      throw new Error("Unexpected provider auth login cancel response.");
    }
  }

  async logout(providerKey: ProviderKey) {
    const result = await this.#send({
      type: "provider.auth.logout",
      payload: { providerKey },
    });
    if (result.kind !== "providerAuthState") {
      throw new Error("Unexpected provider auth logout response.");
    }
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
