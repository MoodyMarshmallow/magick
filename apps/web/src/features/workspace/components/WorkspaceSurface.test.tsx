// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { localWorkspaceFileClient } from "../data/localWorkspaceFileClient";
import { useWorkspaceSessionStore } from "../state/workspaceSessionStore";
import { WorkspaceSurface } from "./WorkspaceSurface";

const { editorHandle, latestEditorProps } = vi.hoisted(() => ({
  editorHandle: {
    runCommand: vi.fn(),
  },
  latestEditorProps: {
    current: null as null | {
      onFormatStateChange: (state: unknown) => void;
    },
  },
}));

vi.mock("../../document/components/EditorSurface", () => ({
  EditorSurface: forwardRef(
    (
      props: {
        onFormatStateChange: (state: unknown) => void;
      },
      ref,
    ) => {
      latestEditorProps.current = props;
      useImperativeHandle(ref, () => editorHandle);
      return <div data-testid="editor-surface" />;
    },
  ),
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
      title:
        filePath
          .split("/")
          .at(-1)
          ?.replace(/\.[^.]+$/, "") ?? filePath,
      markdown: "Recovered markdown",
    })),
    renameFile: vi.fn(async (filePath: string, nextName: string) => ({
      previousFilePath: filePath,
      filePath: `${filePath.slice(0, filePath.lastIndexOf("/") + 1)}${nextName}`,
    })),
    saveFile: vi.fn(async () => undefined),
    onWorkspaceEvent: () => () => undefined,
  },
}));

describe("WorkspaceSurface", () => {
  beforeEach(() => {
    editorHandle.runCommand.mockClear();
    latestEditorProps.current = null;
  });

  it("reinitializes the first file when the workspace becomes empty with the same initial document", async () => {
    useWorkspaceSessionStore.setState({
      ...useWorkspaceSessionStore.getInitialState(),
    });
    act(() => {
      useWorkspaceSessionStore
        .getState()
        .initialize("notes/archive/recovery-notes.md");
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceSurface
          dragItem={null}
          initialDocumentId="notes/archive/recovery-notes.md"
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

  it("renames the active document when the workspace title is edited", async () => {
    vi.mocked(localWorkspaceFileClient.renameFile).mockClear();
    useWorkspaceSessionStore.setState({
      ...useWorkspaceSessionStore.getInitialState(),
      rootPane: {
        type: "leaf",
        id: "pane_1",
        tabIds: ["tab_1"],
        activeTabId: "tab_1",
      },
      tabsById: {
        tab_1: { id: "tab_1", documentId: "notes/test.md" },
      },
      draftsByDocumentId: {
        "notes/test.md": {
          title: "test",
          markdown: "Body",
          savedMarkdown: "Body",
          isLoaded: true,
        },
      },
      focusedPaneId: "pane_1",
      focusedTabId: "tab_1",
      lastFocusedTabIdByDocumentId: {
        "notes/test.md": "tab_1",
      },
    });

    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceSurface
          dragItem={null}
          initialDocumentId="notes/test.md"
          onDragItemChange={() => undefined}
        />
      </QueryClientProvider>,
    );

    const titleButton = container.querySelector<HTMLButtonElement>(
      ".workspace__document-title-button",
    );
    if (!titleButton) {
      throw new Error("Expected workspace title button to be present.");
    }

    fireEvent.click(titleButton);
    const input = screen.getByLabelText("Rename test");
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(localWorkspaceFileClient.renameFile).toHaveBeenCalledWith(
        "notes/test.md",
        "renamed.md",
      );
    });

    await waitFor(() => {
      expect(
        container.querySelector(".workspace__document-title-button")
          ?.textContent,
      ).toBe("renamed");
    });

    expect(useWorkspaceSessionStore.getState().tabsById.tab_1?.documentId).toBe(
      "notes/renamed.md",
    );
  });

  it("treats a blank workspace title edit as a no-op", async () => {
    vi.mocked(localWorkspaceFileClient.renameFile).mockClear();
    useWorkspaceSessionStore.setState({
      ...useWorkspaceSessionStore.getInitialState(),
      rootPane: {
        type: "leaf",
        id: "pane_1",
        tabIds: ["tab_1"],
        activeTabId: "tab_1",
      },
      tabsById: {
        tab_1: { id: "tab_1", documentId: "notes/test.md" },
      },
      draftsByDocumentId: {
        "notes/test.md": {
          title: "test",
          markdown: "Body",
          savedMarkdown: "Body",
          isLoaded: true,
        },
      },
      focusedPaneId: "pane_1",
      focusedTabId: "tab_1",
      lastFocusedTabIdByDocumentId: {
        "notes/test.md": "tab_1",
      },
    });

    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceSurface
          dragItem={null}
          initialDocumentId="notes/test.md"
          onDragItemChange={() => undefined}
        />
      </QueryClientProvider>,
    );

    const titleButton = container.querySelector<HTMLButtonElement>(
      ".workspace__document-title-button",
    );
    if (!titleButton) {
      throw new Error("Expected workspace title button to be present.");
    }

    fireEvent.click(titleButton);
    const input = screen.getByLabelText("Rename test");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(
        container.querySelector(".workspace__document-title-button")
          ?.textContent,
      ).toBe("test");
    });

    expect(localWorkspaceFileClient.renameFile).not.toHaveBeenCalled();
  });

  it("preserves the original extension when the title input contains dots", async () => {
    vi.mocked(localWorkspaceFileClient.renameFile).mockClear();
    useWorkspaceSessionStore.setState({
      ...useWorkspaceSessionStore.getInitialState(),
      rootPane: {
        type: "leaf",
        id: "pane_1",
        tabIds: ["tab_1"],
        activeTabId: "tab_1",
      },
      tabsById: {
        tab_1: { id: "tab_1", documentId: "notes/test.md" },
      },
      draftsByDocumentId: {
        "notes/test.md": {
          title: "test",
          markdown: "Body",
          savedMarkdown: "Body",
          isLoaded: true,
        },
      },
      focusedPaneId: "pane_1",
      focusedTabId: "tab_1",
      lastFocusedTabIdByDocumentId: {
        "notes/test.md": "tab_1",
      },
    });

    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceSurface
          dragItem={null}
          initialDocumentId="notes/test.md"
          onDragItemChange={() => undefined}
        />
      </QueryClientProvider>,
    );

    const titleButton = container.querySelector<HTMLButtonElement>(
      ".workspace__document-title-button",
    );
    if (!titleButton) {
      throw new Error("Expected workspace title button to be present.");
    }

    fireEvent.click(titleButton);
    const input = screen.getByLabelText("Rename test");
    fireEvent.change(input, { target: { value: "test.txt" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(localWorkspaceFileClient.renameFile).toHaveBeenCalledWith(
        "notes/test.md",
        "test.txt.md",
      );
    });
  });

  it("routes toolbar button clicks to the focused editor", () => {
    useWorkspaceSessionStore.setState({
      ...useWorkspaceSessionStore.getInitialState(),
      rootPane: {
        type: "leaf",
        id: "pane_1",
        tabIds: ["tab_1"],
        activeTabId: "tab_1",
      },
      tabsById: {
        tab_1: { id: "tab_1", documentId: "notes/test.md" },
      },
      draftsByDocumentId: {
        "notes/test.md": {
          title: "test",
          markdown: "Body",
          savedMarkdown: "Body",
          isLoaded: true,
        },
      },
      focusedPaneId: "pane_1",
      focusedTabId: "tab_1",
      lastFocusedTabIdByDocumentId: {
        "notes/test.md": "tab_1",
      },
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceSurface
          dragItem={null}
          initialDocumentId="notes/test.md"
          onDragItemChange={() => undefined}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByLabelText("Bold"));

    expect(editorHandle.runCommand).toHaveBeenCalledWith(
      "toggleBold",
      undefined,
    );
    expect(screen.getByLabelText("Bold").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("reflects editor format state back into the toolbar", async () => {
    useWorkspaceSessionStore.setState({
      ...useWorkspaceSessionStore.getInitialState(),
      rootPane: {
        type: "leaf",
        id: "pane_1",
        tabIds: ["tab_1"],
        activeTabId: "tab_1",
      },
      tabsById: {
        tab_1: { id: "tab_1", documentId: "notes/test.md" },
      },
      draftsByDocumentId: {
        "notes/test.md": {
          title: "test",
          markdown: "Body",
          savedMarkdown: "Body",
          isLoaded: true,
        },
      },
      focusedPaneId: "pane_1",
      focusedTabId: "tab_1",
      lastFocusedTabIdByDocumentId: {
        "notes/test.md": "tab_1",
      },
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceSurface
          dragItem={null}
          initialDocumentId="notes/test.md"
          onDragItemChange={() => undefined}
        />
      </QueryClientProvider>,
    );

    act(() => {
      latestEditorProps.current?.onFormatStateChange({
        blockquote: false,
        bold: true,
        bulletList: false,
        code: false,
        headingLevel: 2,
        italic: false,
        orderedList: false,
        paragraph: false,
        strike: false,
      });
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Bold").className).toContain("is-active");
      expect(screen.getByLabelText("Bold").getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(
        screen.getByLabelText("Heading").getAttribute("aria-expanded"),
      ).toBe("true");
    });
  });
});
