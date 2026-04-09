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
});
