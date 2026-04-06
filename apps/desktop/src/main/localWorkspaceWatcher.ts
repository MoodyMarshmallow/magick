import { type FSWatcher, readdirSync, watch } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import type { LocalWorkspaceFileEvent } from "@magick/shared/localWorkspace";

const ignoredDirectoryNames = new Set([".git", ".magick", "node_modules"]);
const supportedFileExtensions = new Set([".md"]);

const toPosixPath = (filePath: string): string => filePath.split(sep).join("/");

interface DirectoryEntryLike {
  readonly name: string;
  isDirectory: () => boolean;
}

interface FSWatcherLike {
  close: () => void;
}

interface LocalWorkspaceWatcherOptions {
  readonly workspaceDir: string;
  readonly onEvent: (event: LocalWorkspaceFileEvent) => void;
  readonly debounceMs?: number;
  readonly readDirectoryEntries?: (
    directoryPath: string,
  ) => readonly DirectoryEntryLike[];
  readonly watchDirectory?: (
    directoryPath: string,
    listener: (eventType: string, fileName: string | Buffer | null) => void,
  ) => FSWatcherLike;
  readonly schedule?: (callback: () => void, delayMs: number) => unknown;
  readonly cancelSchedule?: (handle: unknown) => void;
}

const defaultReadDirectoryEntries = (
  directoryPath: string,
): readonly DirectoryEntryLike[] =>
  readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

const defaultWatchDirectory = (
  directoryPath: string,
  listener: (eventType: string, fileName: string | Buffer | null) => void,
): FSWatcherLike => watch(directoryPath, listener) as FSWatcher;

export class LocalWorkspaceWatcher {
  private readonly workspaceDir: string;
  private readonly onEvent: (event: LocalWorkspaceFileEvent) => void;
  private readonly debounceMs: number;
  private readonly readDirectoryEntries: NonNullable<
    LocalWorkspaceWatcherOptions["readDirectoryEntries"]
  >;
  private readonly watchDirectory: NonNullable<
    LocalWorkspaceWatcherOptions["watchDirectory"]
  >;
  private readonly schedule: NonNullable<
    LocalWorkspaceWatcherOptions["schedule"]
  >;
  private readonly cancelSchedule: NonNullable<
    LocalWorkspaceWatcherOptions["cancelSchedule"]
  >;
  private readonly watchersByDirectory = new Map<string, FSWatcherLike>();
  private readonly changedFilePaths = new Set<string>();
  private flushHandle: unknown = null;
  private started = false;

  public constructor(options: LocalWorkspaceWatcherOptions) {
    this.workspaceDir = resolve(options.workspaceDir);
    this.onEvent = options.onEvent;
    this.debounceMs = options.debounceMs ?? 120;
    this.readDirectoryEntries =
      options.readDirectoryEntries ?? defaultReadDirectoryEntries;
    this.watchDirectory = options.watchDirectory ?? defaultWatchDirectory;
    this.schedule =
      options.schedule ??
      ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelSchedule =
      options.cancelSchedule ?? ((handle) => clearTimeout(handle as number));
  }

  public start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.syncWatchers();
  }

  public stop(): void {
    this.started = false;
    if (this.flushHandle !== null) {
      this.cancelSchedule(this.flushHandle);
      this.flushHandle = null;
    }

    for (const watcher of this.watchersByDirectory.values()) {
      watcher.close();
    }

    this.watchersByDirectory.clear();
    this.changedFilePaths.clear();
  }

  private syncWatchers(): void {
    const nextDirectories = new Set<string>();
    const visitDirectory = (directoryPath: string) => {
      nextDirectories.add(directoryPath);

      let entries: readonly DirectoryEntryLike[] = [];
      try {
        entries = this.readDirectoryEntries(directoryPath);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || ignoredDirectoryNames.has(entry.name)) {
          continue;
        }

        visitDirectory(join(directoryPath, entry.name));
      }
    };

    visitDirectory(this.workspaceDir);

    for (const [directoryPath, watcher] of this.watchersByDirectory.entries()) {
      if (nextDirectories.has(directoryPath)) {
        continue;
      }

      watcher.close();
      this.watchersByDirectory.delete(directoryPath);
    }

    for (const directoryPath of nextDirectories) {
      if (this.watchersByDirectory.has(directoryPath)) {
        continue;
      }

      this.watchersByDirectory.set(
        directoryPath,
        this.createDirectoryWatcher(directoryPath),
      );
    }
  }

  private createDirectoryWatcher(directoryPath: string): FSWatcherLike {
    try {
      return this.watchDirectory(directoryPath, (_eventType, fileName) => {
        this.handleRawEvent(directoryPath, fileName);
      });
    } catch {
      return { close() {} };
    }
  }

  private handleRawEvent(
    directoryPath: string,
    fileName: string | Buffer | null,
  ): void {
    if (!this.started) {
      return;
    }

    if (fileName) {
      const normalizedFileName = toPosixPath(fileName.toString());
      const relativeDirectoryPath = toPosixPath(
        relative(this.workspaceDir, directoryPath),
      );
      const relativePath =
        relativeDirectoryPath && relativeDirectoryPath !== "."
          ? `${relativeDirectoryPath}/${normalizedFileName}`
          : normalizedFileName;

      if (
        !relativePath.startsWith("../") &&
        !relativePath.includes("/../") &&
        !relativePath
          .split("/")
          .some((segment) => ignoredDirectoryNames.has(segment)) &&
        supportedFileExtensions.has(extname(relativePath).toLowerCase())
      ) {
        this.changedFilePaths.add(relativePath);
      }
    }

    this.syncWatchers();
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushHandle !== null) {
      this.cancelSchedule(this.flushHandle);
    }

    this.flushHandle = this.schedule(() => {
      this.flushHandle = null;
      this.flush();
    }, this.debounceMs);
  }

  private flush(): void {
    this.onEvent({
      type: "workspace.files.changed",
      filePaths: [...this.changedFilePaths].sort(),
    });
    this.changedFilePaths.clear();
  }
}
