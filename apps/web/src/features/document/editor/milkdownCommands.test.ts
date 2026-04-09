import { runEditorCommand } from "./milkdownCommands";

const {
  commandsCtxToken,
  editorViewCtxToken,
  getEditorFormatStateMock,
  inlineMock,
  liftListItemMock,
  liftMock,
  setBlockTypeMock,
  toggleMarkMock,
  wrapInListMock,
  wrapInMock,
} = vi.hoisted(() => ({
  commandsCtxToken: Symbol("commandsCtx"),
  editorViewCtxToken: Symbol("editorViewCtx"),
  getEditorFormatStateMock: vi.fn(),
  inlineMock: vi.fn(),
  liftListItemMock: vi.fn((node) => `liftList:${node.name}`),
  liftMock: "lift-command",
  setBlockTypeMock: vi.fn((node, attrs) => ({
    attrs,
    type: `set:${node.name}`,
  })),
  toggleMarkMock: vi.fn((mark) => `toggle:${mark.name}`),
  wrapInListMock: vi.fn((node) => `wrapList:${node.name}`),
  wrapInMock: vi.fn((node) => `wrap:${node.name}`),
}));

vi.mock("@milkdown/core", () => ({
  commandsCtx: commandsCtxToken,
  editorViewCtx: editorViewCtxToken,
}));

vi.mock("./milkdownFormatState", () => ({
  getEditorFormatState: getEditorFormatStateMock,
}));

vi.mock("@milkdown/prose/commands", () => ({
  lift: liftMock,
  setBlockType: setBlockTypeMock,
  toggleMark: toggleMarkMock,
  wrapIn: wrapInMock,
}));

vi.mock("@milkdown/prose/schema-list", () => ({
  liftListItem: liftListItemMock,
  wrapInList: wrapInListMock,
}));

describe("milkdownCommands", () => {
  beforeEach(() => {
    getEditorFormatStateMock.mockReset();
    inlineMock.mockReset();
    liftListItemMock.mockClear();
    setBlockTypeMock.mockClear();
    toggleMarkMock.mockClear();
    wrapInListMock.mockClear();
    wrapInMock.mockClear();
  });

  interface MockNodeType {
    readonly name: string;
  }

  interface MockMarkType {
    readonly name: string;
  }

  const createEditor = (formatState: Record<string, unknown>) => {
    getEditorFormatStateMock.mockReturnValue({
      blockquote: false,
      bold: false,
      bulletList: false,
      code: false,
      headingLevel: null,
      italic: false,
      orderedList: false,
      paragraph: true,
      strike: false,
      ...formatState,
    });

    const schema: {
      readonly marks: Record<string, MockMarkType>;
      readonly nodes: Record<string, MockNodeType>;
    } = {
      marks: {
        emphasis: { name: "emphasis" },
        inlineCode: { name: "inlineCode" },
        strike_through: { name: "strike_through" },
        strong: { name: "strong" },
      },
      nodes: {
        blockquote: { name: "blockquote" },
        bullet_list: { name: "bullet_list" },
        heading: { name: "heading" },
        list_item: { name: "list_item" },
        ordered_list: { name: "ordered_list" },
        paragraph: { name: "paragraph" },
      },
    };

    return {
      action: (
        callback: (ctx: { get: (slice: unknown) => unknown }) => void,
      ) => {
        callback({
          get: (slice: unknown) => {
            if (slice === editorViewCtxToken) {
              return {
                focus: vi.fn(),
                state: { schema },
              };
            }

            if (slice === commandsCtxToken) {
              return { inline: inlineMock };
            }

            throw new Error("Unexpected ctx slice");
          },
        });
      },
    } as unknown as Parameters<typeof runEditorCommand>[0];
  };

  it("turns an active heading back into a paragraph", () => {
    runEditorCommand(createEditor({ headingLevel: 2 }), "toggleHeading", {
      level: 2,
    });

    expect(setBlockTypeMock).toHaveBeenCalledWith({ name: "paragraph" });
  });

  it("converts ordered lists into bullet lists without nesting them", () => {
    runEditorCommand(createEditor({ orderedList: true }), "toggleBulletList");

    expect(liftListItemMock).toHaveBeenCalledWith({ name: "list_item" });
    expect(wrapInListMock).toHaveBeenCalledWith({ name: "bullet_list" });
  });

  it("lifts blockquotes when toggled off", () => {
    runEditorCommand(createEditor({ blockquote: true }), "toggleBlockquote");

    expect(inlineMock).toHaveBeenCalledWith("lift-command");
  });

  it("toggles strong marks through the local command bridge", () => {
    runEditorCommand(createEditor({}), "toggleBold");

    expect(toggleMarkMock).toHaveBeenCalledWith({ name: "strong" });
  });
});
