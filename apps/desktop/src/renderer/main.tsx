import React from "react";
import { createRoot } from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
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
import { CodeThemeProvider } from "./hooks/use-code-theme";
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
window.spar?.onNativeSurface((surface) => {
  document.documentElement.dataset.nativeSurface = surface;
});
// The themes read resolved CSS variables, so they are defined after the stylesheet applies.
defineEditorThemes(monaco);
loader.config({ monaco });

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Outermost, so a throw in a provider is caught too — those are exactly the
        crashes that would otherwise take the window down before anything is
        drawn, with nothing on screen to say why. */}
    <CrashBoundary>
      <MotionConfig reducedMotion="user">
        <CodeThemeProvider>
          <App />
          {window.spar && <UpdateExperience api={window.spar} />}
        </CodeThemeProvider>
      </MotionConfig>
    </CrashBoundary>
  </React.StrictMode>,
);
