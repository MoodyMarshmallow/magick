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

  it("applies pane border classes only for right and bottom neighbors", () => {
    useWorkspaceSessionStore.setState({
      ...useWorkspaceSessionStore.getInitialState(),
      rootPane: {
        type: "split",
        id: "split_root",
        direction: "vertical",
        ratio: 0.5,
        first: {
          type: "split",
          id: "split_left",
          direction: "horizontal",
          ratio: 0.5,
          first: {
            type: "leaf",
            id: "pane_top_left",
            tabIds: ["tab_top_left"],
            activeTabId: "tab_top_left",
          },
          second: {
            type: "leaf",
            id: "pane_bottom_left",
            tabIds: ["tab_bottom_left"],
            activeTabId: "tab_bottom_left",
          },
        },
        second: {
          type: "leaf",
          id: "pane_right",
          tabIds: ["tab_right"],
          activeTabId: "tab_right",
        },
      },
      tabsById: {
        tab_top_left: { id: "tab_top_left", documentId: "top-left.md" },
        tab_bottom_left: {
          id: "tab_bottom_left",
          documentId: "bottom-left.md",
        },
        tab_right: { id: "tab_right", documentId: "right.md" },
      },
      draftsByDocumentId: {
        "top-left.md": {
          title: "Top Left",
          markdown: "Top Left",
          savedMarkdown: "Top Left",
          isLoaded: true,
        },
        "bottom-left.md": {
          title: "Bottom Left",
          markdown: "Bottom Left",
          savedMarkdown: "Bottom Left",
          isLoaded: true,
        },
        "right.md": {
          title: "Right",
          markdown: "Right",
          savedMarkdown: "Right",
          isLoaded: true,
        },
      },
      focusedPaneId: "pane_top_left",
      focusedTabId: "tab_top_left",
      lastFocusedTabIdByDocumentId: {
        "top-left.md": "tab_top_left",
        "bottom-left.md": "tab_bottom_left",
        "right.md": "tab_right",
      },
    });

    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceSurface
          dragItem={null}
          initialDocumentId="top-left.md"
          onDragItemChange={() => undefined}
        />
      </QueryClientProvider>,
    );

    const panes = Array.from(container.querySelectorAll(".workspace-pane"));
    expect(panes).toHaveLength(3);

    expect(panes[0]?.className).toContain("workspace-pane--has-right-neighbor");
    expect(panes[0]?.className).toContain(
      "workspace-pane--has-bottom-neighbor",
    );

    expect(panes[1]?.className).toContain("workspace-pane--has-right-neighbor");
    expect(panes[1]?.className).not.toContain(
      "workspace-pane--has-bottom-neighbor",
    );

    expect(panes[2]?.className).not.toContain(
      "workspace-pane--has-right-neighbor",
    );
    expect(panes[2]?.className).not.toContain(
      "workspace-pane--has-bottom-neighbor",
    );
  });
});
