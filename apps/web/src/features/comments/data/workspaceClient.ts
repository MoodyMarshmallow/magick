import type {
  LocalDocumentPayload,
  LocalThreadEvent,
  LocalThreadMessage,
  LocalWorkspaceBootstrap,
  LocalWorkspaceThread,
  LocalWorkspaceTreeNode,
  MagickDesktopApi,
} from "@magick/shared/localWorkspace";
import type { CommentThread } from "../state/threadProjector";
import {
  type DocumentBootstrap,
  demoDocumentIds,
  demoMagickClient,
} from "./demoMagickClient";

export interface WorkspaceClient {
  getWorkspaceBootstrap: () => Promise<LocalWorkspaceBootstrap>;
  openDocument: (documentId: string) => Promise<LocalDocumentPayload>;
  saveDocument: (documentId: string, markdown: string) => Promise<void>;
  sendThreadMessage: (threadId: string, body: string) => Promise<void>;
  toggleThreadResolved: (threadId: string) => Promise<void>;
  subscribe: (listener: (event: LocalThreadEvent) => void) => () => void;
}

const toLocalWorkspaceThread = (
  thread: CommentThread,
): LocalWorkspaceThread => ({
  threadId: thread.threadId,
  title: thread.title,
  status: thread.status,
  updatedAt: thread.updatedAt,
  messages: thread.messages.map((message) => ({
    ...message,
    status: message.status === "interrupted" ? "failed" : message.status,
  })),
});

const toLocalThreadEvent = (
  event: Parameters<typeof demoMagickClient.subscribe>[0] extends (
    event: infer Event,
  ) => void
    ? Event
    : never,
): LocalThreadEvent => {
  if (event.type === "snapshot.loaded") {
    return {
      type: event.type,
      threads: event.threads.map((thread) => ({
        threadId: thread.threadId,
        title: thread.title,
        status: thread.resolutionState,
        updatedAt: thread.updatedAt,
        messages: [],
      })),
    };
  }

  if (event.type === "thread.created") {
    return {
      type: event.type,
      thread: toLocalWorkspaceThread(event.thread),
    };
  }

  if (event.type === "message.added") {
    return {
      ...event,
      message: {
        ...event.message,
        status:
          event.message.status === "interrupted"
            ? "failed"
            : (event.message.status as LocalThreadMessage["status"]),
      },
    };
  }

  if (event.type === "message.delta" || event.type === "message.completed") {
    return event;
  }

  if (event.type === "thread.statusChanged") {
    return event;
  }

  throw new Error(`Unsupported local thread event '${event.type}'.`);
};

const createBrowserWorkspaceTree = (
  documents: readonly DocumentBootstrap[],
): readonly LocalWorkspaceTreeNode[] => {
  const toFileName = (title: string): string =>
    `${title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}.md`;

  const createFiles = (
    pathPrefix: string,
    slice: readonly DocumentBootstrap[],
  ): readonly LocalWorkspaceTreeNode[] =>
    slice.map((document) => {
      const name = toFileName(document.title);
      return {
        id: `file:${pathPrefix}/${name}`,
        type: "file" as const,
        name,
        path: `${pathPrefix}/${name}`,
        filePath: `${pathPrefix}/${name}`,
      };
    });

  return [
    {
      id: "directory:notes",
      type: "directory",
      name: "notes",
      path: "notes",
      children: [
        {
          id: "directory:notes/studio",
          type: "directory",
          name: "studio",
          path: "notes/studio",
          children: createFiles("notes/studio", documents.slice(0, 4)),
        },
        {
          id: "directory:notes/research",
          type: "directory",
          name: "research",
          path: "notes/research",
          children: createFiles("notes/research", documents.slice(4, 8)),
        },
        {
          id: "directory:notes/archive",
          type: "directory",
          name: "archive",
          path: "notes/archive",
          children: createFiles("notes/archive", documents.slice(8)),
        },
      ],
    },
  ];
};

const createBrowserWorkspaceClient = (): WorkspaceClient => ({
  async getWorkspaceBootstrap() {
    const documents = await Promise.all(
      demoDocumentIds.map((documentId) =>
        demoMagickClient.getDocumentBootstrap(documentId),
      ),
    );
    const threads = await demoMagickClient.getThreads();
    return {
      tree: createBrowserWorkspaceTree(documents),
      threads: threads.map(toLocalWorkspaceThread),
    };
  },
  async openDocument(documentId) {
    const document = await demoMagickClient.getDocumentBootstrap(documentId);
    return {
      documentId: document.documentId,
      title: document.title,
      markdown: document.markdown,
    };
  },
  async saveDocument(_documentId, markdown) {
    demoMagickClient.updateDocumentMarkup(_documentId, markdown);
  },
  async sendThreadMessage(threadId, body) {
    await demoMagickClient.sendReply({ threadId, body });
  },
  async toggleThreadResolved(threadId) {
    await demoMagickClient.toggleResolved(threadId);
  },
  subscribe(listener) {
    return demoMagickClient.subscribe((event) => {
      listener(toLocalThreadEvent(event));
    });
  },
});

const createDesktopWorkspaceClient = (
  api: MagickDesktopApi,
): WorkspaceClient => ({
  getWorkspaceBootstrap: () => api.getWorkspaceBootstrap(),
  openDocument: (documentId) => api.openDocument(documentId),
  saveDocument: (documentId, markdown) =>
    api.saveDocument(documentId, markdown),
  sendThreadMessage: (threadId, body) => api.sendThreadMessage(threadId, body),
  toggleThreadResolved: (threadId) => api.toggleThreadResolved(threadId),
  subscribe: (listener) => api.onThreadEvent(listener),
});

export const workspaceClient: WorkspaceClient = window.magickDesktop
  ? createDesktopWorkspaceClient(window.magickDesktop)
  : createBrowserWorkspaceClient();
