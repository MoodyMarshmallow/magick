import type { WorkspaceDropPosition } from "../state/workspaceSessionTypes";

export const paneEdgeSnapRatio = 0.18;
export const tabStripTopBandRatio = 0.22;

export interface PaneSnapCandidate {
  readonly type: "split" | "insert";
  readonly position: WorkspaceDropPosition;
  readonly distance: number;
  readonly markerLeft?: number;
  readonly insertionIndex?: number;
}

export interface TabStripSnapResult {
  readonly type: "split" | "insert";
  readonly position: WorkspaceDropPosition;
  readonly markerLeft?: number;
  readonly insertionIndex?: number;
}

export const resolveBodySplitPosition = (args: {
  rect: { width: number; height: number };
  pointerX: number;
  pointerY: number;
}): WorkspaceDropPosition => {
  const edgeBandX = args.rect.width * paneEdgeSnapRatio;
  const edgeBandY = args.rect.height * paneEdgeSnapRatio;
  const candidates: PaneSnapCandidate[] = [];

  if (args.pointerX <= edgeBandX) {
    candidates.push({
      type: "split",
      position: "left",
      distance: args.pointerX,
    });
  }

  if (args.pointerX >= args.rect.width - edgeBandX) {
    candidates.push({
      type: "split",
      position: "right",
      distance: args.rect.width - args.pointerX,
    });
  }

  if (args.pointerY >= args.rect.height - edgeBandY) {
    candidates.push({
      type: "split",
      position: "bottom",
      distance: args.rect.height - args.pointerY,
    });
  }

  if (candidates.length === 0) {
    return "center";
  }

  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0]?.position ?? "center";
};

export const resolveTabStripSnap = (args: {
  rect: { width: number; height: number };
  pointerX: number;
  pointerY: number;
  stripScrollLeft: number;
  tabRects: readonly { left: number; right: number }[];
}): TabStripSnapResult => {
  if (args.pointerY <= args.rect.height * tabStripTopBandRatio) {
    return { type: "split", position: "top" };
  }

  const edgeBandX = args.rect.width * paneEdgeSnapRatio;
  const edgeBandY = args.rect.height * paneEdgeSnapRatio;
  const candidates: PaneSnapCandidate[] = [];

  if (args.pointerX <= edgeBandX) {
    candidates.push({
      type: "split",
      position: "left",
      distance: args.pointerX,
    });
  }

  if (args.pointerX >= args.rect.width - edgeBandX) {
    candidates.push({
      type: "split",
      position: "right",
      distance: args.rect.width - args.pointerX,
    });
  }

  if (args.pointerY >= args.rect.height - edgeBandY) {
    candidates.push({
      type: "split",
      position: "bottom",
      distance: args.rect.height - args.pointerY,
    });
  }

  if (args.tabRects.length === 0) {
    candidates.push({
      type: "insert",
      position: "center",
      distance: Number.POSITIVE_INFINITY,
      markerLeft: args.stripScrollLeft,
      insertionIndex: 0,
    });
  } else {
    args.tabRects.forEach((rect, index) => {
      const markerLeft = rect.left + args.stripScrollLeft;
      candidates.push({
        type: "insert",
        position: "center",
        distance: Math.abs(args.pointerX - rect.left),
        markerLeft,
        insertionIndex: index,
      });

      if (index === args.tabRects.length - 1) {
        candidates.push({
          type: "insert",
          position: "center",
          distance: Math.abs(args.pointerX - rect.right),
          markerLeft: rect.right + args.stripScrollLeft,
          insertionIndex: args.tabRects.length,
        });
      }
    });
  }

  candidates.sort((left, right) => left.distance - right.distance);
  const winner = candidates[0];
  if (!winner) {
    return {
      type: "insert",
      position: "center",
      markerLeft: args.stripScrollLeft,
    };
  }

  if (winner.type === "split") {
    return { type: "split", position: winner.position };
  }

  return {
    type: "insert",
    position: "center",
    markerLeft: winner.markerLeft ?? args.stripScrollLeft,
    insertionIndex: winner.insertionIndex ?? 0,
  };
};
