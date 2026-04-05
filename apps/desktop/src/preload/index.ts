import type {
  MagickDesktopApi,
  MagickDesktopFileApi,
} from "@magick/shared/localWorkspace";
import { contextBridge, ipcRenderer } from "electron";

const eventChannel = "magick-desktop:thread-event";
const fileEventChannel = "magick-desktop:file-event";

const api: MagickDesktopApi = {
  getWorkspaceBootstrap: () =>
    ipcRenderer.invoke("magick-desktop:getWorkspaceBootstrap"),
  openDocument: (documentId) =>
    ipcRenderer.invoke("magick-desktop:openDocument", documentId),
  saveDocument: (documentId, markdown) =>
    ipcRenderer.invoke("magick-desktop:saveDocument", documentId, markdown),
  sendThreadMessage: (threadId, body) =>
    ipcRenderer.invoke("magick-desktop:sendThreadMessage", threadId, body),
  toggleThreadResolved: (threadId) =>
    ipcRenderer.invoke("magick-desktop:toggleThreadResolved", threadId),
  onThreadEvent: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof listener>[0],
    ) => {
      listener(payload);
    };
    ipcRenderer.on(eventChannel, wrapped);
    return () => {
      ipcRenderer.off(eventChannel, wrapped);
    };
  },
};

const fileApi: MagickDesktopFileApi = {
  getFileWorkspaceBootstrap: () =>
    ipcRenderer.invoke("magick-desktop:getFileWorkspaceBootstrap"),
  openFile: (filePath) =>
    ipcRenderer.invoke("magick-desktop:openFile", filePath),
  saveFile: (filePath, markdown) =>
    ipcRenderer.invoke("magick-desktop:saveFile", filePath, markdown),
  createFile: (directoryPath) =>
    ipcRenderer.invoke("magick-desktop:createFile", directoryPath),
  createDirectory: (directoryPath) =>
    ipcRenderer.invoke("magick-desktop:createDirectory", directoryPath),
  renameFile: (filePath, nextName) =>
    ipcRenderer.invoke("magick-desktop:renameFile", filePath, nextName),
  renameDirectory: (directoryPath, nextName) =>
    ipcRenderer.invoke(
      "magick-desktop:renameDirectory",
      directoryPath,
      nextName,
    ),
  deleteFile: (filePath) =>
    ipcRenderer.invoke("magick-desktop:deleteFile", filePath),
  deleteDirectory: (directoryPath) =>
    ipcRenderer.invoke("magick-desktop:deleteDirectory", directoryPath),
  onWorkspaceEvent: (listener) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof listener>[0],
    ) => {
      listener(payload);
    };
    ipcRenderer.on(fileEventChannel, wrapped);
    return () => {
      ipcRenderer.off(fileEventChannel, wrapped);
    };
  },
};

const runtimeApi = {
  getBackendUrl: () => ipcRenderer.invoke("magick-desktop:getBackendUrl"),
};

contextBridge.exposeInMainWorld("magickDesktop", api);
contextBridge.exposeInMainWorld("magickDesktopFiles", fileApi);
contextBridge.exposeInMainWorld("magickDesktopRuntime", runtimeApi);
