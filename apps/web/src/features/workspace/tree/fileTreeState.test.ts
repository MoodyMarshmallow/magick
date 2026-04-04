import type { LocalWorkspaceTreeNode } from "@magick/shared/localWorkspace";
import {
  findFirstWorkspaceFilePath,
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

describe("fileTreeState", () => {
  it("finds the first file path in render order", () => {
    expect(findFirstWorkspaceFilePath(sampleTree)).toBe("codex/manifesto.md");
    expect(findFirstWorkspaceFilePath([])).toBeNull();
  });

  it("preserves valid expanded ids and opens ancestors of the active file", () => {
    expect(
      reconcileExpandedDirectoryIds({
        tree: sampleTree,
        expandedIds: ["directory:codex", "directory:missing"],
        activeFilePath: "notes/patterns/field-notes.md",
      }),
    ).toEqual([
      "directory:codex",
      "directory:notes",
      "directory:notes/patterns",
    ]);
  });
});
