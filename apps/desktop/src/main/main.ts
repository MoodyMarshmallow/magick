import { join } from "node:path";
import { BrowserWindow, app, ipcMain } from "electron";
import { LocalWorkspaceService } from "./localWorkspaceService";

const eventChannel = "magick-desktop:thread-event";

const createWorkspaceService = () => {
  const userDataPath = app.getPath("userData");
  return new LocalWorkspaceService({
    workspaceDir: join(userDataPath, "workspace"),
  });
};

const registerIpc = (
  window: BrowserWindow,
  workspaceService: LocalWorkspaceService,
): void => {
  ipcMain.handle("magick-desktop:getWorkspaceBootstrap", async () => {
    return workspaceService.getWorkspaceBootstrap();
  });
  ipcMain.handle(
    "magick-desktop:openDocument",
    async (_event, documentId: string) => {
      return workspaceService.openDocument(documentId);
    },
  );
  ipcMain.handle(
    "magick-desktop:saveDocument",
    async (_event, documentId: string, markdown: string) => {
      workspaceService.saveDocument(documentId, markdown);
    },
  );
  ipcMain.handle(
    "magick-desktop:sendThreadMessage",
    async (_event, threadId: string, body: string) => {
      for (const threadEvent of workspaceService.sendThreadMessage(
        threadId,
        body,
      )) {
        window.webContents.send(eventChannel, threadEvent);
      }
    },
  );
  ipcMain.handle(
    "magick-desktop:toggleThreadResolved",
    async (_event, threadId: string) => {
      const threadEvent = workspaceService.toggleThreadResolved(threadId);
      window.webContents.send(eventChannel, threadEvent);
    },
  );
};

const createWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#232a2e",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.ts"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerIpc(window, createWorkspaceService());

  if (process.env.MAGICK_RENDERER_URL) {
    await window.loadURL(process.env.MAGICK_RENDERER_URL);
    return;
  }

  await window.loadFile(join(import.meta.dirname, "../../../web/index.html"));
};

app.whenReady().then(async () => {
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
