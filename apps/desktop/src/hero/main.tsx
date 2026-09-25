import { createRoot, type Root } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { CodeThemeProvider } from "@/hooks/use-code-theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createBridge, expandStates, type Recording } from "./bridge";
import { Cancelled, installClock } from "./clock";
import { createCursor } from "./cursor";
import { direct } from "./director";
import { inertInput } from "./inert";
import recordingJson from "./recording.json";
import "./styles.css";
import "./hero.css";

/**
 * Spar's renderer, playing a recorded session.
 *
 * This is the app's own `App`, not a picture of it: the same components, the
 * same stylesheet, the same run reducer drawing the same stream. What changes is
 * everything outside the renderer. The Electron bridge is answered from
 * `recording.json`, `Date` runs on the recording's clock, Monaco is swapped for
 * a static drawing of itself, and a scripted cursor stands in for the learner.
 * The page takes no input; the landing page frames it and scales it.
 */

inertInput();

const recording = expandStates(recordingJson as unknown as Recording);
const clock = installClock(recording.clock.open);
const bridge = createBridge(recording, clock);
window.spar = bridge.api;

const html = document.documentElement;
html.classList.add("dark");
/* As on macOS: the shell is a tint over whatever is behind the window. Framed
   on the landing page, what is behind it is the page's dot field, blurred by
   the frame the way the OS blurs a desktop. */
html.dataset.nativeSurface = "vibrancy";
if (window.top === window) html.classList.add("is-standalone");
html.dataset.windowControls = "left";
html.dataset.platform = "darwin";

/* Imported only once the bridge exists: the app reads `window.spar` at module
   scope, exactly as it does behind the preload. */
const { App } = await import("@/App");

const stage = document.getElementById("root")!;
const cursor = createCursor(document.body);
let root: Root | null = null;

async function play() {
  for (;;) {
    const controller = new AbortController();
    clock.reset(recording.clock.open);
    bridge.reset();
    /* Both challenges announce themselves every time round. */
    try { localStorage.removeItem("spar.intro.seen"); } catch { /* see introSeen */ }
    root?.unmount();
    root = createRoot(stage);
    root.render(
      <MotionConfig reducedMotion="never">
        <CodeThemeProvider>
          <TooltipProvider delayDuration={150} skipDelayDuration={300}>
            <App />
          </TooltipProvider>
        </CodeThemeProvider>
      </MotionConfig>,
    );
    html.classList.remove("is-ending");
    announceReady();
    try {
      await direct({ recording, clock, cursor, shift: bridge.shift, signal: controller.signal });
    } catch (error) {
      if (!(error instanceof Cancelled)) console.error(error);
    }
    controller.abort();
    html.classList.add("is-ending");
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

/** Tells the frame there is a window to show, once the app has drawn one. */
let announced = false;
function announceReady() {
  if (announced || window.parent === window) return;
  announced = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.parent.postMessage({ type: "spar-hero", state: "ready" }, window.location.origin);
  }));
}

void play();
