import type {
  LocalWorkspaceFileEvent,
  MagickDesktopFileApi,
} from "@magick/shared/localWorkspace";
import { vi } from "vitest";
import {
  createDesktopLocalWorkspaceFileClient,
  createDevLocalWorkspaceFileClient,
} from "./localWorkspaceFileClient";

describe("localWorkspaceFileClient", () => {
  it("subscribes to desktop workspace events through the file API", () => {
    const listeners: Array<(event: LocalWorkspaceFileEvent) => void> = [];
    const desktopApi: MagickDesktopFileApi = {
      getFileWorkspaceBootstrap: async () => ({
        workspaceRoot: "/tmp",
        tree: [],
      }),
      openFile: async () => ({
        filePath: "notes/a.md",
        title: "A",
        markdown: "",
      }),
      saveFile: async () => {},
      createFile: async () => ({ filePath: "notes/untitled.md" }),
      createDirectory: async () => ({ path: "notes/untitled-folder" }),
      renameFile: async (filePath) => ({
        previousFilePath: filePath,
        filePath: "notes/renamed.md",
      }),
      renameDirectory: async (directoryPath) => ({
        previousPath: directoryPath,
        path: "notes/renamed-folder",
        filePathChanges: [],
      }),
      deleteFile: async (filePath) => ({ deletedFilePaths: [filePath] }),
      deleteDirectory: async () => ({ deletedFilePaths: [] }),
      onWorkspaceEvent(listener) {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      },
    };

    const client = createDesktopLocalWorkspaceFileClient(desktopApi);
    const received: LocalWorkspaceFileEvent[] = [];
    const unsubscribe = client.onWorkspaceEvent((event) =>
      received.push(event),
    );

    listeners[0]?.({
      type: "workspace.files.changed",
      filePaths: ["notes/a.md"],
    });
    unsubscribe();
    listeners[0]?.({
      type: "workspace.files.changed",
      filePaths: ["notes/b.md"],
    });

    expect(received).toEqual([
      { type: "workspace.files.changed", filePaths: ["notes/a.md"] },
    ]);
  });

  it("subscribes to dev workspace events through EventSource", () => {
    const messageListeners: Array<(event: MessageEvent<string>) => void> = [];
    const closeCalls: string[] = [];

    class FakeEventSource {
      public constructor(public readonly url: string) {}

      public addEventListener(_type: string, listener: EventListener) {
        messageListeners.push(
          listener as (event: MessageEvent<string>) => void,
        );
      }

      public removeEventListener(_type: string, listener: EventListener) {
        const index = messageListeners.indexOf(
          listener as (event: MessageEvent<string>) => void,
        );
        if (index >= 0) {
          messageListeners.splice(index, 1);
        }
      }

      public close() {
        closeCalls.push(this.url);
      }
    }

    const originalEventSource = globalThis.EventSource;
    Object.assign(globalThis, { EventSource: FakeEventSource });

    try {
      const client = createDevLocalWorkspaceFileClient();
      const received: LocalWorkspaceFileEvent[] = [];
      const unsubscribe = client.onWorkspaceEvent((event) =>
        received.push(event),
      );

      messageListeners[0]?.(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "workspace.files.changed",
            filePaths: ["notes/research/layout-observations.md"],
          }),
        }),
      );
      unsubscribe();

      expect(received).toEqual([
        {
          type: "workspace.files.changed",
          filePaths: ["notes/research/layout-observations.md"],
        },
      ]);
      expect(closeCalls).toEqual(["/api/local-workspace/events"]);
    } finally {
      Object.assign(globalThis, { EventSource: originalEventSource });
    }
  });

  it("creates files and directories through the desktop file API", async () => {
    const desktopApi: MagickDesktopFileApi = {
      getFileWorkspaceBootstrap: async () => ({
        workspaceRoot: "/tmp",
        tree: [],
      }),
      openFile: async () => ({
        filePath: "notes/a.md",
        title: "A",
        markdown: "",
      }),
      saveFile: async () => {},
      createFile: async (directoryPath) => ({
        filePath: `${directoryPath}/untitled.md`,
      }),
      createDirectory: async (directoryPath) => ({
        path: `${directoryPath}/untitled-folder`,
      }),
      renameFile: async (filePath) => ({
        previousFilePath: filePath,
        filePath: "notes/renamed.md",
      }),
      renameDirectory: async (directoryPath) => ({
        previousPath: directoryPath,
        path: "notes/renamed-folder",
        filePathChanges: [],
      }),
      deleteFile: async (filePath) => ({ deletedFilePaths: [filePath] }),
      deleteDirectory: async (directoryPath) => ({
        deletedFilePaths: [`${directoryPath}/a.md`],
      }),
      onWorkspaceEvent: () => () => {},
    };

    const client = createDesktopLocalWorkspaceFileClient(desktopApi);

    await expect(client.createFile("notes")).resolves.toEqual({
      filePath: "notes/untitled.md",
    });
    await expect(client.createDirectory("notes")).resolves.toEqual({
      path: "notes/untitled-folder",
    });
    await expect(
      client.renameFile("notes/a.md", "renamed.md"),
    ).resolves.toEqual({
      previousFilePath: "notes/a.md",
      filePath: "notes/renamed.md",
    });
    await expect(client.deleteFile("notes/a.md")).resolves.toEqual({
      deletedFilePaths: ["notes/a.md"],
    });
  });

  it("calls the dev workspace mutation routes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.includes("create-file")
            ? { filePath: "notes/untitled.md" }
            : url.includes("create-directory")
              ? { path: "notes/untitled-folder" }
              : url.includes("rename-file")
                ? {
                    previousFilePath: "notes/a.md",
                    filePath: "notes/renamed.md",
                  }
                : url.includes("rename-directory")
                  ? {
                      previousPath: "notes",
                      path: "notes/renamed-folder",
                      filePathChanges: [],
                    }
                  : { deletedFilePaths: ["notes/a.md"] },
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    const originalFetch = globalThis.fetch;
    Object.assign(globalThis, { fetch: fetchMock });

    try {
      const client = createDevLocalWorkspaceFileClient();

      await expect(client.createFile("notes")).resolves.toEqual({
        filePath: "notes/untitled.md",
      });
      await expect(client.createDirectory("notes")).resolves.toEqual({
        path: "notes/untitled-folder",
      });
      await expect(client.createFile("")).resolves.toEqual({
        filePath: "notes/untitled.md",
      });
      await expect(
        client.renameFile("notes/a.md", "renamed.md"),
      ).resolves.toEqual({
        previousFilePath: "notes/a.md",
        filePath: "notes/renamed.md",
      });
      await expect(
        client.renameDirectory("notes", "renamed-folder"),
      ).resolves.toEqual({
        previousPath: "notes",
        path: "notes/renamed-folder",
        filePathChanges: [],
      });
      await expect(client.deleteFile("notes/a.md")).resolves.toEqual({
        deletedFilePaths: ["notes/a.md"],
      });
      await expect(client.deleteDirectory("notes")).resolves.toEqual({
        deletedFilePaths: ["notes/a.md"],
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "/api/local-workspace/create-file?directoryPath=notes",
        { method: "POST" },
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/api/local-workspace/create-directory?directoryPath=notes",
        { method: "POST" },
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "/api/local-workspace/create-file?directoryPath=",
        { method: "POST" },
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        4,
        "/api/local-workspace/rename-file?path=notes%2Fa.md&name=renamed.md",
        { method: "POST" },
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        5,
        "/api/local-workspace/rename-directory?path=notes&name=renamed-folder",
        { method: "POST" },
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        6,
        "/api/local-workspace/delete-file?path=notes%2Fa.md",
        { method: "POST" },
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        7,
        "/api/local-workspace/delete-directory?path=notes",
        { method: "POST" },
      );
    } finally {
      Object.assign(globalThis, { fetch: originalFetch });
    }
  });
});
