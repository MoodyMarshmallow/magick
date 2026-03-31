import type {
  LocalWorkspaceDirectoryNode,
  LocalWorkspaceFileNode,
  LocalWorkspaceTreeNode,
} from "@magick/shared/localWorkspace";

export const workspaceRootItemId = "workspace-root";

export interface FileTreeItemDataBase {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export interface FileTreeDirectoryItemData extends FileTreeItemDataBase {
  readonly type: "directory";
}

export interface FileTreeFileItemData extends FileTreeItemDataBase {
  readonly type: "file";
  readonly documentId: string;
  readonly threadCount: number;
}

export type FileTreeItemData = FileTreeDirectoryItemData | FileTreeFileItemData;

export interface FileTreeAdapter {
  readonly rootItemId: string;
  readonly itemById: ReadonlyMap<string, FileTreeItemData>;
  readonly childrenByParentId: ReadonlyMap<string, readonly string[]>;
  readonly parentById: ReadonlyMap<string, string | null>;
  readonly directoryIds: ReadonlySet<string>;
  readonly fileItemIdByDocumentId: ReadonlyMap<string, string>;
}

const toDirectoryItemData = (
  node: LocalWorkspaceDirectoryNode,
): FileTreeDirectoryItemData => ({
  id: node.id,
  type: "directory",
  name: node.name,
  path: node.path,
});

const toFileItemData = (
  node: LocalWorkspaceFileNode,
): FileTreeFileItemData => ({
  id: node.id,
  type: "file",
  name: node.name,
  path: node.path,
  documentId: node.documentId,
  threadCount: node.threadCount,
});

export const createFileTreeAdapter = (
  tree: readonly LocalWorkspaceTreeNode[],
): FileTreeAdapter => {
  const itemById = new Map<string, FileTreeItemData>();
  const childrenByParentId = new Map<string, readonly string[]>();
  const parentById = new Map<string, string | null>();
  const directoryIds = new Set<string>();
  const fileItemIdByDocumentId = new Map<string, string>();

  itemById.set(workspaceRootItemId, {
    id: workspaceRootItemId,
    type: "directory",
    name: "workspace",
    path: "",
  });
  parentById.set(workspaceRootItemId, null);
  directoryIds.add(workspaceRootItemId);

  const visitNodes = (
    nodes: readonly LocalWorkspaceTreeNode[],
    parentId: string,
  ): void => {
    const childIds = nodes.map((node) => node.id);
    childrenByParentId.set(parentId, childIds);

    for (const node of nodes) {
      parentById.set(node.id, parentId);

      if (node.type === "directory") {
        itemById.set(node.id, toDirectoryItemData(node));
        directoryIds.add(node.id);
        visitNodes(node.children, node.id);
        continue;
      }

      itemById.set(node.id, toFileItemData(node));
      childrenByParentId.set(node.id, []);
      fileItemIdByDocumentId.set(node.documentId, node.id);
    }
  };

  visitNodes(tree, workspaceRootItemId);

  return {
    rootItemId: workspaceRootItemId,
    itemById,
    childrenByParentId,
    parentById,
    directoryIds,
    fileItemIdByDocumentId,
  };
};

export const getDocumentAncestorDirectoryIds = (
  adapter: FileTreeAdapter,
  documentId: string | null,
): readonly string[] => {
  if (!documentId) {
    return [];
  }

  const fileItemId = adapter.fileItemIdByDocumentId.get(documentId);
  if (!fileItemId) {
    return [];
  }

  const ancestorIds: string[] = [];
  let currentParentId = adapter.parentById.get(fileItemId) ?? null;
  while (currentParentId && currentParentId !== workspaceRootItemId) {
    ancestorIds.unshift(currentParentId);
    currentParentId = adapter.parentById.get(currentParentId) ?? null;
  }

  return ancestorIds;
};
