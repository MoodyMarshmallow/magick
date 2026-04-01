export type LocalThreadMessageAuthor = "human" | "ai";
export type LocalThreadMessageStatus = "complete" | "streaming" | "failed";
export type LocalThreadStatus = "open" | "resolved";

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
  readonly documentId: string;
}

export type LocalWorkspaceTreeNode =
  | LocalWorkspaceDirectoryNode
  | LocalWorkspaceFileNode;

export interface LocalDocumentPayload {
  readonly documentId: string;
  readonly title: string;
  readonly markdown: string;
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
