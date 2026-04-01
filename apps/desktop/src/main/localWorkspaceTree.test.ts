import {
  createWorkspaceBootstrap,
  findFirstDocumentIdInTree,
} from "./localWorkspaceTree";

describe("localWorkspaceTree", () => {
  it("builds nested directories and file metadata from document paths", () => {
    const bootstrap = createWorkspaceBootstrap({
      documents: [
        {
          id: "doc_manifesto",
          filePath: "/tmp/workspace/documents/codex/manifesto.md",
        },
        {
          id: "doc_notes",
          filePath: "/tmp/workspace/documents/notes/patterns/system.md",
        },
      ],
      threads: [
        {
          threadId: "thread_1",
          title: "Chat 1",
          status: "open",
          updatedAt: "2026-01-01T00:00:00.000Z",
          messages: [],
        },
      ],
      documentsDir: "/tmp/workspace/documents",
    });

    expect(bootstrap.tree).toEqual([
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
                id: "file:doc_notes",
                type: "file",
                name: "system.md",
                path: "notes/patterns/system.md",
                documentId: "doc_notes",
              },
            ],
          },
        ],
      },
    ]);
    expect(bootstrap.threads).toHaveLength(1);
  });

  it("returns the first file document id in tree order", () => {
    const bootstrap = createWorkspaceBootstrap({
      documents: [
        {
          id: "doc_b",
          filePath: "/tmp/workspace/documents/zeta/last.md",
        },
        {
          id: "doc_a",
          filePath: "/tmp/workspace/documents/alpha/first.md",
        },
      ],
      threads: [],
      documentsDir: "/tmp/workspace/documents",
    });

    expect(findFirstDocumentIdInTree(bootstrap.tree)).toBe("doc_a");
  });
});
