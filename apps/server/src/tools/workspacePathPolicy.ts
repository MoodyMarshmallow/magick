import { realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";

const supportedFileExtensions = new Set([".md"]);

export class WorkspacePathPolicyError extends Error {
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
    return this.resolvePath(pathWithinWorkspace, { allowRoot: true });
  }

  resolveFile(pathWithinWorkspace: string): string {
    const absolutePath = this.resolvePath(pathWithinWorkspace);
    const extension = extname(absolutePath).toLowerCase();
    if (!supportedFileExtensions.has(extension)) {
      throw new WorkspacePathPolicyError(
        `Only markdown files are supported. Received '${extension || "<none>"}'.`,
      );
    }

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

    const absoluteParentPath = dirname(absolutePath);
    if (!pathIsInsideRoot(this.#workspaceRoot, absoluteParentPath)) {
      throw new WorkspacePathPolicyError(
        "Requested file path is outside the workspace root.",
      );
    }

    return absolutePath;
  }
}
