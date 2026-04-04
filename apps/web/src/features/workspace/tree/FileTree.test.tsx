// @vitest-environment jsdom

import type { LocalWorkspaceTreeNode } from "@magick/shared/localWorkspace";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { FileTree } from "./FileTree";

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

function FileTreeHarness() {
  const [activeFilePath, setActiveFilePath] = useState<string | null>(
    "codex/manifesto.md",
  );
  const [expandedIds, setExpandedIds] = useState<string[]>(["directory:codex"]);

  return (
    <>
      <div data-testid="active-file">{activeFilePath ?? "none"}</div>
      <FileTree
        activeFilePath={activeFilePath}
        expandedIds={expandedIds}
        onExpandedIdsChange={setExpandedIds}
        onOpenFile={setActiveFilePath}
        onStartDragFile={() => {}}
        tree={sampleTree}
      />
    </>
  );
}

describe("FileTree", () => {
  it("expands directories and opens nested files", async () => {
    const user = userEvent.setup();
    render(<FileTreeHarness />);

    expect(screen.queryByText("field-notes.md")).toBeNull();

    await user.click(screen.getByRole("treeitem", { name: /notes/i }));
    await user.click(screen.getByRole("treeitem", { name: /patterns/i }));
    await user.click(screen.getByRole("treeitem", { name: /field-notes.md/i }));

    expect(screen.getByTestId("active-file").textContent).toContain(
      "notes/patterns/field-notes.md",
    );
    expect(
      screen
        .getByRole("treeitem", { name: /field-notes.md/i })
        .className.includes("is-active"),
    ).toBe(true);
  });

  it("preserves expanded state while switching active files", async () => {
    const user = userEvent.setup();
    render(<FileTreeHarness />);

    await user.click(screen.getByRole("treeitem", { name: /notes/i }));
    await user.click(screen.getByRole("treeitem", { name: /patterns/i }));
    await user.click(screen.getByRole("treeitem", { name: /field-notes.md/i }));

    expect(screen.getByRole("treeitem", { name: /patterns/i })).toBeTruthy();
    expect(
      screen.getByRole("treeitem", { name: /manifesto.md/i }),
    ).toBeTruthy();

    await user.click(screen.getByRole("treeitem", { name: /manifesto.md/i }));

    expect(
      screen.getByRole("treeitem", { name: /field-notes.md/i }),
    ).toBeTruthy();
    expect(screen.getByTestId("active-file").textContent).toContain(
      "codex/manifesto.md",
    );
  });
});
