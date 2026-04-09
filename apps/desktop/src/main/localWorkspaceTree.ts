import { basename, relative, sep } from "node:path";
import type {
  LocalWorkspaceBootstrap,
  LocalWorkspaceDirectoryNode,
  LocalWorkspaceFileNode,
  LocalWorkspaceFilesBootstrap,
  LocalWorkspaceThread,
  LocalWorkspaceTreeNode,
} from "@magick/shared/localWorkspace";

interface LocalWorkspaceTreeDocument {
  readonly filePath: string;
}

interface LocalWorkspaceTreeDirectory {
  readonly directoryPath: string;
}

interface MutableDirectoryNode {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly type: "directory";
  readonly children: LocalWorkspaceTreeNode[];
}

const compareTreeNodes = (
  left: LocalWorkspaceTreeNode,
  right: LocalWorkspaceTreeNode,
): number => {
  if (left.type !== right.type) {
    return left.type === "directory" ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
};

const toRelativeWorkspacePath = (
  documentsDir: string,
  filePath: string,
): string => relative(documentsDir, filePath).split(sep).join("/");

const createDirectoryNode = (
  name: string,
  path: string,
): MutableDirectoryNode => ({
  id: `directory:${path}`,
  name,
  path,
  type: "directory",
  children: [],
});

const toSortedTree = (
  nodes: readonly LocalWorkspaceTreeNode[],
): readonly LocalWorkspaceTreeNode[] =>
  [...nodes].sort(compareTreeNodes).map((node) =>
    node.type === "directory"
      ? {
          ...node,
          children: toSortedTree(node.children),
        }
      : node,
  );

const createWorkspaceTree = (args: {
  documents: readonly LocalWorkspaceTreeDocument[];
  directories?: readonly LocalWorkspaceTreeDirectory[];
  documentsDir: string;
}): readonly LocalWorkspaceTreeNode[] => {
  const rootNodes: LocalWorkspaceTreeNode[] = [];
  const directories = new Map<string, MutableDirectoryNode>();

  const ensureDirectory = (
    directoryPath: string,
  ): MutableDirectoryNode | null => {
    const relativePath = toRelativeWorkspacePath(
      args.documentsDir,
      directoryPath,
    );
    const pathSegments = relativePath.split("/").filter(Boolean);
    if (pathSegments.length === 0) {
      return null;
    }

    let parentChildren = rootNodes;
    let currentPath = "";
    let currentDirectory: MutableDirectoryNode | null = null;

    for (const segment of pathSegments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let directory = directories.get(currentPath);

      if (!directory) {
        directory = createDirectoryNode(segment, currentPath);
        directories.set(currentPath, directory);
        parentChildren.push(directory);
      }

      currentDirectory = directory;
      parentChildren = directory.children;
    }

    return currentDirectory;
  };

  for (const directory of args.directories ?? []) {
    ensureDirectory(directory.directoryPath);
  }

  for (const document of args.documents) {
    const relativePath = toRelativeWorkspacePath(
      args.documentsDir,
      document.filePath,
    );
    const pathSegments = relativePath.split("/").filter(Boolean);
    if (pathSegments.length === 0) {
      continue;
    }

    const fileName =
      pathSegments[pathSegments.length - 1] ?? basename(relativePath);
    const directorySegments = pathSegments.slice(0, -1);
    const parentDirectoryPath = directorySegments.join("/");
    const parentChildren = parentDirectoryPath
      ? ((
          directories.get(parentDirectoryPath) ??
          ensureDirectory(`${args.documentsDir}/${parentDirectoryPath}`)
        )?.children ?? rootNodes)
      : rootNodes;

    const fileNode: LocalWorkspaceFileNode = {
      id: `file:${relativePath}`,
      type: "file",
      name: fileName,
      path: relativePath,
      filePath: relativePath,
    };
    parentChildren.push(fileNode);
  }

  return toSortedTree(rootNodes);
};

export const createWorkspaceBootstrap = (args: {
  documents: readonly LocalWorkspaceTreeDocument[];
  directories?: readonly LocalWorkspaceTreeDirectory[];
  threads: readonly LocalWorkspaceThread[];
  workspaceRoot: string;
}): LocalWorkspaceBootstrap => {
  const treeArgs = {
    documents: args.documents,
    documentsDir: args.workspaceRoot,
    ...(args.directories ? { directories: args.directories } : {}),
  };

  return {
    tree: createWorkspaceTree(treeArgs),
    threads: args.threads,
  };
};

export const createWorkspaceFilesBootstrap = (args: {
  documents: readonly LocalWorkspaceTreeDocument[];
  directories?: readonly LocalWorkspaceTreeDirectory[];
  workspaceRoot: string;
}): LocalWorkspaceFilesBootstrap => {
  const treeArgs = {
    documents: args.documents,
    documentsDir: args.workspaceRoot,
    ...(args.directories ? { directories: args.directories } : {}),
  };

  return {
    workspaceRoot: args.workspaceRoot,
    tree: createWorkspaceTree(treeArgs),
  };
};

export const findFirstFilePathInTree = (
  tree: readonly LocalWorkspaceTreeNode[],
): string | null => {
  for (const node of tree) {
    if (node.type === "file") {
      return node.filePath;
    }

    const nestedFilePath = findFirstFilePathInTree(node.children);
    if (nestedFilePath) {
      return nestedFilePath;
    }
  }

  return null;
};
