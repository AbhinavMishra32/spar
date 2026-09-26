import React from "react";
import { createRoot } from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
// `editor.api` is the bare core: no find, folding, suggest, hover, bracket
// matching, comment toggling or semantic tokens. The contributions are what make
// it an editor rather than a textarea with colours.
import "monaco-editor/esm/vs/editor/editor.all";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";
// The TypeScript language service supplies IntelliSense; colorization needs the
// Monarch grammars, which are separate entry points.
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { MotionConfig } from "motion/react";
import { App } from "./App";
import { UpdateExperience } from "./components/updates/UpdateExperience";
import { CrashBoundary } from "./components/common/CrashScreen";
import { defineEditorThemes } from "./lib/monaco-theme";
import { registerSemanticHighlighting } from "./lib/monaco-semantic";
import { applyCodeFont, getCodeFont, onCodeFontChange, primaryFamily } from "./lib/code-font";
import { CodeThemeProvider } from "./hooks/use-code-theme";
import { TooltipProvider } from "./components/ui/tooltip";
import "./theme.css";

window.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === "typescript" || label === "javascript" ? new TypeScriptWorker() : new EditorWorker();
  },
};

document.documentElement.classList.toggle("dark", matchMedia("(prefers-color-scheme: dark)").matches);

// Chrome the OS owns. Both land before first paint — the sidebar is a
// transparent hole over the native material, and it has to know on frame one
// whether there is a material back there and which edge the buttons occupy.
// The main process re-sends the surface once it knows whether Liquid Glass
// actually attached, since that can still fall back to plain vibrancy.
const chrome = window.spar?.chrome;
document.documentElement.dataset.nativeSurface = chrome?.surface ?? "none";
document.documentElement.dataset.windowControls = chrome?.controls ?? "left";
/* The host OS, for the handful of places where the *shape* of a control differs
   rather than its position: Windows draws plain rounded rectangles where macOS
   draws superellipses, and hairlines there have no half-pixel to land on. See
   the platform block in theme.css. */
document.documentElement.dataset.platform = chrome?.platform ?? "darwin";
window.spar?.onNativeSurface((surface) => {
  document.documentElement.dataset.nativeSurface = surface;
});
// The themes read resolved CSS variables, so they are defined after the stylesheet applies.
defineEditorThemes(monaco);
registerSemanticHighlighting(monaco);
loader.config({ monaco });
/* The code face goes onto the document before first paint. Monaco measures
   character widths with whatever face is ready, and the shipped fonts load a
   moment after the stylesheet, so a caret placed with the fallback's metrics
   would drift off the glyphs — it measures again once the face lands, and again
   whenever the choice changes. */
applyCodeFont();
const remeasure = () => void document.fonts.load(`13px ${primaryFamily(getCodeFont())}`).then(() => monaco.editor.remeasureFonts());
remeasure();
onCodeFontChange(remeasure);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Outermost, so a throw in a provider is caught too — those are exactly the
        crashes that would otherwise take the window down before anything is
        drawn, with nothing on screen to say why. */}
    <CrashBoundary>
      <MotionConfig reducedMotion="user">
        <CodeThemeProvider>
          {/* App-wide, because Radix keeps the shared open/close timing here:
              without it every tooltip in the tree throws, and with one per
              tooltip each would run its own delay. The timings are the ChatGPT
              app's: a short wait for the first, none for the next one the
              pointer walks onto. */}
          <TooltipProvider delayDuration={150} skipDelayDuration={300}>
            <App />
            {window.spar && <UpdateExperience api={window.spar} />}
          </TooltipProvider>
        </CodeThemeProvider>
      </MotionConfig>
    </CrashBoundary>
  </React.StrictMode>,
);
