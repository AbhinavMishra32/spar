import { createRoot } from "react-dom/client";
import { DEFAULT_CHALLENGE_MIX, type SessionSummary } from "@spar/domain";
import type { SparApi } from "../shared/api";
import { ChallengeMixMenu } from "./components/workspace/ChallengeMixMenu";
import { TooltipProvider } from "./components/ui/tooltip";
import "./theme.css";

/* A harness for the challenge toolbar's coaching settings, without Electron.
   Not shipped; here for the same reason harness.html is. */

if (new URLSearchParams(location.search).get("theme") === "dark") document.documentElement.classList.add("dark");

const session = {
  id: "00000000-0000-4000-8000-000000000001", trackId: null, context: "training", title: "Trees", originalGoal: "Trees", objective: "",
  status: "active", currentFocus: [], completedQuestions: 6, activeQuestion: null, questionTitles: [], totalSeconds: 0,
  updatedAt: new Date().toISOString(), pinnedAt: null, archivedAt: null,
  problemSources: ["spar", "leetcode", "codeforces"],
  challengeMix: {
    ...DEFAULT_CHALLENGE_MIX,
    sparUse: "struggling",
    lenses: [{ id: "lang-idioms", depth: "teach", example: { before: "for i in range(len(xs))", after: "for i, x in enumerate(xs)" } }, { id: "from-scratch", depth: "drill" }],
    suggestions: [{ id: "lang-stdlib", reason: "You hand-rolled a heap twice — the standard library does it in one line.", example: { before: "sift_up(h, len(h) - 1)", after: "heapq.heappush(h, x)" } }],
  },
} as SessionSummary;

const api = {
  practiceSources: async () => [{ source: "leetcode", state: "connected" }, { source: "codeforces", state: "disconnected" }],
  onPracticeSourceEvent: () => () => {},
  setSessionProblemSources: async (input: { sources: unknown }) => { console.log("sources", input.sources); return input.sources; },
  setSessionChallengeMix: async (input: { mix: unknown }) => { console.log("mix", JSON.stringify(input.mix)); return input.mix; },
} as unknown as SparApi;

createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="flex h-10 items-center justify-end gap-2 rounded-lg px-3">
        <span className="mr-auto text-content font-medium">Challenge 7 of 7</span>
        <ChallengeMixMenu api={api} language="python" onConnect={() => console.log("connect")} onChanged={() => console.log("changed")} onError={(error) => console.error(error)} session={session} />
        <span className="text-ui text-muted-foreground">25m 20s</span>
      </div>
    </div>
  </TooltipProvider>,
);
