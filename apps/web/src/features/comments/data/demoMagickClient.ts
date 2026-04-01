import type {
  CommentMessage,
  CommentThread,
  CommentThreadEvent,
} from "../state/threadProjector";

export interface DocumentBootstrap {
  readonly documentId: string;
  readonly title: string;
  readonly markdown: string;
}

interface MutableCommentMessage {
  id: string;
  author: CommentMessage["author"];
  body: string;
  createdAt: string;
  status: CommentMessage["status"];
}

interface MutableCommentThread {
  threadId: string;
  title: string;
  status: CommentThread["status"];
  updatedAt: string;
  messages: MutableCommentMessage[];
}

interface MutableBootstrap {
  documentId: string;
  title: string;
  markdown: string;
}

interface DemoMagickClientState {
  bootstrap: MutableBootstrap;
  threads: MutableCommentThread[];
}

export interface DemoMagickClientOptions {
  readonly documentId?: string;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly schedule?: (callback: () => void, delayMs: number) => unknown;
  readonly cancelSchedule?: (handle: unknown) => void;
}

export interface DemoMagickClient {
  getDocumentBootstrap: (
    requestedDocumentId: string,
  ) => Promise<DocumentBootstrap>;
  getThreads: () => Promise<readonly CommentThread[]>;
  subscribe: (listener: (event: CommentThreadEvent) => void) => () => void;
  updateDocumentMarkup: (markdown: string) => void;
  createCommentThread: (args: {
    title: string;
    initialMessage: string;
  }) => Promise<CommentThread>;
  sendReply: (args: { threadId: string; body: string }) => Promise<void>;
  toggleResolved: (threadId: string) => Promise<void>;
}

const defaultDocumentId = "doc_everforest_manifesto";

const createInitialState = (
  documentId: string,
  now: () => string,
): DemoMagickClientState => ({
  bootstrap: {
    documentId,
    title: "Evergreen Systems Memo",
    markdown:
      "Magick should feel like a calm studio for thinking with AI.\n\nThe best interfaces keep momentum without hiding system state.\n\nUse shared contracts to keep streaming and replay predictable.\n\nWe should treat comments like durable conversations, not disposable UI fragments.",
  },
  threads: [
    {
      threadId: "thread_seed_1",
      title: "Chat 1",
      status: "open",
      updatedAt: now(),
      messages: [
        {
          id: "message_seed_1",
          author: "human",
          body: "We should preserve this sentence. It explains why the backend owns recovery semantics.",
          createdAt: now(),
          status: "complete",
        },
        {
          id: "message_seed_2",
          author: "ai",
          body: "Agreed. It also clarifies why replay correctness matters more than optimistic transcript tricks.",
          createdAt: now(),
          status: "complete",
        },
      ],
    },
  ],
});

const clone = <T>(value: T): T => structuredClone(value);

const toPublicThread = (thread: MutableCommentThread): CommentThread => ({
  ...clone(thread),
  messages: thread.messages.map((message) => ({ ...message })),
});

export const createDemoMagickClient = (
  options: DemoMagickClientOptions = {},
): DemoMagickClient => {
  const documentId = options.documentId ?? defaultDocumentId;
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? (() => crypto.randomUUID().slice(0, 8));
  const schedule =
    options.schedule ??
    ((callback: () => void, delayMs: number) =>
      globalThis.setInterval(callback, delayMs));
  const cancelSchedule =
    options.cancelSchedule ??
    ((handle: unknown) => globalThis.clearInterval(handle as number));

  const state = createInitialState(documentId, now);
  const listeners = new Set<(event: CommentThreadEvent) => void>();

  const toPublicBootstrap = (): DocumentBootstrap => ({
    documentId: state.bootstrap.documentId,
    title: state.bootstrap.title,
    markdown: state.bootstrap.markdown,
  });

  const getThreadsSnapshot = (): readonly CommentThread[] =>
    state.threads.map(toPublicThread);

  const emit = (event: CommentThreadEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const findThread = (threadId: string): MutableCommentThread => {
    const thread = state.threads.find(
      (candidate) => candidate.threadId === threadId,
    );
    if (!thread) {
      throw new Error(`Thread '${threadId}' was not found.`);
    }

    return thread;
  };

  const appendAssistantReply = (threadId: string, seed: string): void => {
    const thread = findThread(threadId);
    const messageId = `message_${createId()}`;
    const createdAt = now();
    const streamingMessage: MutableCommentMessage = {
      id: messageId,
      author: "ai",
      body: "",
      createdAt,
      status: "streaming",
    };

    thread.messages = [...thread.messages, streamingMessage];
    thread.updatedAt = createdAt;
    emit({
      type: "message.added",
      threadId,
      message: { ...streamingMessage },
      updatedAt: createdAt,
    });

    const chunks = seed.match(/.{1,32}/g) ?? [seed];
    let index = 0;
    const handle = schedule(() => {
      const nextChunk = chunks[index];
      if (!nextChunk) {
        cancelSchedule(handle);
        const completedAt = now();
        thread.messages = thread.messages.map((message) =>
          message.id === messageId
            ? { ...message, status: "complete" }
            : message,
        );
        thread.updatedAt = completedAt;
        emit({
          type: "message.completed",
          threadId,
          messageId,
          updatedAt: completedAt,
        });
        return;
      }

      thread.messages = thread.messages.map((message) =>
        message.id === messageId
          ? { ...message, body: `${message.body}${nextChunk}` }
          : message,
      );
      const updatedAt = now();
      thread.updatedAt = updatedAt;
      emit({
        type: "message.delta",
        threadId,
        messageId,
        delta: nextChunk,
        updatedAt,
      });
      index += 1;
    }, 140);
  };

  return {
    async getDocumentBootstrap(requestedDocumentId: string) {
      if (requestedDocumentId !== documentId) {
        throw new Error(`Document '${requestedDocumentId}' was not found.`);
      }

      return clone(toPublicBootstrap());
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    updateDocumentMarkup(markdown) {
      state.bootstrap.markdown = markdown;
    },

    async createCommentThread(args) {
      const timestamp = now();
      const thread: MutableCommentThread = {
        threadId: `thread_${createId()}`,
        title: args.title,
        status: "open",
        updatedAt: timestamp,
        messages: [
          {
            id: `message_${createId()}`,
            author: "human",
            body: args.initialMessage,
            createdAt: timestamp,
            status: "complete",
          },
        ],
      };

      state.threads = [thread, ...state.threads];
      emit({ type: "thread.created", thread: toPublicThread(thread) });
      appendAssistantReply(
        thread.threadId,
        "I'll treat this as its own chat, so every follow-up stays in the same conversation history.",
      );

      return clone(toPublicThread(thread));
    },

    async sendReply(args) {
      const thread = findThread(args.threadId);
      const message: MutableCommentMessage = {
        id: `message_${createId()}`,
        author: "human",
        body: args.body,
        createdAt: now(),
        status: "complete",
      };
      thread.messages = [...thread.messages, message];
      thread.updatedAt = message.createdAt;
      emit({
        type: "message.added",
        threadId: thread.threadId,
        message: { ...message },
        updatedAt: message.createdAt,
      });

      appendAssistantReply(
        thread.threadId,
        `This reply stays in ${thread.threadId}, which keeps the chat durable across streaming and replay.`,
      );
    },

    async toggleResolved(threadId) {
      const thread = findThread(threadId);
      thread.status = thread.status === "open" ? "resolved" : "open";
      thread.updatedAt = now();
      emit({
        type: "thread.statusChanged",
        threadId,
        status: thread.status,
        updatedAt: thread.updatedAt,
      });
    },
    async getThreads() {
      return clone(getThreadsSnapshot());
    },
  };
};

export const demoMagickClient = createDemoMagickClient();
export const demoDocumentId = defaultDocumentId;
