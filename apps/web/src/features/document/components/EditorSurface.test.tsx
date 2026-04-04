// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { EditorSurface } from "./EditorSurface";

const { focus, editorDomElement } = vi.hoisted(() => ({
  focus: vi.fn(),
  editorDomElement: {},
}));

vi.mock("@tiptap/react", () => ({
  EditorContent: () => <div data-testid="editor-content" />,
  useEditor: () => ({
    commands: {
      focus,
      setContent: vi.fn(),
    },
    chain: vi.fn(),
    isActive: vi.fn(() => false),
    state: {
      selection: {
        empty: true,
        from: 0,
        to: 0,
      },
      doc: {
        textBetween: vi.fn(() => ""),
      },
    },
    view: {
      dom: editorDomElement,
    },
    getJSON: vi.fn(() => ({ type: "doc", content: [] })),
  }),
}));

vi.mock("@tiptap/starter-kit", () => ({
  default: {},
}));

describe("EditorSurface", () => {
  it("focuses the editor when the surface background is clicked", () => {
    const { container } = render(
      <EditorSurface
        markdown="hello"
        onFormatStateChange={() => undefined}
        onMarkdownChange={() => undefined}
        onSelectionChange={() => undefined}
      />,
    );

    const surface = container.firstElementChild;
    if (!(surface instanceof HTMLDivElement)) {
      throw new Error("Expected editor surface div.");
    }

    fireEvent.mouseDown(surface);

    expect(focus).toHaveBeenCalledWith("end");
  });
});
