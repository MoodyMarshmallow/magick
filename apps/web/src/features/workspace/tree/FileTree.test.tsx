// @vitest-environment jsdom

import type { LocalWorkspaceTreeNode } from "@magick/shared/localWorkspace";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
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
        onCreateDirectory={async () => undefined}
        onCreateFile={async () => undefined}
        onDeleteDirectory={async () => undefined}
        onDeleteFile={async () => undefined}
        onOpenFile={setActiveFilePath}
        onRenameDirectory={async () => undefined}
        onRenameFile={async () => undefined}
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

    expect(screen.queryByText("field-notes")).toBeNull();

    await user.click(screen.getByRole("treeitem", { name: /notes/i }));
    await user.click(screen.getByRole("treeitem", { name: /patterns/i }));
    await user.click(screen.getByRole("treeitem", { name: /field-notes/i }));

    expect(screen.getByTestId("active-file").textContent).toContain(
      "notes/patterns/field-notes.md",
    );
    expect(
      screen
        .getByRole("treeitem", { name: /field-notes/i })
        .className.includes("is-active"),
    ).toBe(true);
  });

  it("preserves expanded state while switching active files", async () => {
    const user = userEvent.setup();
    render(<FileTreeHarness />);

    await user.click(screen.getByRole("treeitem", { name: /notes/i }));
    await user.click(screen.getByRole("treeitem", { name: /patterns/i }));
    await user.click(screen.getByRole("treeitem", { name: /field-notes/i }));

    expect(screen.getByRole("treeitem", { name: /patterns/i })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /manifesto/i })).toBeTruthy();

    await user.click(screen.getByRole("treeitem", { name: /manifesto/i }));

    expect(screen.getByRole("treeitem", { name: /field-notes/i })).toBeTruthy();
    expect(screen.getByTestId("active-file").textContent).toContain(
      "codex/manifesto.md",
    );
  });

  it("opens a folder create menu and dispatches file creation", async () => {
    const user = userEvent.setup();
    const onCreateFile = vi.fn(async () => undefined);

    render(
      <FileTree
        activeFilePath={null}
        expandedIds={["directory:notes"]}
        onExpandedIdsChange={() => undefined}
        onCreateDirectory={async () => undefined}
        onCreateFile={onCreateFile}
        onDeleteDirectory={async () => undefined}
        onDeleteFile={async () => undefined}
        onOpenFile={() => undefined}
        onRenameDirectory={async () => undefined}
        onRenameFile={async () => undefined}
        onStartDragFile={() => undefined}
        tree={sampleTree}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "More actions for notes" }),
    );
    await user.click(screen.getByRole("menuitem", { name: /new file/i }));

    expect(onCreateFile).toHaveBeenCalledWith("notes");
    expect(screen.queryByRole("menuitem", { name: /new file/i })).toBeNull();
  });

  it("dispatches folder creation from the folder create menu", async () => {
    const user = userEvent.setup();
    const onCreateDirectory = vi.fn(async () => undefined);

    render(
      <FileTree
        activeFilePath={null}
        expandedIds={["directory:notes"]}
        onExpandedIdsChange={() => undefined}
        onCreateDirectory={onCreateDirectory}
        onCreateFile={async () => undefined}
        onDeleteDirectory={async () => undefined}
        onDeleteFile={async () => undefined}
        onOpenFile={() => undefined}
        onRenameDirectory={async () => undefined}
        onRenameFile={async () => undefined}
        onStartDragFile={() => undefined}
        tree={sampleTree}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "More actions for notes" }),
    );
    await user.click(screen.getByRole("menuitem", { name: /new folder/i }));

    expect(onCreateDirectory).toHaveBeenCalledWith("notes");
  });

  it("renames a file from the actions menu", async () => {
    const user = userEvent.setup();
    const onRenameFile = vi.fn(async () => undefined);

    render(
      <FileTree
        activeFilePath={null}
        expandedIds={["directory:codex"]}
        onExpandedIdsChange={() => undefined}
        onCreateDirectory={async () => undefined}
        onCreateFile={async () => undefined}
        onDeleteDirectory={async () => undefined}
        onDeleteFile={async () => undefined}
        onOpenFile={() => undefined}
        onRenameDirectory={async () => undefined}
        onRenameFile={onRenameFile}
        onStartDragFile={() => undefined}
        tree={sampleTree}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "More actions for manifesto" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByLabelText("Rename manifesto");
    await user.clear(input);
    await user.type(input, "manifesto-2");
    await user.tab();

    expect(onRenameFile).toHaveBeenCalledWith(
      "codex/manifesto.md",
      "manifesto-2.md",
    );
  });

  it("deletes a file from the actions menu", async () => {
    const user = userEvent.setup();
    const onDeleteFile = vi.fn(async () => undefined);

    render(
      <FileTree
        activeFilePath={null}
        expandedIds={["directory:codex"]}
        onExpandedIdsChange={() => undefined}
        onCreateDirectory={async () => undefined}
        onCreateFile={async () => undefined}
        onDeleteDirectory={async () => undefined}
        onDeleteFile={onDeleteFile}
        onOpenFile={() => undefined}
        onRenameDirectory={async () => undefined}
        onRenameFile={async () => undefined}
        onStartDragFile={() => undefined}
        tree={sampleTree}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "More actions for manifesto" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(onDeleteFile).toHaveBeenCalledWith("codex/manifesto.md");
  });

  it("creates root-level entries from the trailing action row", async () => {
    const user = userEvent.setup();
    const onCreateFile = vi.fn(async () => undefined);
    const onCreateDirectory = vi.fn(async () => undefined);

    render(
      <FileTree
        activeFilePath={null}
        expandedIds={["directory:codex", "directory:notes"]}
        onExpandedIdsChange={() => undefined}
        onCreateDirectory={onCreateDirectory}
        onCreateFile={onCreateFile}
        onDeleteDirectory={async () => undefined}
        onDeleteFile={async () => undefined}
        onOpenFile={() => undefined}
        onRenameDirectory={async () => undefined}
        onRenameFile={async () => undefined}
        onStartDragFile={() => undefined}
        tree={sampleTree}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "More actions for workspace root" }),
    );
    await user.click(screen.getByRole("menuitem", { name: /new file/i }));
    await user.click(
      screen.getByRole("button", { name: "More actions for workspace root" }),
    );
    await user.click(screen.getByRole("menuitem", { name: /new folder/i }));

    expect(onCreateFile).toHaveBeenCalledWith("");
    expect(onCreateDirectory).toHaveBeenCalledWith("");
  });
});
