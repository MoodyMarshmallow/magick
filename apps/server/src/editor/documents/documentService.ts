import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getLocalWorkspaceFileTitle } from "@magick/shared/localWorkspace";
import type { PathPresentationPolicy } from "../workspace/pathPresentationPolicy";
import { sanitizeWorkspaceError } from "../workspace/workspaceAccess";
import type { WorkspacePathPolicy } from "../workspace/workspacePathPolicy";

export class DocumentService {
  readonly #pathPolicy: WorkspacePathPolicy;
  readonly #presentationPolicy: PathPresentationPolicy;

  constructor(args: {
    readonly pathPolicy: WorkspacePathPolicy;
    readonly presentationPolicy: PathPresentationPolicy;
  }) {
    this.#pathPolicy = args.pathPolicy;
    this.#presentationPolicy = args.presentationPolicy;
  }

  get workspaceRoot(): string {
    return this.#pathPolicy.workspaceRoot;
  }

  readonly toAgentPath = (absolutePath: string): string =>
    this.#presentationPolicy.toAgentPath(this.workspaceRoot, absolutePath);

  readonly resolveFile = (filePath: string): string =>
    this.#pathPolicy.resolveFile(
      this.#presentationPolicy.fromAgentPath(filePath),
    );

  readonly read = async (
    filePath: string,
  ): Promise<{
    readonly path: string;
    readonly title: string;
    readonly content: string;
  }> => {
    try {
      const absoluteFilePath = this.resolveFile(filePath);
      const content = await readFile(absoluteFilePath, "utf8");
      const agentPath = this.toAgentPath(absoluteFilePath);
      return {
        path: agentPath,
        title: getLocalWorkspaceFileTitle(agentPath),
        content,
      };
    } catch (error) {
      throw sanitizeWorkspaceError(this.workspaceRoot, error);
    }
  };

  readonly exists = async (filePath: string): Promise<boolean> => {
    try {
      const absoluteFilePath = this.resolveFile(filePath);
      const details = await stat(absoluteFilePath);
      return details.isFile();
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }

      throw sanitizeWorkspaceError(this.workspaceRoot, error);
    }
  };

  readonly write = async (
    filePath: string,
    content: string,
  ): Promise<{
    readonly path: string;
    readonly previousContent: string | null;
    readonly nextContent: string;
  }> => {
    try {
      const normalizedPath = this.#presentationPolicy.fromAgentPath(filePath);
      const absoluteFilePath =
        this.#pathPolicy.ensureWritableFilePath(normalizedPath);
      await mkdir(dirname(absoluteFilePath), { recursive: true });

      let previousContent: string | null = null;
      try {
        previousContent = await readFile(absoluteFilePath, "utf8");
      } catch {
        previousContent = null;
      }

      await writeFile(absoluteFilePath, content, "utf8");
      return {
        path: this.toAgentPath(absoluteFilePath),
        previousContent,
        nextContent: content,
      };
    } catch (error) {
      throw sanitizeWorkspaceError(this.workspaceRoot, error);
    }
  };
}
