import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("advizeMeDesktop", {
  notify: (title: string, body: string) =>
    ipcRenderer.invoke("desktop:notify", { title, body }),
  getVersion: () => ipcRenderer.invoke("desktop:get-version")
});
