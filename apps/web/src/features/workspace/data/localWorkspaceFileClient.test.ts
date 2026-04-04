import type {
  LocalWorkspaceFileEvent,
  MagickDesktopFileApi,
} from "@magick/shared/localWorkspace";
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
});
