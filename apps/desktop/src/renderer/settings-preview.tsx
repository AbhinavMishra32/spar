import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { BaselineState, Language } from "@spar/domain";
import type { ThemePreference } from "../shared/api";
import { SettingsPage } from "./components/pages/SettingsPage";
import { TooltipProvider } from "./components/ui/tooltip";
import "./theme.css";

/* A harness for looking at Settings in a browser, without Electron or an
   account. Every row here guards on a missing API, so passing none is enough to
   see the shell, the sidebar, the cards and the section rail — which is the
   part of this page that is worth looking at rather than clicking. Not shipped;
   it is here for the same reason harness.html is. */

const baseline: BaselineState = {
  status: "complete",
  sessionId: null,
  completedAt: null,
  confidence: 0.82,
  directEvidenceCount: 14,
  importedEvidenceCount: 0,
};

function Preview() {
  const [theme, setTheme] = useState<ThemePreference>("light");
  const [language, setLanguage] = useState<Language>("python");

  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
      <div className="h-screen bg-background">
        <SettingsPage
          api={undefined}
          baseline={baseline}
          language={language}
          onBaseline={() => {}}
          onLanguageChange={setLanguage}
          onSignedOut={async () => {}}
          onThemeChange={async (next) => {
            setTheme(next);
            document.documentElement.classList.toggle("dark", next === "dark");
          }}
          theme={theme}
        />
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
