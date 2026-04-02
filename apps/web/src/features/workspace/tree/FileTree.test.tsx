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

function FileTreeHarness() {
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(
    "doc_manifesto",
  );
  const [expandedIds, setExpandedIds] = useState<string[]>(["directory:codex"]);

  return (
    <>
      <div data-testid="active-document">{activeDocumentId ?? "none"}</div>
      <FileTree
        activeDocumentId={activeDocumentId}
        expandedIds={expandedIds}
        onExpandedIdsChange={setExpandedIds}
        onOpenDocument={setActiveDocumentId}
        onStartDragDocument={() => {}}
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

    expect(screen.getByTestId("active-document").textContent).toContain(
      "doc_field_notes",
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
    expect(screen.getByTestId("active-document").textContent).toContain(
      "doc_manifesto",
    );
  });
});
