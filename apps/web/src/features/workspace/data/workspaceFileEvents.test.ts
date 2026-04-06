import { QueryClient } from "@tanstack/react-query";
import { applyWorkspaceFileEvent } from "./workspaceFileEvents";

describe("applyWorkspaceFileEvent", () => {
  it("invalidates the workspace tree and specific changed files", async () => {
    const queryClient = new QueryClient();
    const invalidations: unknown[] = [];
    const originalInvalidateQueries =
      queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = async (filters) => {
      invalidations.push(filters?.queryKey);
      return originalInvalidateQueries(filters);
    };

    await applyWorkspaceFileEvent(queryClient, {
      type: "workspace.files.changed",
      filePaths: ["notes/guide.md", "notes/recovery.md"],
    });

    expect(invalidations).toEqual([
      ["workspace-files-bootstrap"],
      ["document", "notes/guide.md"],
      ["document", "notes/recovery.md"],
    ]);
  });

  it("invalidates all document queries when no specific file path is available", async () => {
    const queryClient = new QueryClient();
    const invalidations: unknown[] = [];
    const originalInvalidateQueries =
      queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = async (filters) => {
      invalidations.push(filters?.queryKey);
      return originalInvalidateQueries(filters);
    };

    await applyWorkspaceFileEvent(queryClient, {
      type: "workspace.files.changed",
      filePaths: [],
    });

    expect(invalidations).toEqual([
      ["workspace-files-bootstrap"],
      ["document"],
    ]);
  });
});
