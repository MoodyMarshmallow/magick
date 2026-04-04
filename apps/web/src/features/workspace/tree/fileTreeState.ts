import type { LocalWorkspaceTreeNode } from "@magick/shared/localWorkspace";
import {
  createFileTreeAdapter,
  getFileAncestorDirectoryIds,
} from "./fileTreeAdapter";

export const findFirstWorkspaceFilePath = (
  tree: readonly LocalWorkspaceTreeNode[],
): string | null => {
  for (const node of tree) {
    if (node.type === "file") {
      return node.filePath;
    }

    const nestedMatch = findFirstWorkspaceFilePath(node.children);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
};

export const reconcileExpandedDirectoryIds = (args: {
  tree: readonly LocalWorkspaceTreeNode[];
  expandedIds: readonly string[];
  activeFilePath: string | null;
}): readonly string[] => {
  const adapter = createFileTreeAdapter(args.tree);
  const preservedExpandedIds = args.expandedIds.filter((id) =>
    adapter.directoryIds.has(id),
  );
  const requiredAncestorIds = getFileAncestorDirectoryIds(
    adapter,
    args.activeFilePath,
  );

  return Array.from(new Set([...preservedExpandedIds, ...requiredAncestorIds]));
};

export const collectWorkspaceFilePaths = (
  tree: readonly LocalWorkspaceTreeNode[],
): readonly string[] => {
  const filePaths: string[] = [];

  const visit = (nodes: readonly LocalWorkspaceTreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "file") {
        filePaths.push(node.filePath);
        continue;
      }

      visit(node.children);
    }
  };

  visit(tree);
  return filePaths;
};
