import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, ipcMain, screen } from "electron";
import { ipc, type ArrivalEvent, type ArrivalPulse } from "../shared/api.js";

/* The one screen that reaches past its own window. While the onboarding runs, a
   transparent, click-through window covers the display the app is on, and the
   onboarding's few big moments (the mark landing, the notebook being signed,
   leaving) send a ring of the window's own dot grid out across the desktop.
   Between them it draws nothing at all.

   It follows focus: a ring only crosses the desktop while the Spar window is
   the one in front, so the effect never plays over someone's other work.

   It is purely decorative, so every failure is silent. Linux is left out: a
   transparent window there depends on the compositor, and an opaque sheet over
   someone's desktop is the one outcome worse than no effect at all. */

const SUPPORTED = process.platform === "darwin" || process.platform === "win32";
/** How long a ring already on its way gets to finish after the page asks to close. */
const FADE_MS = 1_200;

export function installArrivalOverlay(main: () => BrowserWindow | null) {
  let overlay: BrowserWindow | null = null;
  let closing: ReturnType<typeof setTimeout> | undefined;
  let detach: (() => void) | undefined;

  const send = (event: ArrivalEvent) => {
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send("arrival:event", event);
  };
  /** Screen coordinates, relative to the overlay's own origin. */
  const local = (x: number, y: number) => {
    const origin = overlay?.getBounds() ?? { x: 0, y: 0 };
    return { x: x - origin.x, y: y - origin.y };
  };
  /* The content rectangle rather than the frame: the grid is continued from the
     page's, which starts at the content's corner. Both title bar styles in use
     draw the page edge to edge, so the two rectangles are the same window. */
  const reportWindow = () => {
    const window = main();
    if (!window || window.isDestroyed()) return;
    const bounds = window.getContentBounds();
    send({ type: "window", ...local(bounds.x, bounds.y), width: bounds.width, height: bounds.height });
  };
  const reportFocus = () => {
    const window = main();
    send({ type: "focus", focused: Boolean(window && !window.isDestroyed() && window.isFocused()) });
  };
  const reportAll = () => {
    reportWindow();
    reportFocus();
  };

  const teardown = () => {
    clearTimeout(closing);
    detach?.();
    detach = undefined;
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
    overlay = null;
  };

  const open = () => {
    const window = main();
    if (!SUPPORTED || !window || window.isDestroyed()) return;
    clearTimeout(closing);
    if (overlay && !overlay.isDestroyed()) return reportAll();
    const display = screen.getDisplayMatching(window.getBounds());
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    overlay = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(dirname, "../preload/index.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    overlay.setIgnoreMouseEvents(true);
    overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    overlay.webContents.on("will-navigate", (event) => event.preventDefault());
    overlay.once("ready-to-show", () => {
      if (!overlay || overlay.isDestroyed()) return;
      /* Shown without focus, then the app raised back over it: the overlay sits
         just behind the window, over everything else. The renderer also leaves
         the window's rectangle clear, so a platform that ignores the ordering
         still never draws over the app itself. */
      overlay.showInactive();
      const app = main();
      if (app && !app.isDestroyed()) {
        app.moveTop();
        app.focus();
      }
      reportAll();
    });
    overlay.webContents.once("did-finish-load", reportAll);
    if (process.env.VITE_DEV_SERVER_URL) void overlay.loadURL(new URL("arrival.html", process.env.VITE_DEV_SERVER_URL).toString());
    else void overlay.loadFile(path.join(dirname, "../renderer/arrival.html"));

    /* Coming back to Spar raises its windows together, overlay included, so the
       ordering only has to be fixed up when the window itself is focused. */
    const focused = () => {
      reportFocus();
      if (overlay && !overlay.isDestroyed() && overlay.isVisible()) window.moveTop();
    };
    window.on("move", reportWindow);
    window.on("resize", reportWindow);
    window.on("focus", focused);
    window.on("blur", reportFocus);
    window.on("minimize", reportFocus);
    window.once("closed", teardown);
    detach = () => {
      if (window.isDestroyed()) return;
      window.off("move", reportWindow);
      window.off("resize", reportWindow);
      window.off("focus", focused);
      window.off("blur", reportFocus);
      window.off("minimize", reportFocus);
      window.off("closed", teardown);
    };
  };

  ipcMain.on(ipc.arrivalOpen, open);
  ipcMain.on(ipc.arrivalClose, () => {
    if (!overlay) return;
    // Let a ring already on its way finish before the layer goes.
    send({ type: "fade" });
    clearTimeout(closing);
    closing = setTimeout(teardown, FADE_MS);
  });
  ipcMain.on(ipc.arrivalPulse, (_event, value: ArrivalPulse) => {
    const window = main();
    if (!overlay || !window || window.isDestroyed()) return;
    if (typeof value?.x !== "number" || typeof value?.y !== "number") return;
    const content = window.getContentBounds();
    send({
      type: "pulse",
      ...local(content.x + value.x, content.y + value.y),
      strength: Math.max(0, Math.min(3, Number(value.strength) || 1)),
      kind: value.kind === "bloom" ? "bloom" : "ring",
    });
  });

  return { close: teardown };
}
