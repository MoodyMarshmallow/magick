import {
  getEditorFormatState,
  getEditorSelectionState,
} from "./milkdownFormatState";

interface MockMarkType {
  isInSet: (marks: readonly MockMark[]) => MockMark | null;
}

interface MockMark {
  readonly type: MockMarkType;
}

interface MockNode {
  readonly attrs?: {
    readonly level?: number;
  };
  readonly isTextblock?: boolean;
  readonly type: {
    readonly name: string;
  };
}

const createResolvedPos = (
  nodes: readonly MockNode[],
  marks: readonly MockMark[] = [],
) => ({
  depth: nodes.length - 1,
  marks: () => marks,
  node: (depth: number) => nodes[depth],
});

describe("milkdownFormatState", () => {
  it("reads heading, list, blockquote, and inline mark state from the selection", () => {
    const strong: MockMarkType = {
      isInSet: (marks) => marks[0] ?? null,
    };
    const emphasis: MockMarkType = { isInSet: () => null };
    const strikeThrough: MockMarkType = { isInSet: () => null };
    const inlineCode: MockMarkType = {
      isInSet: (marks) => marks[1] ?? null,
    };
    const view = {
      state: {
        doc: {
          rangeHasMark: vi.fn(() => false),
          textBetween: vi.fn(() => "ignored"),
        },
        schema: {
          marks: {
            emphasis,
            inlineCode,
            strike_through: strikeThrough,
            strong,
          },
        },
        selection: {
          $from: createResolvedPos(
            [
              { type: { name: "doc" } },
              { attrs: { level: 3 }, type: { name: "heading" } },
              { type: { name: "bullet_list" } },
              { type: { name: "blockquote" } },
              { isTextblock: true, type: { name: "paragraph" } },
            ],
            [{ type: strong }, { type: inlineCode }],
          ),
          empty: true,
          from: 3,
          to: 3,
        },
        storedMarks: null,
      },
    } as unknown as Parameters<typeof getEditorFormatState>[0];

    expect(getEditorFormatState(view)).toEqual({
      blockquote: true,
      bold: true,
      bulletList: true,
      code: true,
      headingLevel: 3,
      italic: false,
      orderedList: false,
      paragraph: true,
      strike: false,
    });
  });

  it("derives selected text for non-empty selections", () => {
    const view = {
      state: {
        doc: {
          textBetween: vi.fn(() => "  selected text  "),
        },
        selection: {
          empty: false,
          from: 2,
          to: 7,
        },
      },
    } as unknown as Parameters<typeof getEditorSelectionState>[0];

    expect(getEditorSelectionState(view)).toEqual({ text: "selected text" });
  });

  it("keeps inline mark state off when the cursor has no stored marks", () => {
    const strong: MockMarkType = {
      isInSet: () => undefined as never,
    };
    const emphasis: MockMarkType = { isInSet: () => null };
    const strikeThrough: MockMarkType = { isInSet: () => null };
    const inlineCode: MockMarkType = { isInSet: () => null };
    const view = {
      state: {
        doc: {
          rangeHasMark: vi.fn(() => false),
          textBetween: vi.fn(() => ""),
        },
        schema: {
          marks: {
            emphasis,
            inlineCode,
            strike_through: strikeThrough,
            strong,
          },
        },
        selection: {
          $from: createResolvedPos([
            { type: { name: "doc" } },
            { isTextblock: true, type: { name: "paragraph" } },
          ]),
          empty: true,
          from: 1,
          to: 1,
        },
        storedMarks: null,
      },
    } as unknown as Parameters<typeof getEditorFormatState>[0];

    expect(getEditorFormatState(view)).toMatchObject({
      bold: false,
      code: false,
      italic: false,
      strike: false,
    });
  });

  it("uses the explicit selection when it differs from view.state.selection", () => {
    const view = {
      state: {
        doc: {
          rangeHasMark: vi.fn(() => false),
          textBetween: vi.fn(() => ""),
        },
        schema: {
          marks: {
            emphasis: { isInSet: () => null },
            inlineCode: { isInSet: () => null },
            strike_through: { isInSet: () => null },
            strong: { isInSet: () => null },
          },
        },
        selection: {
          $from: createResolvedPos([
            { type: { name: "doc" } },
            { type: { name: "ordered_list" } },
            { type: { name: "list_item" } },
            { isTextblock: true, type: { name: "paragraph" } },
          ]),
          empty: true,
          from: 4,
          to: 4,
        },
        storedMarks: null,
      },
    } as unknown as Parameters<typeof getEditorFormatState>[0];

    const headingSelection = {
      $from: createResolvedPos([
        { type: { name: "doc" } },
        { attrs: { level: 2 }, isTextblock: true, type: { name: "heading" } },
      ]),
      empty: true,
      from: 8,
      to: 8,
    } as unknown as Parameters<typeof getEditorFormatState>[1];

    expect(getEditorFormatState(view, headingSelection)).toMatchObject({
      bulletList: false,
      headingLevel: 2,
      orderedList: false,
      paragraph: false,
    });
  });

  it("returns inactive formatting for transient editor views without a schema", () => {
    const view = {
      state: {
        selection: {
          $from: createResolvedPos([
            { type: { name: "doc" } },
            { isTextblock: true, type: { name: "paragraph" } },
          ]),
          empty: true,
          from: 1,
          to: 1,
        },
      },
    } as unknown as Parameters<typeof getEditorFormatState>[0];

    expect(getEditorFormatState(view)).toEqual({
      blockquote: false,
      bold: false,
      bulletList: false,
      code: false,
      headingLevel: null,
      italic: false,
      orderedList: false,
      paragraph: false,
      strike: false,
    });
  });

  it("returns no selection for transient editor views without a document", () => {
    const view = {
      state: {
        selection: {
          empty: false,
          from: 1,
          to: 2,
        },
      },
    } as unknown as Parameters<typeof getEditorSelectionState>[0];

    expect(getEditorSelectionState(view)).toBeNull();
  });
});
