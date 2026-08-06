import { BrowserWindow, nativeTheme, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInfo } from "./build.js";
import { applyNativeSurface, planSurface, syncWindowControls } from "./surface.js";

/** How far into Spar this window has got. The window is sized to what it is
 *  actually showing: one column of controls, one card of questions, or the app.
 *
 *  "restoring" is an account being pulled back down from the cloud, and it takes
 *  the app's size rather than a size of its own. Almost every device that reaches
 *  it belongs to a learner who has done this before, so opening at the app's size
 *  is right in the ordinary case and the exception — a genuinely new account —
 *  resizes to the intake once the manifest says so. The alternative, opening
 *  small and growing, would make the app appear to correct itself in front of
 *  everyone who has ever signed in twice. */
export type WindowStage = "sign-in" | "onboarding" | "app" | "restoring";

/* Sign-in is one column about four hundred pixels wide, and a fifteen-hundred
   pixel window around it is a large empty rectangle with a small form marooned in
   the middle. The intake is a card and a list of options, so it wants room to
   read but not a workspace. Only the app itself earns the whole screen. */
const SIZE: Record<Exclude<WindowStage, "app" | "restoring">, { width: number; height: number }> = {
  "sign-in": { width: 460, height: 640 },
  onboarding: { width: 720, height: 780 },
};
/** Low enough not to fight either of the sizes above; restored the moment there
 *  is an app behind the window again. */
const SMALL_MINIMUM = { width: 380, height: 560 };
const WORKING = { width: 1480, height: 940 };
const WORKING_MINIMUM = { width: 1020, height: 660 };
/** Stages that get the workspace's size. Restoring is one of them: it is the app
 *  arriving, not a step on the way in, and sizing it like the intake would make
 *  every ordinary sign-in on a new machine look like a window correcting itself. */
const fillsScreen = (stage: WindowStage): stage is "app" | "restoring" => stage === "app" || stage === "restoring";

export function createMainWindow({ stage }: { stage: WindowStage }) {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  // Which translucent material the OS can give us, and the window options and
  // window-button placement that follow from it. See main/surface.ts.
  const plan = planSurface();
  const build = buildInfo();

  const window = new BrowserWindow({
    /* Opened at whichever size the first screen wants, rather than opened large
       and resized once the renderer reports in: a window that visibly shrinks on
       launch looks like a bug in the app, not like a decision. */
    ...(fillsScreen(stage) ? WORKING : SIZE[stage]),
    ...(fillsScreen(stage)
      ? { minWidth: WORKING_MINIMUM.width, minHeight: WORKING_MINIMUM.height }
      : { minWidth: SMALL_MINIMUM.width, minHeight: SMALL_MINIMUM.height }),
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

/** Moves the window to the size the stage it has reached wants, animated.
 *
 *  Signing in is not the moment Spar becomes a workspace — finishing the intake
 *  is. So signing in grows the window by a card's worth, enough to hold the
 *  questions, and only the finished profile opens it out to fill the screen.
 *  Signing out returns it, because the alternative is a full screen of emptiness
 *  around two fields.
 *
 *  The minimum is moved first in both directions. It is a floor, so a window
 *  cannot be made smaller than a minimum that has not been lowered yet, and
 *  raising it before growing would drag the window along with it. */
export function fitWindowTo(window: BrowserWindow | null, stage: WindowStage) {
  if (!window || window.isDestroyed() || window.isFullScreen()) return;
  const { workArea } = screen.getDisplayMatching(window.getBounds());
  if (fillsScreen(stage)) {
    window.setMinimumSize(WORKING_MINIMUM.width, WORKING_MINIMUM.height);
    if (window.isMaximized()) return;
    /* The work area, not the display: the menu bar and the Dock are not ours to
       cover, and this is deliberately not `maximize()` — that is a state the
       green button toggles, and being put into it by finishing an intake is a
       surprise the learner then has to undo. */
    window.setBounds(workArea, true);
    return;
  }
  window.setMinimumSize(SMALL_MINIMUM.width, SMALL_MINIMUM.height);
  const { width, height } = SIZE[stage];
  window.setBounds(
    {
      width: Math.min(width, workArea.width),
      height: Math.min(height, workArea.height),
      x: Math.round(workArea.x + (workArea.width - Math.min(width, workArea.width)) / 2),
      y: Math.round(workArea.y + (workArea.height - Math.min(height, workArea.height)) / 2),
    },
    true,
  );
}
