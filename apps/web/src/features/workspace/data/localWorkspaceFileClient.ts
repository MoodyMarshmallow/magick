import type {
  LocalFilePayload,
  LocalWorkspaceFileEvent,
  LocalWorkspaceFilesBootstrap,
  LocalWorkspaceTreeNode,
  MagickDesktopFileApi,
} from "@magick/shared/localWorkspace";
import {
  type DocumentBootstrap,
  demoDocumentIds,
  demoMagickClient,
} from "../../comments/data/demoMagickClient";

export interface LocalWorkspaceFileClient {
  readonly supportsPushWorkspaceEvents: boolean;
  getWorkspaceBootstrap: () => Promise<LocalWorkspaceFilesBootstrap>;
  openFile: (filePath: string) => Promise<LocalFilePayload>;
  saveFile: (filePath: string, markdown: string) => Promise<void>;
  onWorkspaceEvent: (
    listener: (event: LocalWorkspaceFileEvent) => void,
  ) => () => void;
}

const readResponseJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      errorText || `Request failed with status ${response.status}.`,
    );
  }

  return (await response.json()) as T;
};

const browserDocumentIdsByFilePath = new Map<string, string>();

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
      const filePath = `${pathPrefix}/${name}`;
      browserDocumentIdsByFilePath.set(filePath, document.documentId);
      return {
        id: `file:${filePath}`,
        type: "file" as const,
        name,
        path: filePath,
        filePath,
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

const getBrowserDocumentByFilePath = async (
  filePath: string,
): Promise<DocumentBootstrap> => {
  const documentId = browserDocumentIdsByFilePath.get(filePath);
  if (!documentId) {
    throw new Error(`File '${filePath}' was not found in the demo workspace.`);
  }

  return demoMagickClient.getDocumentBootstrap(documentId);
};

export const createBrowserLocalWorkspaceFileClient =
  (): LocalWorkspaceFileClient => ({
    supportsPushWorkspaceEvents: false,
    async getWorkspaceBootstrap() {
      browserDocumentIdsByFilePath.clear();

      const documents = await Promise.all(
        demoDocumentIds.map((documentId) =>
          demoMagickClient.getDocumentBootstrap(documentId),
        ),
      );

      return {
        workspaceRoot: "demo-workspace",
        tree: createBrowserWorkspaceTree(documents),
      };
    },
    async openFile(filePath) {
      const document = await getBrowserDocumentByFilePath(filePath);
      return {
        filePath,
        title: document.title,
        markdown: document.markdown,
      };
    },
    async saveFile(filePath, markdown) {
      const documentId = browserDocumentIdsByFilePath.get(filePath);
      if (!documentId) {
        throw new Error(
          `File '${filePath}' was not found in the demo workspace.`,
        );
      }

      demoMagickClient.updateDocumentMarkup(documentId, markdown);
    },
    onWorkspaceEvent() {
      return () => {};
    },
  });

export const createDesktopLocalWorkspaceFileClient = (
  api: MagickDesktopFileApi,
): LocalWorkspaceFileClient => ({
  supportsPushWorkspaceEvents: true,
  getWorkspaceBootstrap: () => api.getFileWorkspaceBootstrap(),
  openFile: (filePath) => api.openFile(filePath),
  saveFile: (filePath, markdown) => api.saveFile(filePath, markdown),
  onWorkspaceEvent: (listener) => api.onWorkspaceEvent(listener),
});

export const createDevLocalWorkspaceFileClient =
  (): LocalWorkspaceFileClient => ({
    supportsPushWorkspaceEvents: true,
    async getWorkspaceBootstrap() {
      return readResponseJson<LocalWorkspaceFilesBootstrap>(
        await fetch("/api/local-workspace/bootstrap"),
      );
    },
    async openFile(filePath) {
      return readResponseJson<LocalFilePayload>(
        await fetch(
          `/api/local-workspace/file?path=${encodeURIComponent(filePath)}`,
        ),
      );
    },
    async saveFile(filePath, markdown) {
      await readResponseJson<{ ok: true }>(
        await fetch(
          `/api/local-workspace/file?path=${encodeURIComponent(filePath)}`,
          {
            method: "PUT",
            body: markdown,
          },
        ),
      );
    },
    onWorkspaceEvent(listener) {
      const source = new EventSource("/api/local-workspace/events");
      const handleMessage = (event: MessageEvent<string>) => {
        listener(JSON.parse(event.data) as LocalWorkspaceFileEvent);
      };

      source.addEventListener("message", handleMessage as EventListener);
      return () => {
        source.removeEventListener("message", handleMessage as EventListener);
        source.close();
      };
    },
  });

const resolveLocalWorkspaceFileClient = (): LocalWorkspaceFileClient => {
  if (
    typeof window !== "undefined" &&
    typeof window.magickDesktopFiles !== "undefined"
  ) {
    return createDesktopLocalWorkspaceFileClient(window.magickDesktopFiles);
  }

  if (import.meta.env.DEV) {
    return createDevLocalWorkspaceFileClient();
  }

  return createBrowserLocalWorkspaceFileClient();
};

export const localWorkspaceFileClient = resolveLocalWorkspaceFileClient();
