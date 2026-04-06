export type LocalThreadMessageAuthor = "human" | "ai";
export type LocalThreadMessageStatus = "complete" | "streaming" | "failed";
export type LocalThreadStatus = "open" | "resolved";

const getPathLeafName = (path: string): string =>
  path.split("/").at(-1) ?? path;

export const getLocalWorkspaceFileExtension = (filePath: string): string => {
  const fileName = getPathLeafName(filePath);
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex <= 0) {
    return "";
  }

  return fileName.slice(extensionIndex);
};

export const getLocalWorkspaceFileTitle = (filePath: string): string => {
  const fileName = getPathLeafName(filePath);
  const extension = getLocalWorkspaceFileExtension(filePath);
  return extension ? fileName.slice(0, -extension.length) : fileName;
};

export interface LocalThreadMessage {
  readonly id: string;
  readonly author: LocalThreadMessageAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly status: LocalThreadMessageStatus;
}

export interface LocalWorkspaceThread {
  readonly threadId: string;
  readonly title: string;
  readonly status: LocalThreadStatus;
  readonly updatedAt: string;
  readonly messages: readonly LocalThreadMessage[];
}

export interface LocalWorkspaceTreeBaseNode {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export interface LocalWorkspaceDirectoryNode
  extends LocalWorkspaceTreeBaseNode {
  readonly type: "directory";
  readonly children: readonly LocalWorkspaceTreeNode[];
}

export interface LocalWorkspaceFileNode extends LocalWorkspaceTreeBaseNode {
  readonly type: "file";
  readonly filePath: string;
}

export type LocalWorkspaceTreeNode =
  | LocalWorkspaceDirectoryNode
  | LocalWorkspaceFileNode;

export interface LocalDocumentPayload {
  readonly documentId: string;
  readonly title: string;
  readonly markdown: string;
}

export interface LocalFilePayload {
  readonly filePath: string;
  readonly title: string;
  readonly markdown: string;
}

export interface LocalWorkspaceFilesBootstrap {
  readonly workspaceRoot: string;
  readonly tree: readonly LocalWorkspaceTreeNode[];
}

export interface LocalWorkspaceCreatedFile {
  readonly filePath: string;
}

export interface LocalWorkspaceCreatedDirectory {
  readonly path: string;
}

export interface LocalWorkspaceRenamedFile {
  readonly previousFilePath: string;
  readonly filePath: string;
}

export interface LocalWorkspacePathChange {
  readonly previousFilePath: string;
  readonly filePath: string;
}

export interface LocalWorkspaceRenamedDirectory {
  readonly previousPath: string;
  readonly path: string;
  readonly filePathChanges: readonly LocalWorkspacePathChange[];
}

export interface LocalWorkspaceDeletedEntry {
  readonly deletedFilePaths: readonly string[];
}

export interface LocalWorkspaceFileEvent {
  readonly type: "workspace.files.changed";
  readonly filePaths: readonly string[];
}

export interface MagickDesktopFileApi {
  getFileWorkspaceBootstrap: () => Promise<LocalWorkspaceFilesBootstrap>;
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

export interface LocalWorkspaceBootstrap {
  readonly tree: readonly LocalWorkspaceTreeNode[];
  readonly threads: readonly LocalWorkspaceThread[];
}

export type LocalThreadEvent =
  | {
      readonly type: "snapshot.loaded";
      readonly threads: readonly LocalWorkspaceThread[];
    }
  | {
      readonly type: "thread.created";
      readonly thread: LocalWorkspaceThread;
    }
  | {
      readonly type: "thread.statusChanged";
      readonly threadId: string;
      readonly status: LocalThreadStatus;
      readonly updatedAt: string;
    }
  | {
      readonly type: "message.added";
      readonly threadId: string;
      readonly message: LocalThreadMessage;
      readonly updatedAt: string;
    }
  | {
      readonly type: "message.delta";
      readonly threadId: string;
      readonly messageId: string;
      readonly delta: string;
      readonly updatedAt: string;
    }
  | {
      readonly type: "message.completed";
      readonly threadId: string;
      readonly messageId: string;
      readonly updatedAt: string;
    };

export interface MagickDesktopApi {
  getWorkspaceBootstrap: () => Promise<LocalWorkspaceBootstrap>;
  openDocument: (documentId: string) => Promise<LocalDocumentPayload>;
  saveDocument: (documentId: string, markdown: string) => Promise<void>;
  sendThreadMessage: (threadId: string, body: string) => Promise<void>;
  toggleThreadResolved: (threadId: string) => Promise<void>;
  onThreadEvent: (listener: (event: LocalThreadEvent) => void) => () => void;
}
