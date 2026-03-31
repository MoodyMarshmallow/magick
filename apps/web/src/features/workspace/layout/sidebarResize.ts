export const leftSidebarMinWidth = 220;
export const rightSidebarMinWidth = 280;
export const workspaceMinWidth = 560;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const clampLeftSidebarWidth = (args: {
  viewportWidth: number;
  nextWidth: number;
  rightSidebarWidth: number;
}): number => {
  const maxWidth =
    args.viewportWidth - args.rightSidebarWidth - workspaceMinWidth;
  return clamp(args.nextWidth, leftSidebarMinWidth, maxWidth);
};

export const clampRightSidebarWidth = (args: {
  viewportWidth: number;
  nextWidth: number;
  leftSidebarWidth: number;
}): number => {
  const maxWidth =
    args.viewportWidth - args.leftSidebarWidth - workspaceMinWidth;
  return clamp(args.nextWidth, rightSidebarMinWidth, maxWidth);
};
