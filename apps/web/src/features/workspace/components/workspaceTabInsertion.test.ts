import {
  isNoopTabInsertion,
  resolveTabInsertionTarget,
} from "./workspaceTabInsertion";

describe("workspaceTabInsertion", () => {
  it("resolves insertion edges between tabs and at strip ends", () => {
    expect(
      resolveTabInsertionTarget({
        pointerX: 110,
        stripLeft: 100,
        stripScrollLeft: 0,
        tabRects: [
          { left: 100, right: 180 },
          { left: 180, right: 280 },
        ],
      }),
    ).toEqual({ index: 0, markerLeft: 0 });

    expect(
      resolveTabInsertionTarget({
        pointerX: 220,
        stripLeft: 100,
        stripScrollLeft: 0,
        tabRects: [
          { left: 100, right: 180 },
          { left: 180, right: 280 },
        ],
      }),
    ).toEqual({ index: 1, markerLeft: 80 });

    expect(
      resolveTabInsertionTarget({
        pointerX: 170,
        stripLeft: 100,
        stripScrollLeft: 0,
        tabRects: [
          { left: 100, right: 180 },
          { left: 180, right: 280 },
        ],
      }),
    ).toEqual({ index: 1, markerLeft: 80 });

    expect(
      resolveTabInsertionTarget({
        pointerX: 320,
        stripLeft: 100,
        stripScrollLeft: 0,
        tabRects: [
          { left: 100, right: 180 },
          { left: 180, right: 280 },
        ],
      }),
    ).toEqual({ index: 2, markerLeft: 180 });
  });

  it("identifies no-op insertions for a dragged tab within the same pane", () => {
    expect(
      isNoopTabInsertion({
        tabIds: ["tab_1", "tab_2", "tab_3"],
        draggedTabId: "tab_2",
        insertionIndex: 1,
      }),
    ).toBe(true);

    expect(
      isNoopTabInsertion({
        tabIds: ["tab_1", "tab_2", "tab_3"],
        draggedTabId: "tab_2",
        insertionIndex: 2,
      }),
    ).toBe(true);

    expect(
      isNoopTabInsertion({
        tabIds: ["tab_1", "tab_2", "tab_3"],
        draggedTabId: "tab_2",
        insertionIndex: 0,
      }),
    ).toBe(false);
  });
});
