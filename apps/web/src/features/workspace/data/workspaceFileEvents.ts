import type { LocalWorkspaceFileEvent } from "@magick/shared/localWorkspace";
import type { QueryClient } from "@tanstack/react-query";

export const applyWorkspaceFileEvent = async (
  queryClient: QueryClient,
  event: LocalWorkspaceFileEvent,
): Promise<void> => {
  await queryClient.invalidateQueries({
    queryKey: ["workspace-files-bootstrap"],
  });

  if (event.filePaths.length === 0) {
    await queryClient.invalidateQueries({ queryKey: ["document"] });
    return;
  }

  await Promise.all(
    event.filePaths.map((filePath) =>
      queryClient.invalidateQueries({ queryKey: ["document", filePath] }),
    ),
  );
};
