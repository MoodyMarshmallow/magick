import {
  resolveBodySplitPosition,
  resolveTabStripSnap,
} from "./workspacePaneSnap";

describe("workspacePaneSnap", () => {
  it("returns center when body pointer is away from split edges", () => {
    expect(
      resolveBodySplitPosition({
        rect: { width: 800, height: 600 },
        pointerX: 300,
        pointerY: 250,
      }),
    ).toBe("center");
  });

  it("prefers the closest body split edge", () => {
    expect(
      resolveBodySplitPosition({
        rect: { width: 800, height: 600 },
        pointerX: 40,
        pointerY: 590,
      }),
    ).toBe("bottom");

    expect(
      resolveBodySplitPosition({
        rect: { width: 800, height: 600 },
        pointerX: 12,
        pointerY: 565,
      }),
    ).toBe("left");
  });

  it("keeps top split as a thin dedicated band", () => {
    expect(
      resolveTabStripSnap({
        rect: { width: 300, height: 32 },
        pointerX: 140,
        pointerY: 6,
        stripScrollLeft: 0,
        tabRects: [
          { left: 0, right: 100 },
          { left: 100, right: 220 },
        ],
      }),
    ).toEqual({ type: "split", position: "top" });
  });

  it("compares split edges and insertion edges in one pass", () => {
    expect(
      resolveTabStripSnap({
        rect: { width: 300, height: 32 },
        pointerX: 8,
        pointerY: 20,
        stripScrollLeft: 0,
        tabRects: [
          { left: 0, right: 100 },
          { left: 100, right: 220 },
        ],
      }),
    ).toEqual({ type: "split", position: "left" });

    expect(
      resolveTabStripSnap({
        rect: { width: 300, height: 32 },
        pointerX: 112,
        pointerY: 20,
        stripScrollLeft: 0,
        tabRects: [
          { left: 0, right: 100 },
          { left: 100, right: 220 },
        ],
      }),
    ).toEqual({
      type: "insert",
      position: "center",
      markerLeft: 100,
      insertionIndex: 1,
    });

    expect(
      resolveTabStripSnap({
        rect: { width: 300, height: 32 },
        pointerX: 292,
        pointerY: 20,
        stripScrollLeft: 0,
        tabRects: [
          { left: 0, right: 100 },
          { left: 100, right: 220 },
        ],
      }),
    ).toEqual({ type: "split", position: "right" });
  });

  it("keeps insertion markers aligned with tab edges in scrolled strips", () => {
    expect(
      resolveTabStripSnap({
        rect: { width: 240, height: 32 },
        pointerX: 92,
        pointerY: 20,
        stripScrollLeft: 120,
        tabRects: [
          { left: -120, right: -20 },
          { left: -20, right: 80 },
          { left: 80, right: 180 },
        ],
      }),
    ).toEqual({
      type: "insert",
      position: "center",
      markerLeft: 200,
      insertionIndex: 2,
    });
  });
});
