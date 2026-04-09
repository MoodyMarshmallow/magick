interface WorkspaceTabInsertionTarget {
  readonly index: number;
  readonly markerLeft: number;
}

export const resolveTabInsertionTarget = (args: {
  readonly pointerX: number;
  readonly stripLeft: number;
  readonly stripScrollLeft: number;
  readonly tabRects: readonly { left: number; right: number }[];
}): WorkspaceTabInsertionTarget => {
  if (args.tabRects.length === 0) {
    return {
      index: 0,
      markerLeft: args.stripScrollLeft,
    };
  }

  for (const [index, rect] of args.tabRects.entries()) {
    const midpoint = rect.left + (rect.right - rect.left) / 2;
    if (args.pointerX < midpoint) {
      return {
        index,
        markerLeft: rect.left - args.stripLeft + args.stripScrollLeft,
      };
    }
  }

  const lastRect = args.tabRects[args.tabRects.length - 1];
  return {
    index: args.tabRects.length,
    markerLeft:
      (lastRect?.right ?? args.stripLeft) -
      args.stripLeft +
      args.stripScrollLeft,
  };
};

export const isNoopTabInsertion = (args: {
  readonly tabIds: readonly string[];
  readonly draggedTabId: string;
  readonly insertionIndex: number;
}): boolean => {
  const sourceIndex = args.tabIds.indexOf(args.draggedTabId);
  if (sourceIndex === -1) {
    return false;
  }

  return (
    args.insertionIndex === sourceIndex ||
    args.insertionIndex === sourceIndex + 1
  );
};
