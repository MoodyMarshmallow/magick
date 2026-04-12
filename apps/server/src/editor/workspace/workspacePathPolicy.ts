import { existsSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";

const supportedFileExtensions = new Set([".md"]);

class WorkspacePathPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathPolicyError";
  }
}

const pathIsInsideRoot = (
  workspaceRoot: string,
  absolutePath: string,
): boolean => {
  const normalizedRoot = `${workspaceRoot}${workspaceRoot.endsWith("/") ? "" : "/"}`;
  return (
    absolutePath === workspaceRoot || absolutePath.startsWith(normalizedRoot)
  );
};

export class WorkspacePathPolicy {
  readonly #workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.#workspaceRoot = realpathSync(resolve(workspaceRoot));
  }

  get workspaceRoot(): string {
    return this.#workspaceRoot;
  }

  #ensureResolvedPathInsideRoot(absolutePath: string): void {
    const resolvedPath = realpathSync(absolutePath);
    if (!pathIsInsideRoot(this.#workspaceRoot, resolvedPath)) {
      throw new WorkspacePathPolicyError(
        "Requested path is outside the workspace root.",
      );
    }
  }

  #ensureExistingAncestorInsideRoot(absolutePath: string): void {
    let currentPath = absolutePath;
    while (!existsSync(currentPath)) {
      const parentPath = dirname(currentPath);
      if (parentPath === currentPath) {
        throw new WorkspacePathPolicyError(
          "Requested path is outside the workspace root.",
        );
      }
      currentPath = parentPath;
    }

    this.#ensureResolvedPathInsideRoot(currentPath);
  }

  resolvePath(
    pathWithinWorkspace: string,
    options?: { readonly allowRoot?: boolean },
  ): string {
    const candidatePath = isAbsolute(pathWithinWorkspace)
      ? resolve(pathWithinWorkspace)
      : resolve(this.#workspaceRoot, pathWithinWorkspace);
    if (!pathIsInsideRoot(this.#workspaceRoot, candidatePath)) {
      throw new WorkspacePathPolicyError(
        "Requested path is outside the workspace root.",
      );
    }

    if (!options?.allowRoot && candidatePath === this.#workspaceRoot) {
      throw new WorkspacePathPolicyError(
        "Expected a path inside the workspace root.",
      );
    }

    return candidatePath;
  }

  resolveDirectory(pathWithinWorkspace: string): string {
    const absolutePath = this.resolvePath(pathWithinWorkspace, {
      allowRoot: true,
    });
    this.#ensureExistingAncestorInsideRoot(absolutePath);
    return absolutePath;
  }

  resolveFile(pathWithinWorkspace: string): string {
    const absolutePath = this.resolvePath(pathWithinWorkspace);
    const extension = extname(absolutePath).toLowerCase();
    if (!supportedFileExtensions.has(extension)) {
      throw new WorkspacePathPolicyError(
        `Only markdown files are supported. Received '${extension || "<none>"}'.`,
      );
    }

    this.#ensureResolvedPathInsideRoot(absolutePath);

    return absolutePath;
  }

  ensureWritableFilePath(pathWithinWorkspace: string): string {
    const absolutePath = this.resolvePath(pathWithinWorkspace);
    const extension = extname(absolutePath).toLowerCase();
    if (!supportedFileExtensions.has(extension)) {
      throw new WorkspacePathPolicyError(
        `Only markdown files are supported. Received '${extension || "<none>"}'.`,
      );
    }

    this.#ensureExistingAncestorInsideRoot(dirname(absolutePath));

    if (existsSync(absolutePath)) {
      this.#ensureResolvedPathInsideRoot(absolutePath);
    }

    return absolutePath;
  }
}
