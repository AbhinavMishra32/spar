import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SolveRead } from "@/components/agent/ActivityRow";
import { foldAttempt, formatSolveLog, type ReplayEvent } from "../shared/attemptReplay";
import "./theme.css";

const START = Date.parse("2026-09-15T10:00:00.000Z");
let sequence = 0;
const event = (type: string, minutes: number, payload: Record<string, unknown> = {}, source = "learner"): ReplayEvent => {
  sequence += 1;
  return { id: `e${sequence}`, sequence: sequence - 1, type, occurredAt: new Date(START + minutes * 60_000).toISOString(), payload, source };
};
const names = ["empty list", "single value", "two equal values", "negatives", "large input", "duplicate keys", "unicode keys"];
const run = (minutes: number, scope: string, failing: string[]) => event("test_run", minutes, {
  scope,
  passed: failing.length === 0,
  passedCases: names.length - failing.length,
  failedCases: failing.length,
  durationMs: 1200 + minutes,
  cases: names.map((name) => failing.includes(name)
    ? { name, status: "failed", expected: "[1, 2]", actual: "[1]" }
    : { name, status: "passed" }),
}, "runner");

const events: ReplayEvent[] = [
  event("attempt_started", 0, { questionId: "q1" }, "system"),
  event("file_changed", 2, { path: "solution.py", bytes: 210 }),
  event("file_changed", 3, { path: "solution.py", bytes: 260 }),
  run(4, "visible", ["two equal values", "duplicate keys", "unicode keys"]),
  event("learner_remark", 5, { body: "the duplicate key case is confusing me" }),
  event("file_changed", 7, { path: "solution.py", bytes: 300 }),
  run(8, "visible", ["unicode keys"]),
  event("file_changed", 10, { path: "solution.py", bytes: 330 }),
  run(11, "visible", ["large input"]),
  event("submission_created", 12, { questionId: "q1" }),
  run(12, "visible-and-hidden", []),
  event("submission_evaluated", 12, { outcome: "passed", review: "clean" }, "system"),
  event("attempt_completed", 12, { outcome: "passed" }, "system"),
];

const replay = foldAttempt(events, { title: "Count Values at an Exact Frequency", language: "python" });
const solve = { path: "solution.py", text: "from collections import Counter\n\n\ndef count_exact(values, k):\n    counts = Counter(values)\n    return sum(1 for value in counts.values() if value == k)\n" };
const output = JSON.stringify({
  stats: replay.stats,
  filters: { sections: ["log", "cases", "runs", "timings"], events: [], cases: "all", scope: "all", caseDetail: "full", maxLines: 2000 },
  solve,
  files: [solve],
  report: formatSolveLog(replay, { sections: ["log", "cases", "runs", "timings"], maxLines: 2000 }),
}, null, 2);

const part = {
  kind: "tool" as const,
  id: "t1",
  tool: "read_attempt",
  label: "Read your attempt",
  actionTitle: "",
  detail: "12m on it · 4 runs · 7 cases followed",
  phase: "done" as const,
  files: [],
  input: JSON.stringify({ sections: ["log", "cases", "runs", "timings"], cases: "all", scope: "all", caseDetail: "full", maxLines: 2000 }, null, 2),
  output,
  startedAt: START,
  endedAt: START + 1000,
};

createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <div className="min-h-screen bg-background p-10">
      <div className="agent-transcript mx-auto max-w-[44rem] text-thread">
        <SolveRead part={part} />
      </div>
    </div>
  </TooltipProvider>,
);
