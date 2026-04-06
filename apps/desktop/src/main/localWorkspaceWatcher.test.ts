import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalWorkspaceWatcher } from "./localWorkspaceWatcher";

const createTimerHarness = () => {
  let nextId = 0;
  const callbacks = new Map<number, () => void>();

  return {
    schedule(callback: () => void) {
      const handle = ++nextId;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle: unknown) {
      callbacks.delete(handle as number);
    },
    flushLatest() {
      const latestHandle = [...callbacks.keys()].at(-1);
      if (latestHandle === undefined) {
        throw new Error("Expected a scheduled callback.");
      }

      const callback = callbacks.get(latestHandle);
      if (!callback) {
        throw new Error("Expected a scheduled callback to exist.");
      }
      callbacks.delete(latestHandle);
      callback();
    },
  };
};

const requireListener = (
  listeners: Map<
    string,
    (eventType: string, fileName: string | Buffer | null) => void
  >,
  directoryPath: string,
) => {
  const listener = listeners.get(directoryPath);
  if (!listener) {
    throw new Error(`Expected a watcher for '${directoryPath}'.`);
  }

  return listener;
};

describe("LocalWorkspaceWatcher", () => {
  it("watches nested directories except ignored ones", () => {
    const root = mkdtempSync(join(tmpdir(), "magick-watcher-"));
    const watchedDirectories: string[] = [];

    try {
      mkdirSync(join(root, "notes", "research"), { recursive: true });
      mkdirSync(join(root, ".git", "objects"), { recursive: true });
      mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });

      const watcher = new LocalWorkspaceWatcher({
        workspaceDir: root,
        onEvent: () => {},
        watchDirectory(directoryPath) {
          watchedDirectories.push(directoryPath);
          return { close() {} };
        },
      });

      watcher.start();

      expect(watchedDirectories).toEqual([
        root,
        join(root, "notes"),
        join(root, "notes", "research"),
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("coalesces duplicate supported file events into one normalized payload", () => {
    const root = mkdtempSync(join(tmpdir(), "magick-watcher-"));
    const watchedListeners = new Map<
      string,
      (eventType: string, fileName: string | Buffer | null) => void
    >();
    const emittedEvents: { type: string; filePaths: readonly string[] }[] = [];
    const timers = createTimerHarness();

    try {
      mkdirSync(join(root, "notes"), { recursive: true });

      const watcher = new LocalWorkspaceWatcher({
        workspaceDir: root,
        onEvent: (event) => emittedEvents.push(event),
        schedule: (callback) => timers.schedule(callback),
        cancelSchedule: (handle) => timers.cancel(handle),
        watchDirectory(directoryPath, listener) {
          watchedListeners.set(directoryPath, listener);
          return { close() {} };
        },
      });

      watcher.start();
      requireListener(watchedListeners, join(root, "notes"))(
        "change",
        "guide.md",
      );
      requireListener(watchedListeners, join(root, "notes"))(
        "change",
        "guide.md",
      );
      requireListener(watchedListeners, join(root, "notes"))(
        "rename",
        "notes.md",
      );
      timers.flushLatest();

      expect(emittedEvents).toEqual([
        {
          type: "workspace.files.changed",
          filePaths: ["notes/guide.md", "notes/notes.md"],
        },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("emits an empty file list when the runtime cannot identify the changed file", () => {
    const root = mkdtempSync(join(tmpdir(), "magick-watcher-"));
    const watchedListeners = new Map<
      string,
      (eventType: string, fileName: string | Buffer | null) => void
    >();
    const emittedEvents: { type: string; filePaths: readonly string[] }[] = [];
    const timers = createTimerHarness();

    try {
      const watcher = new LocalWorkspaceWatcher({
        workspaceDir: root,
        onEvent: (event) => emittedEvents.push(event),
        schedule: (callback) => timers.schedule(callback),
        cancelSchedule: (handle) => timers.cancel(handle),
        watchDirectory(directoryPath, listener) {
          watchedListeners.set(directoryPath, listener);
          return { close() {} };
        },
      });

      watcher.start();
      requireListener(watchedListeners, root)("change", null);
      timers.flushLatest();

      expect(emittedEvents).toEqual([
        { type: "workspace.files.changed", filePaths: [] },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("adds new directories to the watcher set after filesystem changes", () => {
    const root = mkdtempSync(join(tmpdir(), "magick-watcher-"));
    const watchedDirectories: string[] = [];
    const watchedListeners = new Map<
      string,
      (eventType: string, fileName: string | Buffer | null) => void
    >();
    const timers = createTimerHarness();

    try {
      writeFileSync(join(root, "seed.md"), "seed", "utf8");

      const watcher = new LocalWorkspaceWatcher({
        workspaceDir: root,
        onEvent: () => {},
        schedule: (callback) => timers.schedule(callback),
        cancelSchedule: (handle) => timers.cancel(handle),
        watchDirectory(directoryPath, listener) {
          watchedDirectories.push(directoryPath);
          watchedListeners.set(directoryPath, listener);
          return { close() {} };
        },
      });

      watcher.start();
      mkdirSync(join(root, "notes"), { recursive: true });
      requireListener(watchedListeners, root)("rename", "notes");
      timers.flushLatest();

      expect(watchedDirectories).toContain(join(root, "notes"));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("ignores events inside ignored directories when a filename is present", () => {
    const root = mkdtempSync(join(tmpdir(), "magick-watcher-"));
    const watchedListeners = new Map<
      string,
      (eventType: string, fileName: string | Buffer | null) => void
    >();
    const emittedEvents: { type: string; filePaths: readonly string[] }[] = [];
    const timers = createTimerHarness();

    try {
      mkdirSync(join(root, ".magick"), { recursive: true });

      const watcher = new LocalWorkspaceWatcher({
        workspaceDir: root,
        onEvent: (event) => emittedEvents.push(event),
        schedule: (callback) => timers.schedule(callback),
        cancelSchedule: (handle) => timers.cancel(handle),
        watchDirectory(directoryPath, listener) {
          watchedListeners.set(directoryPath, listener);
          return { close() {} };
        },
      });

      watcher.start();
      requireListener(watchedListeners, root)("rename", ".magick");
      timers.flushLatest();

      expect(emittedEvents).toEqual([
        { type: "workspace.files.changed", filePaths: [] },
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("survives read-directory failures caused by racing filesystem changes", () => {
    const root = mkdtempSync(join(tmpdir(), "magick-watcher-"));

    try {
      const watcher = new LocalWorkspaceWatcher({
        workspaceDir: root,
        onEvent: () => {},
        readDirectoryEntries() {
          throw new Error("directory disappeared");
        },
        watchDirectory() {
          throw new Error("should not be called");
        },
      });

      expect(() => watcher.start()).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("survives watch-registration failures for unstable directories", () => {
    const root = mkdtempSync(join(tmpdir(), "magick-watcher-"));

    try {
      mkdirSync(join(root, "notes"), { recursive: true });
      const watcher = new LocalWorkspaceWatcher({
        workspaceDir: root,
        onEvent: () => {},
        watchDirectory(directoryPath) {
          if (directoryPath.endsWith("notes")) {
            throw new Error("directory vanished before watch");
          }
          return { close() {} };
        },
      });

      expect(() => watcher.start()).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
