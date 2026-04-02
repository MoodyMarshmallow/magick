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

export interface WorkspacePaneSnapResult {
  readonly type: "split" | "insert";
  readonly position: WorkspaceDropPosition;
  readonly markerLeft?: number;
  readonly insertionIndex?: number;
}

const compareCandidates = (
  left: PaneSnapCandidate,
  right: PaneSnapCandidate,
): number => left.distance - right.distance;

const resolveInsertionCandidate = (args: {
  pointerX: number;
  stripScrollLeft: number;
  tabRects: readonly { left: number; right: number }[];
}): PaneSnapCandidate => {
  if (args.tabRects.length === 0) {
    return {
      type: "insert",
      position: "center",
      distance: args.pointerX,
      markerLeft: args.stripScrollLeft,
      insertionIndex: 0,
    };
  }

  const candidates: PaneSnapCandidate[] = [];
  args.tabRects.forEach((rect, index) => {
    candidates.push({
      type: "insert",
      position: "center",
      distance: Math.abs(args.pointerX - rect.left),
      markerLeft: rect.left + args.stripScrollLeft,
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

  candidates.sort(compareCandidates);
  return (
    candidates[0] ?? {
      type: "insert",
      position: "center",
      distance: 0,
      markerLeft: args.stripScrollLeft,
      insertionIndex: 0,
    }
  );
};

const toSnapResult = (
  candidate: PaneSnapCandidate,
  stripScrollLeft: number,
): WorkspacePaneSnapResult => {
  if (candidate.type === "split") {
    return { type: "split", position: candidate.position };
  }

  return {
    type: "insert",
    position: "center",
    markerLeft: candidate.markerLeft ?? stripScrollLeft,
    insertionIndex: candidate.insertionIndex ?? 0,
  };
};

export const resolveBodyPaneSnap = (args: {
  rect: { width: number; height: number };
  pointerX: number;
  pointerY: number;
  stripScrollLeft: number;
  tabRects: readonly { left: number; right: number }[];
}): WorkspacePaneSnapResult => {
  const edgeBandX = args.rect.width * paneEdgeSnapRatio;
  const edgeBandY = args.rect.height * paneEdgeSnapRatio;
  const inLeftEdge = args.pointerX <= edgeBandX;
  const inRightEdge = args.pointerX >= args.rect.width - edgeBandX;
  const inBottomEdge = args.pointerY >= args.rect.height - edgeBandY;
  const insertionCandidate = resolveInsertionCandidate({
    pointerX: args.pointerX,
    stripScrollLeft: args.stripScrollLeft,
    tabRects: args.tabRects,
  });

  if (!inLeftEdge && !inRightEdge && !inBottomEdge) {
    return toSnapResult(insertionCandidate, args.stripScrollLeft);
  }

  const candidates: PaneSnapCandidate[] = [];
  if (inLeftEdge) {
    candidates.push({
      type: "split",
      position: "left",
      distance: args.pointerX,
    });
  }

  if (inRightEdge) {
    candidates.push({
      type: "split",
      position: "right",
      distance: args.rect.width - args.pointerX,
    });
  }

  if (inBottomEdge) {
    candidates.push({
      type: "split",
      position: "bottom",
      distance: args.rect.height - args.pointerY,
    });
  }

  if (inLeftEdge || inRightEdge || !inBottomEdge) {
    candidates.push({
      ...insertionCandidate,
      distance: args.pointerY,
    });
  }

  candidates.sort(compareCandidates);
  return toSnapResult(
    candidates[0] ?? insertionCandidate,
    args.stripScrollLeft,
  );
};

export const resolveTabStripSnap = (args: {
  rect: { width: number; height: number };
  pointerX: number;
  pointerY: number;
  stripScrollLeft: number;
  tabRects: readonly { left: number; right: number }[];
}): WorkspacePaneSnapResult => {
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

  candidates.push(
    resolveInsertionCandidate({
      pointerX: args.pointerX,
      stripScrollLeft: args.stripScrollLeft,
      tabRects: args.tabRects,
    }),
  );

  candidates.sort(compareCandidates);
  return toSnapResult(
    candidates[0] ??
      resolveInsertionCandidate({
        pointerX: args.pointerX,
        stripScrollLeft: args.stripScrollLeft,
        tabRects: args.tabRects,
      }),
    args.stripScrollLeft,
  );
};
