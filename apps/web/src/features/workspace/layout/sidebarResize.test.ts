import {
  clamp,
  clampLeftSidebarWidth,
  clampRightSidebarWidth,
  leftSidebarMinWidth,
  rightSidebarMinWidth,
} from "./sidebarResize";

describe("sidebarResize", () => {
  it("clamps arbitrary values into range", () => {
    expect(clamp(50, 100, 200)).toBe(100);
    expect(clamp(250, 100, 200)).toBe(200);
    expect(clamp(150, 100, 200)).toBe(150);
  });

  it("clamps the left sidebar against minimum and workspace constraints", () => {
    expect(
      clampLeftSidebarWidth({
        viewportWidth: 1400,
        nextWidth: 120,
        rightSidebarWidth: 320,
      }),
    ).toBe(leftSidebarMinWidth);

    expect(
      clampLeftSidebarWidth({
        viewportWidth: 1400,
        nextWidth: 700,
        rightSidebarWidth: 320,
      }),
    ).toBe(520);
  });

  it("clamps the right sidebar against minimum and workspace constraints", () => {
    expect(
      clampRightSidebarWidth({
        viewportWidth: 1400,
        nextWidth: 180,
        leftSidebarWidth: 280,
      }),
    ).toBe(rightSidebarMinWidth);

    expect(
      clampRightSidebarWidth({
        viewportWidth: 1400,
        nextWidth: 700,
        leftSidebarWidth: 280,
      }),
    ).toBe(560);
  });
});
