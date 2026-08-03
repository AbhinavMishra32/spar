import { BrowserWindow, nativeTheme } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInfo } from "./build.js";
import { applyNativeSurface, planSurface, syncWindowControls } from "./surface.js";

export function createMainWindow() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  // Which translucent material the OS can give us, and the window options and
  // window-button placement that follow from it. See main/surface.ts.
  const plan = planSurface();
  const build = buildInfo();

  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1_020,
    minHeight: 660,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1b1b" : "#f9f9f8",
    // Spread last: the plan owns transparency, title-bar style and background,
    // and on a translucent platform it must override the opaque fill above.
    ...plan.options,
    webPreferences: {
      preload: path.join(dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // Read by the preload before first paint, so the renderer can reserve the
      // right edge for the window buttons without an IPC round trip. Build
      // identity rides along the same way: it cannot change while the window
      // is open, so a channel for it would only be a slower constant.
      additionalArguments: [
        `--spar-controls=${plan.controls}`,
        `--spar-surface=${plan.surface}`,
        `--spar-version=${build.version}`,
        `--spar-commit=${build.commit ?? ""}`,
        `--spar-branch=${build.branch ?? ""}`,
        `--spar-packaged=${build.packaged ? "1" : "0"}`,
      ],
    },
  });

  syncWindowControls(window, nativeTheme.shouldUseDarkColors);
  nativeTheme.on("updated", () => {
    if (!window.isDestroyed()) syncWindowControls(window, nativeTheme.shouldUseDarkColors);
  });

  // The glass view attaches to live web contents, and the renderer only learns
  // the real answer once any fallback has happened.
  window.webContents.once("did-finish-load", () => {
    void applyNativeSurface(window, plan).then((surface) => {
      if (!window.isDestroyed()) window.webContents.send("window:surface", surface);
    });
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
