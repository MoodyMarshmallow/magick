import type { LocalWorkspaceTreeNode } from "@magick/shared/localWorkspace";
import {
  createFileTreeAdapter,
  getDocumentAncestorDirectoryIds,
} from "./fileTreeAdapter";

export const findFirstWorkspaceDocumentId = (
  tree: readonly LocalWorkspaceTreeNode[],
): string | null => {
  for (const node of tree) {
    if (node.type === "file") {
      return node.documentId;
    }

    const nestedMatch = findFirstWorkspaceDocumentId(node.children);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
};

export const reconcileExpandedDirectoryIds = (args: {
  tree: readonly LocalWorkspaceTreeNode[];
  expandedIds: readonly string[];
  activeDocumentId: string | null;
}): readonly string[] => {
  const adapter = createFileTreeAdapter(args.tree);
  const preservedExpandedIds = args.expandedIds.filter((id) =>
    adapter.directoryIds.has(id),
  );
  const requiredAncestorIds = getDocumentAncestorDirectoryIds(
    adapter,
    args.activeDocumentId,
  );

  return Array.from(new Set([...preservedExpandedIds, ...requiredAncestorIds]));
};
