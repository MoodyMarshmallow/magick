import { resolveBodyPaneSnap, resolveTabStripSnap } from "./workspacePaneSnap";

describe("workspacePaneSnap", () => {
  it("defaults body drags to tab insertion outside split regions", () => {
    expect(
      resolveBodyPaneSnap({
        rect: { width: 800, height: 600 },
        pointerX: 310,
        pointerY: 250,
        stripScrollLeft: 0,
        tabRects: [
          { left: 0, right: 160 },
          { left: 160, right: 320 },
          { left: 320, right: 480 },
        ],
      }),
    ).toEqual({
      type: "insert",
      position: "center",
      markerLeft: 320,
      insertionIndex: 2,
    });
  });

  it("compares left and right split regions against distance from the toolbar bottom", () => {
    expect(
      resolveBodyPaneSnap({
        rect: { width: 800, height: 600 },
        pointerX: 40,
        pointerY: 12,
        stripScrollLeft: 0,
        tabRects: [
          { left: 0, right: 180 },
          { left: 180, right: 360 },
        ],
      }),
    ).toEqual({
      type: "insert",
      position: "center",
      markerLeft: 0,
      insertionIndex: 0,
    });

    expect(
      resolveBodyPaneSnap({
        rect: { width: 800, height: 600 },
        pointerX: 12,
        pointerY: 48,
        stripScrollLeft: 0,
        tabRects: [
          { left: 0, right: 180 },
          { left: 180, right: 360 },
        ],
      }),
    ).toEqual({ type: "split", position: "left" });

    expect(
      resolveBodyPaneSnap({
        rect: { width: 800, height: 600 },
        pointerX: 778,
        pointerY: 20,
        stripScrollLeft: 0,
        tabRects: [
          { left: 0, right: 180 },
          { left: 180, right: 360 },
          { left: 360, right: 540 },
        ],
      }),
    ).toEqual({
      type: "insert",
      position: "center",
      markerLeft: 540,
      insertionIndex: 3,
    });

    expect(
      resolveBodyPaneSnap({
        rect: { width: 800, height: 600 },
        pointerX: 792,
        pointerY: 60,
        stripScrollLeft: 0,
        tabRects: [
          { left: 0, right: 180 },
          { left: 180, right: 360 },
          { left: 360, right: 540 },
        ],
      }),
    ).toEqual({ type: "split", position: "right" });
  });

  it("keeps bottom split as the default in the bottom region", () => {
    expect(
      resolveBodyPaneSnap({
        rect: { width: 800, height: 600 },
        pointerX: 400,
        pointerY: 590,
        stripScrollLeft: 0,
        tabRects: [
          { left: 0, right: 180 },
          { left: 180, right: 360 },
        ],
      }),
    ).toEqual({ type: "split", position: "bottom" });
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

  it("still allows split snapping in an empty tab strip near the edges", () => {
    expect(
      resolveTabStripSnap({
        rect: { width: 300, height: 32 },
        pointerX: 8,
        pointerY: 20,
        stripScrollLeft: 0,
        tabRects: [],
      }),
    ).toEqual({ type: "split", position: "left" });

    expect(
      resolveTabStripSnap({
        rect: { width: 300, height: 32 },
        pointerX: 140,
        pointerY: 20,
        stripScrollLeft: 0,
        tabRects: [],
      }),
    ).toEqual({
      type: "insert",
      position: "center",
      markerLeft: 0,
      insertionIndex: 0,
    });
  });
});
