import { BrowserWindow, nativeTheme } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function createMainWindow() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const window = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1050, minHeight: 680, show: false,
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 18, y: 18 }, backgroundColor: nativeTheme.shouldUseDarkColors ? "#121314" : "#f7f7f5",
    webPreferences: { preload: path.join(dirname, "../preload/index.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
  });
  window.once("ready-to-show", () => window.show());
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(dirname, "../renderer/index.html"));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("preload-error", (_event, preloadPath, error) => console.error(`Preload failed (${preloadPath}):`, error));
  window.webContents.on("will-navigate", (event, url) => { if (url !== window.webContents.getURL()) event.preventDefault(); });
  return window;
}
