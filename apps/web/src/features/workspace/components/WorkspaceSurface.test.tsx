// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { useWorkspaceSessionStore } from "../state/workspaceSessionStore";
import { WorkspaceSurface } from "./WorkspaceSurface";

vi.mock("../../document/components/EditorSurface", () => ({
  EditorSurface: () => <div data-testid="editor-surface" />,
}));

vi.mock("../../comments/state/commentUiStore", () => ({
  useCommentUiStore: (
    selector: (state: { setSelection: () => void }) => unknown,
  ) => selector({ setSelection: () => undefined }),
}));

vi.mock("../data/localWorkspaceFileClient", () => ({
  localWorkspaceFileClient: {
    supportsPushWorkspaceEvents: false,
    getWorkspaceBootstrap: vi.fn(),
    openFile: vi.fn(async (filePath: string) => ({
      filePath,
      title: "Recovered File",
      markdown: "Recovered markdown",
    })),
    saveFile: vi.fn(async () => undefined),
    onWorkspaceEvent: () => () => undefined,
  },
}));

describe("WorkspaceSurface", () => {
  it("reinitializes the first file when the workspace becomes empty with the same initial document", async () => {
    useWorkspaceSessionStore.setState({
      ...useWorkspaceSessionStore.getInitialState(),
    });
    act(() => {
      useWorkspaceSessionStore
        .getState()
        .initialize("notes/archive/recovery-notes.txt");
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceSurface
          dragItem={null}
          initialDocumentId="notes/archive/recovery-notes.txt"
          onDragItemChange={() => undefined}
        />
      </QueryClientProvider>,
    );

    const focusedTabId = useWorkspaceSessionStore.getState().focusedTabId;
    if (!focusedTabId) {
      throw new Error("Expected an initialized focused tab.");
    }

    act(() => {
      useWorkspaceSessionStore.getState().closeTab(focusedTabId);
    });

    await waitFor(() => {
      expect(useWorkspaceSessionStore.getState().rootPane).not.toBeNull();
      expect(useWorkspaceSessionStore.getState().focusedTabId).not.toBeNull();
    });
  });
});
