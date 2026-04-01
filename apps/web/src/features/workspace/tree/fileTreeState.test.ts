import type { LocalWorkspaceTreeNode } from "@magick/shared/localWorkspace";
import {
  findFirstWorkspaceDocumentId,
  reconcileExpandedDirectoryIds,
} from "./fileTreeState";

const sampleTree: readonly LocalWorkspaceTreeNode[] = [
  {
    id: "directory:codex",
    type: "directory",
    name: "codex",
    path: "codex",
    children: [
      {
        id: "file:doc_manifesto",
        type: "file",
        name: "manifesto.md",
        path: "codex/manifesto.md",
        documentId: "doc_manifesto",
      },
    ],
  },
  {
    id: "directory:notes",
    type: "directory",
    name: "notes",
    path: "notes",
    children: [
      {
        id: "directory:notes/patterns",
        type: "directory",
        name: "patterns",
        path: "notes/patterns",
        children: [
          {
            id: "file:doc_field_notes",
            type: "file",
            name: "field-notes.md",
            path: "notes/patterns/field-notes.md",
            documentId: "doc_field_notes",
          },
        ],
      },
    ],
  },
];

describe("fileTreeState", () => {
  it("finds the first document id in render order", () => {
    expect(findFirstWorkspaceDocumentId(sampleTree)).toBe("doc_manifesto");
    expect(findFirstWorkspaceDocumentId([])).toBeNull();
  });

  it("preserves valid expanded ids and opens ancestors of the active file", () => {
    expect(
      reconcileExpandedDirectoryIds({
        tree: sampleTree,
        expandedIds: ["directory:codex", "directory:missing"],
        activeDocumentId: "doc_field_notes",
      }),
    ).toEqual([
      "directory:codex",
      "directory:notes",
      "directory:notes/patterns",
    ]);
  });
});
