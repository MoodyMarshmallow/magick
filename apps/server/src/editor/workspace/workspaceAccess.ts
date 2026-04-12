import { sep } from "node:path";

const toPosixPath = (value: string): string => value.split(sep).join("/");

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sanitizeWorkspacePathInMessage = (
  workspaceRoot: string,
  message: string,
): string => {
  const normalizedRoot = toPosixPath(workspaceRoot);
  const rootPattern = new RegExp(escapeRegex(normalizedRoot), "g");
  return message.replace(rootPattern, ".").replace(/\.\//g, "");
};

export class WorkspaceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export const sanitizeWorkspaceError = (
  workspaceRoot: string,
  error: unknown,
): Error => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  return new WorkspaceAccessError(
    sanitizeWorkspacePathInMessage(workspaceRoot, message),
  );
};

export { toPosixPath };
