import { type Server, createServer } from "node:http";
import { join } from "node:path";
import { BrowserWindow, app, ipcMain } from "electron";
import { resolveLocalWorkspaceDir } from "../../../../packages/shared/src/localWorkspaceNode";
import {
  attachWebSocketServer,
  createBackendServices,
} from "../../../server/src/index";
import { resolveDesktopBackendDatabasePath } from "./backendRuntime";
import { LocalWorkspaceService } from "./localWorkspaceService";
import { LocalWorkspaceWatcher } from "./localWorkspaceWatcher";

const eventChannel = "magick-desktop:thread-event";
const fileEventChannel = "magick-desktop:file-event";

let backendServer: Server | null = null;
let backendUrl: string | null = null;

const ensureBackendServer = async (
  databasePath: string,
  workspaceRoot: string,
): Promise<string> => {
  if (backendServer && backendUrl) {
    return backendUrl;
  }

  const httpServer = createServer();
  const services = createBackendServices({ databasePath, workspaceRoot });
  attachWebSocketServer(httpServer, services);
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
    httpServer.once("error", reject);
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve local backend address.");
  }

  backendServer = httpServer;
  backendUrl = `ws://127.0.0.1:${address.port}`;
  return backendUrl;
};

const createWorkspaceService = () =>
  new LocalWorkspaceService({
    workspaceDir: resolveLocalWorkspaceDir({ env: process.env }),
  });

const registerIpc = (
  window: BrowserWindow,
  workspaceService: LocalWorkspaceService,
): void => {
  ipcMain.removeHandler("magick-desktop:getWorkspaceBootstrap");
  ipcMain.removeHandler("magick-desktop:getFileWorkspaceBootstrap");
  ipcMain.removeHandler("magick-desktop:openDocument");
  ipcMain.removeHandler("magick-desktop:openFile");
  ipcMain.removeHandler("magick-desktop:saveDocument");
  ipcMain.removeHandler("magick-desktop:saveFile");
  ipcMain.removeHandler("magick-desktop:createFile");
  ipcMain.removeHandler("magick-desktop:createDirectory");
  ipcMain.removeHandler("magick-desktop:renameFile");
  ipcMain.removeHandler("magick-desktop:renameDirectory");
  ipcMain.removeHandler("magick-desktop:deleteFile");
  ipcMain.removeHandler("magick-desktop:deleteDirectory");
  ipcMain.removeHandler("magick-desktop:sendThreadMessage");
  ipcMain.removeHandler("magick-desktop:toggleThreadResolved");
  ipcMain.removeHandler("magick-desktop:getBackendUrl");

  ipcMain.handle("magick-desktop:getWorkspaceBootstrap", async () => {
    return workspaceService.getWorkspaceBootstrap();
  });
  ipcMain.handle("magick-desktop:getFileWorkspaceBootstrap", async () => {
    return workspaceService.getFileWorkspaceBootstrap();
  });
  ipcMain.handle(
    "magick-desktop:openDocument",
    async (_event, documentId: string) => {
      return workspaceService.openDocument(documentId);
    },
  );
  ipcMain.handle(
    "magick-desktop:openFile",
    async (_event, filePath: string) => {
      return workspaceService.openFile(filePath);
    },
  );
  ipcMain.handle(
    "magick-desktop:saveDocument",
    async (_event, documentId: string, markdown: string) => {
      workspaceService.saveDocument(documentId, markdown);
    },
  );
  ipcMain.handle(
    "magick-desktop:saveFile",
    async (_event, filePath: string, markdown: string) => {
      workspaceService.saveFile(filePath, markdown);
    },
  );
  ipcMain.handle(
    "magick-desktop:createFile",
    async (_event, directoryPath: string) => {
      return workspaceService.createFile(directoryPath);
    },
  );
  ipcMain.handle(
    "magick-desktop:createDirectory",
    async (_event, directoryPath: string) => {
      return workspaceService.createDirectory(directoryPath);
    },
  );
  ipcMain.handle(
    "magick-desktop:renameFile",
    async (_event, filePath: string, nextName: string) => {
      return workspaceService.renameFile(filePath, nextName);
    },
  );
  ipcMain.handle(
    "magick-desktop:renameDirectory",
    async (_event, directoryPath: string, nextName: string) => {
      return workspaceService.renameDirectory(directoryPath, nextName);
    },
  );
  ipcMain.handle(
    "magick-desktop:deleteFile",
    async (_event, filePath: string) => {
      return workspaceService.deleteFile(filePath);
    },
  );
  ipcMain.handle(
    "magick-desktop:deleteDirectory",
    async (_event, directoryPath: string) => {
      return workspaceService.deleteDirectory(directoryPath);
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
  ipcMain.handle("magick-desktop:getBackendUrl", async () => {
    return ensureBackendServer(
      resolveDesktopBackendDatabasePath(app.getPath("userData")),
      resolveLocalWorkspaceDir({ env: process.env }),
    );
  });
};

const createWindow = async (): Promise<void> => {
  const workspaceRoot = resolveLocalWorkspaceDir({ env: process.env });
  await ensureBackendServer(
    resolveDesktopBackendDatabasePath(app.getPath("userData")),
    workspaceRoot,
  );

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

  const workspaceService = createWorkspaceService();
  registerIpc(window, workspaceService);

  const workspaceWatcher = new LocalWorkspaceWatcher({
    workspaceDir: workspaceRoot,
    onEvent: (event) => {
      if (!window.isDestroyed()) {
        window.webContents.send(fileEventChannel, event);
      }
    },
  });
  workspaceWatcher.start();
  window.on("closed", () => {
    workspaceWatcher.stop();
  });

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
    if (backendServer) {
      backendServer.close();
      backendServer = null;
      backendUrl = null;
    }
    app.quit();
  }
});
