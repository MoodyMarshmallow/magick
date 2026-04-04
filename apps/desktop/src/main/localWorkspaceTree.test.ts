import {
  createWorkspaceBootstrap,
  findFirstFilePathInTree,
} from "./localWorkspaceTree";

describe("localWorkspaceTree", () => {
  it("builds nested directories and file metadata from document paths", () => {
    const bootstrap = createWorkspaceBootstrap({
      documents: [
        {
          filePath: "/tmp/workspace/codex/manifesto.md",
        },
        {
          filePath: "/tmp/workspace/notes/patterns/system.md",
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
      workspaceRoot: "/tmp/workspace",
    });

    expect(bootstrap.tree).toEqual([
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
                id: "file:notes/patterns/system.md",
                type: "file",
                name: "system.md",
                path: "notes/patterns/system.md",
                filePath: "notes/patterns/system.md",
              },
            ],
          },
        ],
      },
    ]);
    expect(bootstrap.threads).toHaveLength(1);
  });

  it("returns the first file path in tree order", () => {
    const bootstrap = createWorkspaceBootstrap({
      documents: [
        {
          filePath: "/tmp/workspace/zeta/last.md",
        },
        {
          filePath: "/tmp/workspace/alpha/first.md",
        },
      ],
      threads: [],
      workspaceRoot: "/tmp/workspace",
    });

    expect(findFirstFilePathInTree(bootstrap.tree)).toBe("alpha/first.md");
  });
});
