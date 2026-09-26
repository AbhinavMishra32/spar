import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { BaselineState, Language } from "@spar/domain";
import type { SkillSummary, SparApi, ThemePreference } from "../shared/api";
import figuresSkill from "../../build/skills/challenge-figures/SKILL.md?raw";
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

/* Skills against an in-memory store, seeded from the real built-in file, so the
   Skills page can be clicked through. Every other method never settles, which
   leaves those rows in their loading state instead of throwing. */
function previewApi(): SparApi {
  const body = (source: string) => source.replace(/^---[\s\S]*?---\s*/, "");
  const describe = (source: string) => /description:\s*(.*)/.exec(source)?.[1] ?? "";
  const store = new Map<string, SkillSummary & { body: string }>([
    ["built-in:challenge-figures", { name: "challenge-figures", description: describe(figuresSkill), body: body(figuresSkill), source: "built-in", enabled: true, overridden: false, path: "/Spar.app/Contents/Resources/skills/challenge-figures/SKILL.md" }],
    ["user:interview-drills", { name: "interview-drills", description: "Run a timed mock interview: one problem, hints only on request, and a debrief on communication at the end.", body: "# Interview drills\n\nKeep the clock visible. Ask the learner to talk through their approach before coding.", source: "user", enabled: false, overridden: false, path: "~/skills/interview-drills/SKILL.md" }],
  ]);
  const list = () => [...store.values()].map(({ body: _body, ...rest }) => rest);
  const skills: Partial<SparApi> = {
    listSkills: async () => list(),
    readSkill: async (name) => [...store.values()].find((skill) => skill.name === name && !skill.overridden) ?? null,
    setSkillEnabled: async ({ name, enabled }) => { for (const skill of store.values()) if (skill.name === name) skill.enabled = enabled; },
    saveSkill: async (draft) => { const skill = { ...draft, source: "user" as const, enabled: true, overridden: false, path: `~/skills/${draft.name}/SKILL.md` }; if (draft.previous) store.delete(`user:${draft.previous}`); store.set(`user:${draft.name}`, skill); return skill; },
    removeSkill: async (name) => { store.delete(`user:${name}`); },
    customizeSkill: async (name) => { const original = store.get(`built-in:${name}`)!; original.overridden = true; const copy = { ...original, source: "user" as const, overridden: false }; store.set(`user:${name}`, copy); return copy; },
    importSkill: async () => null,
    revealSkills: async () => {},
  };
  return new Proxy(skills as SparApi, { get: (target, key) => (key in target ? target[key as keyof SparApi] : () => new Promise(() => {})) });
}
const api = previewApi();

function Preview() {
  const [theme, setTheme] = useState<ThemePreference>("light");
  const [language, setLanguage] = useState<Language>("python");

  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
      <div className="h-screen bg-background">
        <SettingsPage
          account={{ displayName: "Ada Lovelace", email: "ada@example.com" }}
          api={api}
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
