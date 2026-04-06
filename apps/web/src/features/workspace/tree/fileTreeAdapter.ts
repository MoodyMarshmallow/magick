import type {
  LocalWorkspaceDirectoryNode,
  LocalWorkspaceFileNode,
  LocalWorkspaceTreeNode,
} from "@magick/shared/localWorkspace";
import { getLocalWorkspaceFileTitle } from "@magick/shared/localWorkspace";

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
  readonly filePath: string;
}

export type FileTreeItemData = FileTreeDirectoryItemData | FileTreeFileItemData;

export interface FileTreeAdapter {
  readonly rootItemId: string;
  readonly itemById: ReadonlyMap<string, FileTreeItemData>;
  readonly childrenByParentId: ReadonlyMap<string, readonly string[]>;
  readonly parentById: ReadonlyMap<string, string | null>;
  readonly directoryIds: ReadonlySet<string>;
  readonly fileItemIdByFilePath: ReadonlyMap<string, string>;
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
  name: getLocalWorkspaceFileTitle(node.filePath),
  path: node.path,
  filePath: node.filePath,
});

export const createFileTreeAdapter = (
  tree: readonly LocalWorkspaceTreeNode[],
): FileTreeAdapter => {
  const itemById = new Map<string, FileTreeItemData>();
  const childrenByParentId = new Map<string, readonly string[]>();
  const parentById = new Map<string, string | null>();
  const directoryIds = new Set<string>();
  const fileItemIdByFilePath = new Map<string, string>();

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
      fileItemIdByFilePath.set(node.filePath, node.id);
    }
  };

  visitNodes(tree, workspaceRootItemId);

  return {
    rootItemId: workspaceRootItemId,
    itemById,
    childrenByParentId,
    parentById,
    directoryIds,
    fileItemIdByFilePath,
  };
};

export const getFileAncestorDirectoryIds = (
  adapter: FileTreeAdapter,
  filePath: string | null,
): readonly string[] => {
  if (!filePath) {
    return [];
  }

  const fileItemId = adapter.fileItemIdByFilePath.get(filePath);
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
