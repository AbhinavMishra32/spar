import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { Language } from "@spar/domain";
import type { ActivityReport, SkillSummary, SparApi, ThemePreference } from "../shared/api";
import figuresSkill from "../../build/skills/challenge-figures/SKILL.md?raw";
import { SettingsPage } from "./components/pages/SettingsPage";
import { TooltipProvider } from "./components/ui/tooltip";
import "./theme.css";

/* A harness for looking at Settings in a browser, without Electron or an
   account. Every row here guards on a missing API, so passing none is enough to
   see the shell, the sidebar, the cards and the section rail — which is the
   part of this page that is worth looking at rather than clicking. Not shipped;
   it is here for the same reason harness.html is. */

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
api.activityReport = async () => previewActivity();

/* A year of made-up practice with a shape to it: a quiet start, a LeetCode
   habit that forms in the spring, Codeforces on weekends, and Spar's own
   challenges throughout — enough to see every state a cell can be in. */
function previewActivity(): ActivityReport {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const titles: Record<string, string[]> = {
    leetcode: ["Two Sum", "Valid Parentheses", "Merge Intervals", "LRU Cache", "Top K Frequent Elements", "Course Schedule", "Word Ladder", "Trapping Rain Water"],
    codeforces: ["Watermelon", "Way Too Long Words", "Team", "Domino piling", "Bit++", "Petya and Strings"],
    spar: ["Restore the window", "Count value frequencies", "Meet in the middle", "Compact in place", "Group words by first letter"],
  };
  const difficulty: Record<string, string[]> = { leetcode: ["easy", "medium", "medium", "hard"], codeforces: ["easy", "medium", "hard"], spar: ["foundation", "developing", "proficient", "advanced"] };
  const report: ActivityReport = { solves: [], days: [] };
  const today = new Date();
  let id = 0;
  for (let back = 400; back >= 0; back -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const habit = back < 200 ? 0.72 : back < 300 ? 0.35 : 0.12;
    if (random() > habit) continue;
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    for (const source of ["spar", "leetcode", "codeforces"]) {
      const chance = source === "spar" ? 0.6 : source === "leetcode" ? (back < 220 ? 0.7 : 0.2) : weekend ? 0.55 : 0.08;
      if (random() > chance) continue;
      const worked = 1 + Math.floor(random() * 4);
      const solved = random() < 0.2 ? 0 : Math.min(worked, 1 + Math.floor(random() * 3));
      report.days.push({ day, source, worked, runs: worked * 3 });
      for (let n = 0; n < solved; n += 1) {
        const list = titles[source]!;
        const hour = 9 + Math.floor(random() * 14);
        report.solves.push({ day, at: new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour).toISOString(), questionId: `q${id++}`, title: list[Math.floor(random() * list.length)]!, source, difficulty: difficulty[source]![Math.floor(random() * difficulty[source]!.length)]!, displayId: source === "spar" ? null : String(1 + Math.floor(random() * 2000)) });
      }
    }
  }
  report.solves.sort((a, b) => a.at.localeCompare(b.at));
  return report;
}

function Preview() {
  const [theme, setTheme] = useState<ThemePreference>("light");
  const [language, setLanguage] = useState<Language>("python");

  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
      <div className="h-screen bg-background">
        <SettingsPage
          account={{ displayName: "Ada Lovelace", email: "ada@example.com" }}
          api={api}
          language={language}
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
