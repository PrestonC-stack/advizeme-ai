import path from "node:path";
import { app, BrowserWindow, ipcMain, Notification } from "electron";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

const createMainWindow = async () => {
  const mainWindow = new BrowserWindow({
    width: 420,
    height: 920,
    minWidth: 380,
    minHeight: 700,
    title: "AdvizeMe.ai Pilot",
    autoHideMenuBar: true,
    backgroundColor: "#0b1220",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }
};

app.whenReady().then(() => {
  ipcMain.handle("desktop:notify", async (_event, payload: { title: string; body: string }) => {
    if (Notification.isSupported()) {
      new Notification({
        title: payload.title,
        body: payload.body
      }).show();
    }
    return { ok: true };
  });

  ipcMain.handle("desktop:get-version", async () => app.getVersion());

  void createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
