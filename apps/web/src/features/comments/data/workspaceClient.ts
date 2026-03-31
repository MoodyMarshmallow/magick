import type {
  LocalDocumentPayload,
  LocalDocumentThread,
  LocalThreadEvent,
  LocalWorkspaceBootstrap,
  LocalWorkspaceTreeNode,
  MagickDesktopApi,
} from "@magick/shared/localWorkspace";
import {
  type DocumentBootstrap,
  demoDocumentId,
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

const toLocalDocumentThread = (
  thread: DocumentBootstrap["threads"][number],
): LocalDocumentThread => ({
  threadId: thread.threadId,
  documentId: thread.documentId,
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
      threads: event.threads.map(toLocalDocumentThread),
    };
  }

  if (event.type === "thread.created") {
    return {
      type: event.type,
      thread: toLocalDocumentThread(event.thread),
    };
  }

  return event;
};

const createBrowserWorkspaceTree = (
  document: DocumentBootstrap,
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
          {
            id: `file:${document.documentId}`,
            type: "file",
            name: "evergreen-systems-memo.md",
            path: "notes/studio/evergreen-systems-memo.md",
            documentId: document.documentId,
            threadCount: document.threads.length,
          },
        ],
      },
    ],
  },
];

const createBrowserWorkspaceClient = (): WorkspaceClient => ({
  async getWorkspaceBootstrap() {
    const document =
      await demoMagickClient.getDocumentBootstrap(demoDocumentId);
    return {
      tree: createBrowserWorkspaceTree(document),
    };
  },
  async openDocument(documentId) {
    const document = await demoMagickClient.getDocumentBootstrap(documentId);
    return {
      documentId: document.documentId,
      title: document.title,
      markdown: document.markdown,
      threads: document.threads.map(toLocalDocumentThread),
    };
  },
  async saveDocument(_documentId, markdown) {
    demoMagickClient.updateDocumentMarkup(markdown);
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
