// @vitest-environment jsdom

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { EditorSurface, type EditorSurfaceHandle } from "./EditorSurface";

const { createMilkdownEditorMock, controller } = vi.hoisted(() => ({
  controller: {
    destroy: vi.fn(async () => undefined),
    focusAtEnd: vi.fn(),
    replaceMarkdown: vi.fn(),
    runCommand: vi.fn(),
  },
  createMilkdownEditorMock: vi.fn(async () => controller),
}));

vi.mock("../editor/milkdownEditor", () => ({
  createMilkdownEditor: createMilkdownEditorMock,
}));

describe("EditorSurface", () => {
  beforeEach(() => {
    createMilkdownEditorMock.mockClear();
    controller.destroy.mockClear();
    controller.focusAtEnd.mockClear();
    controller.replaceMarkdown.mockClear();
    controller.runCommand.mockClear();
  });

  it("creates a Milkdown editor with the initial markdown", async () => {
    render(
      <EditorSurface
        markdown="# Heading"
        onFormatStateChange={() => undefined}
        onMarkdownChange={() => undefined}
        onSelectionChange={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(createMilkdownEditorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          markdown: "# Heading",
          root: expect.any(HTMLDivElement),
        }),
      );
    });
  });

  it("focuses the editor at the end when the surface background is clicked", async () => {
    const { container } = render(
      <EditorSurface
        markdown="hello"
        onFormatStateChange={() => undefined}
        onMarkdownChange={() => undefined}
        onSelectionChange={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(createMilkdownEditorMock).toHaveBeenCalled();
    });

    const surface = container.firstElementChild;
    if (!(surface instanceof HTMLDivElement)) {
      throw new Error("Expected editor surface div.");
    }

    fireEvent.mouseDown(surface);

    expect(controller.focusAtEnd).toHaveBeenCalledTimes(1);
  });

  it("syncs external markdown changes through the controller", async () => {
    const { rerender } = render(
      <EditorSurface
        markdown="first"
        onFormatStateChange={() => undefined}
        onMarkdownChange={() => undefined}
        onSelectionChange={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(createMilkdownEditorMock).toHaveBeenCalled();
    });

    rerender(
      <EditorSurface
        markdown="second"
        onFormatStateChange={() => undefined}
        onMarkdownChange={() => undefined}
        onSelectionChange={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(controller.replaceMarkdown).toHaveBeenCalledWith("second");
    });
  });

  it("forwards imperative commands to the controller", async () => {
    const ref = createRef<EditorSurfaceHandle>();

    render(
      <EditorSurface
        markdown="hello"
        onFormatStateChange={() => undefined}
        onMarkdownChange={() => undefined}
        onSelectionChange={() => undefined}
        ref={ref}
      />,
    );

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    ref.current?.runCommand("toggleHeading", { level: 2 });

    expect(controller.runCommand).toHaveBeenCalledWith("toggleHeading", {
      level: 2,
    });
  });

  it("replays the latest markdown after async editor creation resolves", async () => {
    let resolveEditor: ((value: typeof controller) => void) | null = null;
    createMilkdownEditorMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEditor = resolve;
        }),
    );

    const { rerender } = render(
      <EditorSurface
        markdown="first"
        onFormatStateChange={() => undefined}
        onMarkdownChange={() => undefined}
        onSelectionChange={() => undefined}
      />,
    );

    rerender(
      <EditorSurface
        markdown="second"
        onFormatStateChange={() => undefined}
        onMarkdownChange={() => undefined}
        onSelectionChange={() => undefined}
      />,
    );

    if (!resolveEditor) {
      throw new Error("Expected pending editor creation.");
    }

    await act(async () => {
      resolveEditor?.(controller);
    });

    await waitFor(() => {
      expect(controller.replaceMarkdown).toHaveBeenCalledWith("second");
    });
  });
});
