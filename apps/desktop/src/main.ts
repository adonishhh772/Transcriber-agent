import { app, BrowserWindow } from "electron";
import { join } from "path";

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "Transcriber – Live",
    backgroundColor: "#0b0c10",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(join(__dirname, "index.html"));
  // win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
