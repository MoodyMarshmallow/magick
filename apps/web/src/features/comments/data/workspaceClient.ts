import type {
  LocalDocumentPayload,
  LocalThreadEvent,
  LocalWorkspaceBootstrap,
  LocalWorkspaceThread,
  LocalWorkspaceTreeNode,
  MagickDesktopApi,
} from "@magick/shared/localWorkspace";
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
  thread: Awaited<ReturnType<typeof demoMagickClient.getThreads>>[number],
): LocalWorkspaceThread => ({
  threadId: thread.threadId,
  title: thread.title,
  status: thread.status,
  updatedAt: thread.updatedAt,
  messages: thread.messages,
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
      threads: event.threads.map(toLocalWorkspaceThread),
    };
  }

  if (event.type === "thread.created") {
    return {
      type: event.type,
      thread: toLocalWorkspaceThread(event.thread),
    };
  }

  return event;
};

const createBrowserWorkspaceTree = (
  documents: readonly DocumentBootstrap[],
): readonly LocalWorkspaceTreeNode[] => [
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
        children: [
          ...documents.map((document, index) => ({
            id: `file:${document.documentId}`,
            type: "file" as const,
            name:
              index === 0
                ? "evergreen-systems-memo.md"
                : "systems-garden-note.md",
            path:
              index === 0
                ? "notes/studio/evergreen-systems-memo.md"
                : "notes/studio/systems-garden-note.md",
            documentId: document.documentId,
          })),
        ],
      },
    ],
  },
];

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
