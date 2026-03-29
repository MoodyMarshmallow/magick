import type { MagickDesktopApi } from "@magick/shared/localWorkspace";
import { contextBridge, ipcRenderer } from "electron";

const eventChannel = "magick-desktop:thread-event";

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

contextBridge.exposeInMainWorld("magickDesktop", api);
