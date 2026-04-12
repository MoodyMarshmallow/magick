import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { DocumentService } from "../documents/documentService";
import type { PathPresentationPolicy } from "./pathPresentationPolicy";
import { sanitizeWorkspaceError, toPosixPath } from "./workspaceAccess";
import type { WorkspacePathPolicy } from "./workspacePathPolicy";

const execFileAsync = promisify(execFile);

type ExecFileResult = {
  readonly stdout: string;
  readonly stderr: string;
};

type ExecFileRunner = (
  file: string,
  args: readonly string[],
  options: { readonly cwd: string },
) => Promise<ExecFileResult>;

interface WorkspaceGrepMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

interface WorkspaceListTreeResult {
  readonly path: string;
  readonly output: string;
  readonly count: number;
  readonly truncated: boolean;
}

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const globPatternToRegex = (pattern: string): RegExp => {
  let regex = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const nextChar = pattern[index + 1];
    const thirdChar = pattern[index + 2];

    if (char === "*" && nextChar === "*" && thirdChar === "/") {
      regex += "(?:.*/)?";
      index += 2;
      continue;
    }

    if (char === "*" && nextChar === "*") {
      regex += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    regex += escapeRegex(char ?? "");
  }

  return new RegExp(`${regex}$`);
};

export class WorkspaceQueryService {
  readonly #pathPolicy: WorkspacePathPolicy;
  readonly #presentationPolicy: PathPresentationPolicy;
  readonly #documents: DocumentService;
  readonly #execFile: ExecFileRunner;
  readonly #ignoredListPatterns = [
    ".git/**",
    ".magick/**",
    "node_modules/**",
  ] as const;

  constructor(args: {
    readonly pathPolicy: WorkspacePathPolicy;
    readonly presentationPolicy: PathPresentationPolicy;
    readonly documents: DocumentService;
    readonly execFile?: ExecFileRunner;
  }) {
    this.#pathPolicy = args.pathPolicy;
    this.#presentationPolicy = args.presentationPolicy;
    this.#documents = args.documents;
    this.#execFile = args.execFile ?? execFileAsync;
  }

  get workspaceRoot(): string {
    return this.#pathPolicy.workspaceRoot;
  }

  readonly toAgentPath = (absolutePath: string): string =>
    this.#presentationPolicy.toAgentPath(this.workspaceRoot, absolutePath);

  readonly resolveDirectory = (directoryPath: string): string =>
    this.#pathPolicy.resolveDirectory(
      this.#presentationPolicy.fromAgentPath(directoryPath),
    );

  readonly listTree = async (input: {
    readonly path?: string;
    readonly ignore?: readonly string[];
    readonly hidden?: boolean;
    readonly follow?: boolean;
    readonly maxDepth?: number;
    readonly limit?: number;
  }): Promise<WorkspaceListTreeResult> => {
    try {
      const searchPath = this.resolveDirectory(input.path ?? "");
      const searchRootRelativePath =
        toPosixPath(relative(this.workspaceRoot, searchPath)) || ".";
      const args = ["--files"];
      if (input.follow) {
        args.push("--follow");
      }
      if (input.hidden !== false) {
        args.push("--hidden");
      }
      if (input.maxDepth !== undefined) {
        args.push(`--max-depth=${input.maxDepth}`);
      }

      const ignoreGlobs = [
        ...this.#ignoredListPatterns,
        ...(input.ignore ?? []),
      ];
      for (const ignorePattern of ignoreGlobs) {
        args.push(`--glob=!${ignorePattern}`);
      }
      if (searchRootRelativePath !== ".") {
        args.push(searchRootRelativePath);
      }

      let stdout = "";
      try {
        const result = await this.#execFile("rg", args, {
          cwd: this.workspaceRoot,
        });
        stdout = result.stdout;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === 1 &&
          "stdout" in error &&
          typeof error.stdout === "string"
        ) {
          stdout = error.stdout;
        } else {
          throw error;
        }
      }
      const files = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const normalizedLine = toPosixPath(line);
          if (searchRootRelativePath === ".") {
            return normalizedLine;
          }

          const searchPrefix = `${searchRootRelativePath}/`;
          return normalizedLine.startsWith(searchPrefix)
            ? normalizedLine.slice(searchPrefix.length)
            : normalizedLine;
        });
      const limit = input.limit ?? 100;
      const limitedFiles = files.slice(0, limit);

      const dirs = new Set<string>(["."]);
      const filesByDir = new Map<string, string[]>();
      for (const file of limitedFiles) {
        const normalizedFile = toPosixPath(file);
        const directoryPath = dirname(normalizedFile);
        const parts =
          directoryPath === "." ? [] : toPosixPath(directoryPath).split("/");
        for (let index = 0; index <= parts.length; index += 1) {
          const dirPath = index === 0 ? "." : parts.slice(0, index).join("/");
          dirs.add(dirPath);
        }
        const fileDirectory =
          directoryPath === "." ? "." : toPosixPath(directoryPath);
        const entries = filesByDir.get(fileDirectory) ?? [];
        entries.push(normalizedFile.split("/").at(-1) ?? normalizedFile);
        filesByDir.set(fileDirectory, entries);
      }

      const renderDir = (dirPath: string, depth: number): string => {
        const indent = "  ".repeat(depth);
        let output = "";
        if (depth > 0) {
          output += `${indent}${dirPath.split("/").at(-1) ?? dirPath}/\n`;
        }
        const childIndent = "  ".repeat(depth + 1);
        const children = Array.from(dirs)
          .filter((entry) => dirname(entry) === dirPath && entry !== dirPath)
          .sort((left, right) => left.localeCompare(right));
        for (const child of children) {
          output += renderDir(child, depth + 1);
        }
        const childFiles = (filesByDir.get(dirPath) ?? []).sort((left, right) =>
          left.localeCompare(right),
        );
        for (const file of childFiles) {
          output += `${childIndent}${file}\n`;
        }
        return output;
      };

      const agentPath = this.toAgentPath(searchPath) || ".";
      return {
        path: agentPath,
        output: `${agentPath}/\n${renderDir(".", 0)}`,
        count: limitedFiles.length,
        truncated: files.length > limit,
      };
    } catch (error) {
      throw sanitizeWorkspaceError(this.workspaceRoot, error);
    }
  };

  readonly glob = async (pattern: string): Promise<readonly string[]> => {
    try {
      const matcher = globPatternToRegex(pattern || "**/*.md");
      const matches: string[] = [];
      const visit = async (absoluteDirectoryPath: string): Promise<void> => {
        const entries = await readdir(absoluteDirectoryPath, {
          withFileTypes: true,
        });
        for (const entry of entries) {
          if (
            entry.name === ".git" ||
            entry.name === ".magick" ||
            entry.name === "node_modules"
          ) {
            continue;
          }

          const absoluteChildPath = join(absoluteDirectoryPath, entry.name);
          if (entry.isDirectory()) {
            await visit(absoluteChildPath);
            continue;
          }

          if (!entry.isFile() || !entry.name.endsWith(".md")) {
            continue;
          }

          const relativePath = toPosixPath(
            relative(this.workspaceRoot, absoluteChildPath),
          );
          if (matcher.test(relativePath)) {
            matches.push(this.toAgentPath(absoluteChildPath));
          }
        }
      };

      await visit(this.workspaceRoot);
      return matches.sort((left, right) => left.localeCompare(right));
    } catch (error) {
      throw sanitizeWorkspaceError(this.workspaceRoot, error);
    }
  };

  readonly grep = async (
    pattern: string,
  ): Promise<readonly WorkspaceGrepMatch[]> => {
    const expression = new RegExp(pattern, "i");
    const matches: WorkspaceGrepMatch[] = [];
    const paths = await this.glob("**/*.md");
    for (const path of paths) {
      const file = await this.#documents.read(path);
      const lines = file.content.split("\n");
      lines.forEach((lineText, index) => {
        if (expression.test(lineText)) {
          matches.push({
            path: file.path,
            line: index + 1,
            text: lineText,
          });
        }
      });
    }

    return matches;
  };
}
