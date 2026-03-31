import { basename, relative, sep } from "node:path";
import type {
  LocalWorkspaceBootstrap,
  LocalWorkspaceDirectoryNode,
  LocalWorkspaceFileNode,
  LocalWorkspaceTreeNode,
} from "@magick/shared/localWorkspace";

export interface LocalWorkspaceTreeDocument {
  readonly id: string;
  readonly filePath: string;
}

export interface LocalWorkspaceTreeThread {
  readonly documentId: string;
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

export const createWorkspaceTree = (args: {
  documents: readonly LocalWorkspaceTreeDocument[];
  threads: readonly LocalWorkspaceTreeThread[];
  documentsDir: string;
}): readonly LocalWorkspaceTreeNode[] => {
  const rootNodes: LocalWorkspaceTreeNode[] = [];
  const directories = new Map<string, MutableDirectoryNode>();
  const threadCounts = new Map<string, number>();

  for (const thread of args.threads) {
    threadCounts.set(
      thread.documentId,
      (threadCounts.get(thread.documentId) ?? 0) + 1,
    );
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
    let parentChildren = rootNodes;
    let currentPath = "";

    for (const segment of directorySegments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let directory = directories.get(currentPath);

      if (!directory) {
        directory = createDirectoryNode(segment, currentPath);
        directories.set(currentPath, directory);
        parentChildren.push(directory);
      }

      parentChildren = directory.children;
    }

    const fileNode: LocalWorkspaceFileNode = {
      id: `file:${document.id}`,
      type: "file",
      name: fileName,
      path: relativePath,
      documentId: document.id,
      threadCount: threadCounts.get(document.id) ?? 0,
    };
    parentChildren.push(fileNode);
  }

  return toSortedTree(rootNodes);
};

export const createWorkspaceBootstrap = (args: {
  documents: readonly LocalWorkspaceTreeDocument[];
  threads: readonly LocalWorkspaceTreeThread[];
  documentsDir: string;
}): LocalWorkspaceBootstrap => ({
  tree: createWorkspaceTree(args),
});

export const findFirstDocumentIdInTree = (
  tree: readonly LocalWorkspaceTreeNode[],
): string | null => {
  for (const node of tree) {
    if (node.type === "file") {
      return node.documentId;
    }

    const nestedDocumentId = findFirstDocumentIdInTree(node.children);
    if (nestedDocumentId) {
      return nestedDocumentId;
    }
  }

  return null;
};
