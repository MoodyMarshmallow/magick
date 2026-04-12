import { isAbsolute, relative, resolve, sep } from "node:path";

type ToolPathPresentationMode = "workspace-relative" | "absolute";

const toPosixPath = (value: string): string => value.split(sep).join("/");

export class PathPresentationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathPresentationError";
  }
}

export class PathPresentationPolicy {
  readonly #mode: ToolPathPresentationMode;

  constructor(mode: ToolPathPresentationMode = "workspace-relative") {
    this.#mode = mode;
  }

  get mode(): ToolPathPresentationMode {
    return this.#mode;
  }

  toAgentPath(workspaceRoot: string, absolutePath: string): string {
    if (this.#mode === "absolute") {
      return toPosixPath(absolutePath);
    }

    const normalizedRoot = resolve(workspaceRoot);
    const normalizedPath = resolve(absolutePath);
    const relativePath = relative(normalizedRoot, normalizedPath);
    if (
      relativePath.length === 0 ||
      relativePath === "." ||
      relativePath.startsWith("..") ||
      isAbsolute(relativePath)
    ) {
      return "";
    }

    return toPosixPath(relativePath);
  }

  fromAgentPath(rawPath: string): string {
    const trimmedPath = rawPath.trim();
    if (trimmedPath.length === 0) {
      return "";
    }

    if (this.#mode === "absolute") {
      return trimmedPath;
    }

    if (isAbsolute(trimmedPath)) {
      throw new PathPresentationError(
        "Absolute paths are hidden while workspace-relative path mode is enabled.",
      );
    }

    const normalized = toPosixPath(trimmedPath);
    if (normalized === ".") {
      return "";
    }

    if (
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized.includes("/../")
    ) {
      throw new PathPresentationError(
        "Paths must stay within the workspace root while workspace-relative path mode is enabled.",
      );
    }

    return normalized.replace(/^\.\//, "");
  }
}
