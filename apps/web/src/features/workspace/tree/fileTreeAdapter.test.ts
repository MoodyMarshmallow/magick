import type { LocalWorkspaceTreeNode } from "@magick/shared/localWorkspace";
import {
  createFileTreeAdapter,
  getDocumentAncestorDirectoryIds,
  workspaceRootItemId,
} from "./fileTreeAdapter";

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

describe("fileTreeAdapter", () => {
  it("creates lookup tables for headless tree rendering", () => {
    const adapter = createFileTreeAdapter(sampleTree);

    expect(adapter.childrenByParentId.get(workspaceRootItemId)).toEqual([
      "directory:codex",
      "directory:notes",
    ]);
    expect(adapter.childrenByParentId.get("directory:notes")).toEqual([
      "directory:notes/patterns",
    ]);
    expect(adapter.fileItemIdByDocumentId.get("doc_field_notes")).toBe(
      "file:doc_field_notes",
    );
    expect(adapter.directoryIds.has("directory:notes/patterns")).toBe(true);
  });

  it("returns ancestor directory ids for the active document", () => {
    const adapter = createFileTreeAdapter(sampleTree);

    expect(getDocumentAncestorDirectoryIds(adapter, "doc_field_notes")).toEqual(
      ["directory:notes", "directory:notes/patterns"],
    );
    expect(getDocumentAncestorDirectoryIds(adapter, "missing")).toEqual([]);
    expect(getDocumentAncestorDirectoryIds(adapter, null)).toEqual([]);
  });
});
