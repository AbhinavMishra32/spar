import { BrowserWindow, nativeTheme } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function createMainWindow() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const mac = process.platform === "darwin";
  // Vibrancy is macOS-only; on other platforms the key must be absent, not undefined.
  const translucency = mac ? { transparent: true, vibrancy: "sidebar" as const } : {};
  const window = new BrowserWindow({
    ...translucency,
    width: 1480,
    height: 940,
    minWidth: 1_020,
    minHeight: 660,
    show: false,
    titleBarStyle: "hiddenInset",
    // Sits the traffic lights on the sidebar's own top inset rather than a title bar.
    trafficLightPosition: { x: 14, y: 13 },
    // The sidebar is translucent, so the window itself must be too; the content
    // pane paints its own opaque fill on top.
    backgroundColor: mac ? "#00000000" : nativeTheme.shouldUseDarkColors ? "#1b1b1b" : "#f9f9f8",
    visualEffectState: "followWindow",
    webPreferences: {
      preload: path.join(dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else void window.loadFile(path.join(dirname, "../renderer/index.html"));

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("preload-error", (_event, preloadPath, error) => console.error(`Preload failed (${preloadPath}):`, error));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });

  return window;
}
