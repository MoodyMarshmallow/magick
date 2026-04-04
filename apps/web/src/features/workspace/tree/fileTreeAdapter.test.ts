import type { LocalWorkspaceTreeNode } from "@magick/shared/localWorkspace";
import {
  createFileTreeAdapter,
  getFileAncestorDirectoryIds,
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
        id: "file:codex/manifesto.md",
        type: "file",
        name: "manifesto.md",
        path: "codex/manifesto.md",
        filePath: "codex/manifesto.md",
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
            id: "file:notes/patterns/field-notes.md",
            type: "file",
            name: "field-notes.md",
            path: "notes/patterns/field-notes.md",
            filePath: "notes/patterns/field-notes.md",
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
    expect(
      adapter.fileItemIdByFilePath.get("notes/patterns/field-notes.md"),
    ).toBe("file:notes/patterns/field-notes.md");
    expect(adapter.directoryIds.has("directory:notes/patterns")).toBe(true);
  });

  it("returns ancestor directory ids for the active file", () => {
    const adapter = createFileTreeAdapter(sampleTree);

    expect(
      getFileAncestorDirectoryIds(adapter, "notes/patterns/field-notes.md"),
    ).toEqual(["directory:notes", "directory:notes/patterns"]);
    expect(getFileAncestorDirectoryIds(adapter, "missing")).toEqual([]);
    expect(getFileAncestorDirectoryIds(adapter, null)).toEqual([]);
  });
});
