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

const browserDocumentIdsByFilePath = new Map<string, string>();

interface BrowserWorkspaceFileRecord {
  title: string;
  markdown: string;
}

interface BrowserWorkspaceState {
  readonly tree: readonly LocalWorkspaceTreeNode[];
  readonly filesByPath: Map<string, BrowserWorkspaceFileRecord>;
}

let browserWorkspaceState: BrowserWorkspaceState | null = null;

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

const createBrowserWorkspaceState = (
  documents: readonly DocumentBootstrap[],
): BrowserWorkspaceState => {
  browserDocumentIdsByFilePath.clear();

  const filesByPath = new Map<string, BrowserWorkspaceFileRecord>();
  const tree = createBrowserWorkspaceTree(documents);

  const visit = (nodes: readonly LocalWorkspaceTreeNode[]): void => {
    for (const node of nodes) {
      if (node.type === "directory") {
        visit(node.children);
        continue;
      }

      const documentId = browserDocumentIdsByFilePath.get(node.filePath);
      const document =
        documentId == null
          ? null
          : (documents.find(
              (candidate) => candidate.documentId === documentId,
            ) ?? null);
      filesByPath.set(node.filePath, {
        title: document?.title ?? node.name,
        markdown: document?.markdown ?? "",
      });
    }
  };

  visit(tree);

  return { tree, filesByPath };
};

const getBrowserWorkspaceState = async (): Promise<BrowserWorkspaceState> => {
  if (browserWorkspaceState) {
    return browserWorkspaceState;
  }

  const documents = await Promise.all(
    demoDocumentIds.map((documentId) =>
      demoMagickClient.getDocumentBootstrap(documentId),
    ),
  );
  browserWorkspaceState = createBrowserWorkspaceState(documents);
  return browserWorkspaceState;
};

const createFileNode = (filePath: string): LocalWorkspaceTreeNode => ({
  id: `file:${filePath}`,
  type: "file",
  name: filePath.split("/").at(-1) ?? filePath,
  path: filePath,
  filePath,
});

const createDirectoryNode = (path: string): LocalWorkspaceTreeNode => ({
  id: `directory:${path}`,
  type: "directory",
  name: path.split("/").at(-1) ?? path,
  path,
  children: [],
});

const getPathName = (path: string): string => path.split("/").at(-1) ?? path;

const getParentPath = (path: string): string =>
  path.split("/").slice(0, -1).join("/");

const joinBrowserPath = (parentPath: string, name: string): string =>
  parentPath ? `${parentPath}/${name}` : name;

const supportedBrowserFileExtensions = new Set([".md", ".mdx", ".txt"]);

const sanitizeBrowserEntryName = (
  nextName: string,
  args: {
    readonly fallbackBaseName: string;
    readonly extension: string;
  },
): string => {
  const trimmedName = nextName.trim();
  if (!trimmedName) {
    throw new Error("A name is required.");
  }

  const segments = trimmedName.split(/[\\/]+/).filter(Boolean);
  const leafName = segments.at(-1)?.trim() ?? "";
  if (!leafName || leafName === "." || leafName === "..") {
    throw new Error("A valid name is required.");
  }

  if (!args.extension) {
    return leafName;
  }

  const nextExtension = leafName.includes(".")
    ? leafName.slice(leafName.lastIndexOf("."))
    : args.extension;
  if (!supportedBrowserFileExtensions.has(nextExtension.toLowerCase())) {
    throw new Error(`File extension '${nextExtension}' is not supported.`);
  }

  const baseName = leafName.slice(0, leafName.length - nextExtension.length);
  return `${baseName || args.fallbackBaseName}${nextExtension}`;
};

const assertBrowserSiblingNameAvailable = (
  children: readonly LocalWorkspaceTreeNode[],
  previousPath: string,
  nextName: string,
): void => {
  const nameTaken = children.some(
    (child) => child.path !== previousPath && child.name === nextName,
  );
  if (nameTaken) {
    throw new Error(
      `Path '${joinBrowserPath(getParentPath(previousPath), nextName)}' already exists.`,
    );
  }
};

const insertBrowserTreeNode = (
  nodes: readonly LocalWorkspaceTreeNode[],
  directoryPath: string,
  nextNode: LocalWorkspaceTreeNode,
): readonly LocalWorkspaceTreeNode[] => {
  if (!directoryPath) {
    return [...nodes, nextNode].sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
  }

  return nodes.map((node) => {
    if (node.type !== "directory") {
      return node;
    }

    if (node.path === directoryPath) {
      return {
        ...node,
        children: [...node.children, nextNode].sort((left, right) => {
          if (left.type !== right.type) {
            return left.type === "directory" ? -1 : 1;
          }

          return left.name.localeCompare(right.name);
        }),
      };
    }

    return {
      ...node,
      children: insertBrowserTreeNode(node.children, directoryPath, nextNode),
    };
  });
};

const renameBrowserTreeNode = (
  nodes: readonly LocalWorkspaceTreeNode[],
  previousPath: string,
  nextPath: string,
): readonly LocalWorkspaceTreeNode[] =>
  nodes.map((node) => {
    if (node.path === previousPath) {
      if (node.type === "file") {
        return createFileNode(nextPath);
      }

      const renameNestedChildren = (
        children: readonly LocalWorkspaceTreeNode[],
      ): readonly LocalWorkspaceTreeNode[] =>
        children.map((child) => {
          const nextChildPath = `${nextPath}/${child.path.slice(`${previousPath}/`.length)}`;
          if (child.type === "file") {
            return createFileNode(nextChildPath);
          }

          return {
            ...createDirectoryNode(nextChildPath),
            children: renameNestedChildren(child.children),
          };
        });

      return {
        ...createDirectoryNode(nextPath),
        children: renameNestedChildren(node.children),
      };
    }

    if (node.type !== "directory") {
      return node;
    }

    return {
      ...node,
      children: renameBrowserTreeNode(node.children, previousPath, nextPath),
    };
  });

const removeBrowserTreeNode = (
  nodes: readonly LocalWorkspaceTreeNode[],
  targetPath: string,
): readonly LocalWorkspaceTreeNode[] =>
  nodes
    .filter((node) => node.path !== targetPath)
    .map((node) =>
      node.type === "directory"
        ? {
            ...node,
            children: removeBrowserTreeNode(node.children, targetPath),
          }
        : node,
    );

const findBrowserDirectoryNode = (
  nodes: readonly LocalWorkspaceTreeNode[],
  directoryPath: string,
): Extract<LocalWorkspaceTreeNode, { type: "directory" }> | null => {
  for (const node of nodes) {
    if (node.type !== "directory") {
      continue;
    }

    if (node.path === directoryPath) {
      return node;
    }

    const nestedMatch = findBrowserDirectoryNode(node.children, directoryPath);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
};

const findBrowserNode = (
  nodes: readonly LocalWorkspaceTreeNode[],
  targetPath: string,
): LocalWorkspaceTreeNode | null => {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }

    if (node.type !== "directory") {
      continue;
    }

    const nestedMatch = findBrowserNode(node.children, targetPath);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
};

const collectBrowserFilePaths = (
  node: LocalWorkspaceTreeNode,
): readonly string[] => {
  if (node.type === "file") {
    return [node.filePath];
  }

  return node.children.flatMap((child) => collectBrowserFilePaths(child));
};

const getBrowserDirectoryChildren = (
  nodes: readonly LocalWorkspaceTreeNode[],
  directoryPath: string,
): readonly LocalWorkspaceTreeNode[] =>
  directoryPath
    ? (findBrowserDirectoryNode(nodes, directoryPath)?.children ?? [])
    : nodes;

const ensureBrowserDirectoryExists = (
  nodes: readonly LocalWorkspaceTreeNode[],
  directoryPath: string,
): void => {
  if (!directoryPath) {
    return;
  }

  if (!findBrowserDirectoryNode(nodes, directoryPath)) {
    throw new Error(
      `Directory '${directoryPath}' was not found in the demo workspace.`,
    );
  }
};

const resolveUniqueBrowserChildPath = (
  children: readonly LocalWorkspaceTreeNode[],
  directoryPath: string,
  args: {
    readonly baseName: string;
    readonly extension: string;
  },
): string => {
  const existingNames = new Set(children.map((child) => child.name));
  let suffix = 0;

  while (true) {
    const candidateName =
      suffix === 0
        ? `${args.baseName}${args.extension}`
        : `${args.baseName}-${suffix}${args.extension}`;
    if (!existingNames.has(candidateName)) {
      return joinBrowserPath(directoryPath, candidateName);
    }

    suffix += 1;
  }
};

const renameBrowserFileRecord = (
  filesByPath: Map<string, BrowserWorkspaceFileRecord>,
  previousFilePath: string,
  filePath: string,
): Map<string, BrowserWorkspaceFileRecord> => {
  const nextFilesByPath = new Map(filesByPath);
  const fileRecord = nextFilesByPath.get(previousFilePath);
  if (fileRecord) {
    nextFilesByPath.delete(previousFilePath);
    nextFilesByPath.set(filePath, fileRecord);
  }

  const documentId = browserDocumentIdsByFilePath.get(previousFilePath);
  if (documentId) {
    browserDocumentIdsByFilePath.delete(previousFilePath);
    browserDocumentIdsByFilePath.set(filePath, documentId);
  }

  return nextFilesByPath;
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
      const workspaceState = await getBrowserWorkspaceState();

      return {
        workspaceRoot: "demo-workspace",
        tree: workspaceState.tree,
      };
    },
    async openFile(filePath) {
      const workspaceState = await getBrowserWorkspaceState();
      const file = workspaceState.filesByPath.get(filePath);
      if (!file) {
        const document = await getBrowserDocumentByFilePath(filePath);
        return {
          filePath,
          title: document.title,
          markdown: document.markdown,
        };
      }

      return {
        filePath,
        title: file.title,
        markdown: file.markdown,
      };
    },
    async saveFile(filePath, markdown) {
      const workspaceState = await getBrowserWorkspaceState();
      const localFile = workspaceState.filesByPath.get(filePath);
      if (localFile) {
        localFile.markdown = markdown;
      }

      const documentId = browserDocumentIdsByFilePath.get(filePath);
      if (documentId) {
        demoMagickClient.updateDocumentMarkup(documentId, markdown);
      }
    },
    async createFile(directoryPath) {
      const workspaceState = await getBrowserWorkspaceState();
      ensureBrowserDirectoryExists(workspaceState.tree, directoryPath);
      const children = getBrowserDirectoryChildren(
        workspaceState.tree,
        directoryPath,
      );
      const filePath = resolveUniqueBrowserChildPath(children, directoryPath, {
        baseName: "untitled",
        extension: ".md",
      });

      browserWorkspaceState = {
        ...workspaceState,
        tree: insertBrowserTreeNode(
          workspaceState.tree,
          directoryPath,
          createFileNode(filePath),
        ),
        filesByPath: new Map(workspaceState.filesByPath).set(filePath, {
          title: "Untitled",
          markdown: "",
        }),
      };

      return { filePath };
    },
    async createDirectory(directoryPath) {
      const workspaceState = await getBrowserWorkspaceState();
      ensureBrowserDirectoryExists(workspaceState.tree, directoryPath);
      const children = getBrowserDirectoryChildren(
        workspaceState.tree,
        directoryPath,
      );
      const path = resolveUniqueBrowserChildPath(children, directoryPath, {
        baseName: "untitled-folder",
        extension: "",
      });

      browserWorkspaceState = {
        ...workspaceState,
        tree: insertBrowserTreeNode(
          workspaceState.tree,
          directoryPath,
          createDirectoryNode(path),
        ),
      };

      return { path };
    },
    async renameFile(filePath, nextName) {
      const workspaceState = await getBrowserWorkspaceState();
      const node = findBrowserNode(workspaceState.tree, filePath);
      if (!node || node.type !== "file") {
        throw new Error(
          `File '${filePath}' was not found in the demo workspace.`,
        );
      }

      const parentPath = getParentPath(filePath);
      const children = getBrowserDirectoryChildren(
        workspaceState.tree,
        parentPath,
      );
      const sanitizedName = sanitizeBrowserEntryName(nextName, {
        fallbackBaseName: "untitled",
        extension: filePath.includes(".")
          ? filePath.slice(filePath.lastIndexOf("."))
          : ".md",
      });
      assertBrowserSiblingNameAvailable(children, filePath, sanitizedName);
      const renamedFilePath = joinBrowserPath(parentPath, sanitizedName);
      const nextFilesByPath = renameBrowserFileRecord(
        workspaceState.filesByPath,
        filePath,
        renamedFilePath,
      );
      const renamedRecord = nextFilesByPath.get(renamedFilePath);
      if (renamedRecord) {
        renamedRecord.title = getPathName(renamedFilePath);
      }

      browserWorkspaceState = {
        ...workspaceState,
        tree: renameBrowserTreeNode(
          workspaceState.tree,
          filePath,
          renamedFilePath,
        ),
        filesByPath: nextFilesByPath,
      };

      return {
        previousFilePath: filePath,
        filePath: renamedFilePath,
      };
    },
    async renameDirectory(directoryPath, nextName) {
      const workspaceState = await getBrowserWorkspaceState();
      const node = findBrowserNode(workspaceState.tree, directoryPath);
      if (!node || node.type !== "directory") {
        throw new Error(
          `Directory '${directoryPath}' was not found in the demo workspace.`,
        );
      }

      const parentPath = getParentPath(directoryPath);
      const children = getBrowserDirectoryChildren(
        workspaceState.tree,
        parentPath,
      );
      const sanitizedName = sanitizeBrowserEntryName(nextName, {
        fallbackBaseName: "untitled-folder",
        extension: "",
      });
      assertBrowserSiblingNameAvailable(children, directoryPath, sanitizedName);
      const path = joinBrowserPath(parentPath, sanitizedName);
      const filePathChanges = collectBrowserFilePaths(node).map(
        (previousFilePath) =>
          ({
            previousFilePath,
            filePath: joinBrowserPath(
              path,
              previousFilePath.slice(`${directoryPath}/`.length),
            ),
          }) satisfies LocalWorkspacePathChange,
      );
      let nextFilesByPath = new Map(workspaceState.filesByPath);
      for (const filePathChange of filePathChanges) {
        nextFilesByPath = renameBrowserFileRecord(
          nextFilesByPath,
          filePathChange.previousFilePath,
          filePathChange.filePath,
        );
      }

      browserWorkspaceState = {
        ...workspaceState,
        tree: renameBrowserTreeNode(workspaceState.tree, directoryPath, path),
        filesByPath: nextFilesByPath,
      };

      return {
        previousPath: directoryPath,
        path,
        filePathChanges,
      };
    },
    async deleteFile(filePath) {
      const workspaceState = await getBrowserWorkspaceState();
      if (!findBrowserNode(workspaceState.tree, filePath)) {
        throw new Error(
          `File '${filePath}' was not found in the demo workspace.`,
        );
      }

      const nextFilesByPath = new Map(workspaceState.filesByPath);
      nextFilesByPath.delete(filePath);
      browserDocumentIdsByFilePath.delete(filePath);
      browserWorkspaceState = {
        ...workspaceState,
        tree: removeBrowserTreeNode(workspaceState.tree, filePath),
        filesByPath: nextFilesByPath,
      };

      return { deletedFilePaths: [filePath] };
    },
    async deleteDirectory(directoryPath) {
      const workspaceState = await getBrowserWorkspaceState();
      const node = findBrowserNode(workspaceState.tree, directoryPath);
      if (!node || node.type !== "directory") {
        throw new Error(
          `Directory '${directoryPath}' was not found in the demo workspace.`,
        );
      }

      const deletedFilePaths = collectBrowserFilePaths(node);
      const nextFilesByPath = new Map(workspaceState.filesByPath);
      for (const filePath of deletedFilePaths) {
        nextFilesByPath.delete(filePath);
        browserDocumentIdsByFilePath.delete(filePath);
      }

      browserWorkspaceState = {
        ...workspaceState,
        tree: removeBrowserTreeNode(workspaceState.tree, directoryPath),
        filesByPath: nextFilesByPath,
      };

      return { deletedFilePaths };
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

  return createBrowserLocalWorkspaceFileClient();
};

export const localWorkspaceFileClient = resolveLocalWorkspaceFileClient();
