import type {
  LocalFilePayload,
  LocalWorkspaceCreatedDirectory,
  LocalWorkspaceCreatedFile,
  LocalWorkspaceDeletedEntry,
  LocalWorkspaceFileEvent,
  LocalWorkspaceFilesBootstrap,
  LocalWorkspacePathChange,
  LocalWorkspaceRenamedDirectory,
  LocalWorkspaceRenamedFile,
  LocalWorkspaceTreeNode,
  MagickDesktopFileApi,
} from "@magick/shared/localWorkspace";
import { getLocalWorkspaceFileTitle } from "@magick/shared/localWorkspace";

export interface LocalWorkspaceFileClient {
  readonly supportsPushWorkspaceEvents: boolean;
  getWorkspaceBootstrap: () => Promise<LocalWorkspaceFilesBootstrap>;
  openFile: (filePath: string) => Promise<LocalFilePayload>;
  saveFile: (filePath: string, markdown: string) => Promise<void>;
  createFile: (directoryPath: string) => Promise<LocalWorkspaceCreatedFile>;
  createDirectory: (
    directoryPath: string,
  ) => Promise<LocalWorkspaceCreatedDirectory>;
  renameFile: (
    filePath: string,
    nextName: string,
  ) => Promise<LocalWorkspaceRenamedFile>;
  renameDirectory: (
    directoryPath: string,
    nextName: string,
  ) => Promise<LocalWorkspaceRenamedDirectory>;
  deleteFile: (filePath: string) => Promise<LocalWorkspaceDeletedEntry>;
  deleteDirectory: (
    directoryPath: string,
  ) => Promise<LocalWorkspaceDeletedEntry>;
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

export const createDesktopLocalWorkspaceFileClient = (
  api: MagickDesktopFileApi,
): LocalWorkspaceFileClient => ({
  supportsPushWorkspaceEvents: true,
  getWorkspaceBootstrap: () => api.getFileWorkspaceBootstrap(),
  openFile: (filePath) => api.openFile(filePath),
  saveFile: (filePath, markdown) => api.saveFile(filePath, markdown),
  createFile: (directoryPath) => api.createFile(directoryPath),
  createDirectory: (directoryPath) => api.createDirectory(directoryPath),
  renameFile: (filePath, nextName) => api.renameFile(filePath, nextName),
  renameDirectory: (directoryPath, nextName) =>
    api.renameDirectory(directoryPath, nextName),
  deleteFile: (filePath) => api.deleteFile(filePath),
  deleteDirectory: (directoryPath) => api.deleteDirectory(directoryPath),
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
    async createFile(directoryPath) {
      return readResponseJson<LocalWorkspaceCreatedFile>(
        await fetch(
          `/api/local-workspace/create-file?directoryPath=${encodeURIComponent(directoryPath)}`,
          {
            method: "POST",
          },
        ),
      );
    },
    async createDirectory(directoryPath) {
      return readResponseJson<LocalWorkspaceCreatedDirectory>(
        await fetch(
          `/api/local-workspace/create-directory?directoryPath=${encodeURIComponent(directoryPath)}`,
          {
            method: "POST",
          },
        ),
      );
    },
    async renameFile(filePath, nextName) {
      return readResponseJson<LocalWorkspaceRenamedFile>(
        await fetch(
          `/api/local-workspace/rename-file?path=${encodeURIComponent(filePath)}&name=${encodeURIComponent(nextName)}`,
          { method: "POST" },
        ),
      );
    },
    async renameDirectory(directoryPath, nextName) {
      return readResponseJson<LocalWorkspaceRenamedDirectory>(
        await fetch(
          `/api/local-workspace/rename-directory?path=${encodeURIComponent(directoryPath)}&name=${encodeURIComponent(nextName)}`,
          { method: "POST" },
        ),
      );
    },
    async deleteFile(filePath) {
      return readResponseJson<LocalWorkspaceDeletedEntry>(
        await fetch(
          `/api/local-workspace/delete-file?path=${encodeURIComponent(filePath)}`,
          { method: "POST" },
        ),
      );
    },
    async deleteDirectory(directoryPath) {
      return readResponseJson<LocalWorkspaceDeletedEntry>(
        await fetch(
          `/api/local-workspace/delete-directory?path=${encodeURIComponent(directoryPath)}`,
          { method: "POST" },
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

  return createDevLocalWorkspaceFileClient();
};

export const localWorkspaceFileClient = resolveLocalWorkspaceFileClient();
