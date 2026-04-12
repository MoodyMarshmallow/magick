import type { ToolExecutionResult } from "./toolTypes";

const MAX_PREVIEW_LENGTH = 500;

const truncate = (value: string | null): string | null => {
  if (value == null) {
    return null;
  }

  return value.length > MAX_PREVIEW_LENGTH
    ? `${value.slice(0, MAX_PREVIEW_LENGTH - 3)}...`
    : value;
};

export const serializeToolResult = (
  result: ToolExecutionResult,
): ToolExecutionResult => ({
  ...result,
  resultPreview: truncate(result.resultPreview),
});
