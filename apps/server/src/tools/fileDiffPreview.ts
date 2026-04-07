export interface FileDiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
}

export interface FileDiffPreview {
  readonly kind: "created" | "updated";
  readonly path: string;
  readonly hunks: readonly FileDiffHunk[];
  readonly truncated: boolean;
}

const MAX_DIFF_LINES = 120;

const splitLines = (value: string): readonly string[] => value.split("\n");

export const createFileDiffPreview = (args: {
  readonly path: string;
  readonly previousContent: string | null;
  readonly nextContent: string;
}): FileDiffPreview => {
  const previousLines =
    args.previousContent === null ? [] : splitLines(args.previousContent);
  const nextLines = splitLines(args.nextContent);
  const lines: string[] = [];

  if (args.previousContent === null) {
    for (const line of nextLines) {
      lines.push(`+${line}`);
    }
    const truncated = lines.length > MAX_DIFF_LINES;
    return {
      kind: "created",
      path: args.path,
      hunks: [
        {
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: nextLines.length,
          lines: truncated ? lines.slice(0, MAX_DIFF_LINES) : lines,
        },
      ],
      truncated,
    };
  }

  const maxLength = Math.max(previousLines.length, nextLines.length);
  const oldStart = 1;
  const newStart = 1;
  let oldLines = 0;
  let newLines = 0;

  for (let index = 0; index < maxLength; index += 1) {
    const previousLine = previousLines[index];
    const nextLine = nextLines[index];
    if (previousLine === nextLine) {
      if (previousLine !== undefined) {
        lines.push(` ${previousLine}`);
        oldLines += 1;
        newLines += 1;
      }
      continue;
    }

    if (previousLine !== undefined) {
      lines.push(`-${previousLine}`);
      oldLines += 1;
    }
    if (nextLine !== undefined) {
      lines.push(`+${nextLine}`);
      newLines += 1;
    }
  }

  const truncated = lines.length > MAX_DIFF_LINES;
  return {
    kind: "updated",
    path: args.path,
    hunks: [
      {
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: truncated ? lines.slice(0, MAX_DIFF_LINES) : lines,
      },
    ],
    truncated,
  };
};

export const formatFileDiffPreview = (diff: FileDiffPreview): string => {
  const hunkLines = diff.hunks.flatMap((hunk) => [
    `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    ...hunk.lines,
  ]);

  return [
    `--- ${diff.kind === "created" ? "/dev/null" : diff.path}`,
    `+++ ${diff.path}`,
    ...hunkLines,
    ...(diff.truncated ? ["... diff truncated ..."] : []),
  ].join("\n");
};
