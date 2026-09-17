import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Composer } from "@/components/agent/Composer";
import { ChallengeComposerContext } from "@/components/agent/ChallengeCardMeta";
import { MentionProvider, type MentionSource } from "@/components/agent/Mentions";
import { MarkdownLinkProvider } from "@/components/agent/MarkdownLinks";
import { Markdown } from "@/components/agent/Markdown";
import { SubmissionPeek } from "@/components/agent/SubmissionCard";
import { SystemEvent } from "@/components/agent/SystemEvent";
import type { SubmissionRecord, SubmissionRow } from "../shared/submissions";
import "./theme.css";

/**
 * The reference surfaces, off a fixture.
 *
 * Every one of these is normally reached three navigations into a live session
 * with real solve history behind it, which makes them the hardest things in the
 * app to look at while changing them. Here they are all on one page.
 */

const names = ["empty list", "single value", "two equal values", "negatives", "large input", "duplicate keys", "unicode keys"];

const row = (id: string, ordinal: number, outcome: SubmissionRow["outcome"], passed: number, title = "Shrink the window until it is valid"): SubmissionRow => ({
  id, attemptId: "a1", questionId: "q1", ordinal, outcome, judge: "spar",
  status: outcome === "passed" ? "Accepted" : "exit 1",
  passedCases: passed, failedCases: names.length - passed, totalCases: names.length,
  durationMs: 120 + ordinal * 30, runtime: null, memory: null, url: null,
  submittedAt: new Date(Date.UTC(2026, 8, 15, 10, ordinal * 7)).toISOString(),
  challengeId: "q1", challengeTitle: title, challengeOrdinal: 4, language: "python",
  sessionId: "s1", sessionTitle: "Sliding windows", attemptOrdinal: 1,
});

const rows = [row("sub-1", 1, "failed", 4), row("sub-2", 2, "failed", 6), row("sub-3", 3, "passed", 7)];

const record = (id: string): SubmissionRecord => {
  const base = rows.find((item) => item.id === id) ?? rows[0]!;
  return {
    ...base,
    code: { path: "solution.py", text: "def longest_valid(values, limit):\n    left = 0\n    total = 0\n    best = 0\n    for right, value in enumerate(values):\n        total += value\n        while total > limit:\n            total -= values[left]\n            left += 1\n        best = max(best, right - left + 1)\n    return best\n", truncated: false },
    cases: names.map((name, index) => index < base.passedCases
      ? { name, status: "passed" as const }
      : { name, status: "failed" as const, input: "[4, 2, 9], limit=6", expected: "2", actual: "3" }),
    output: "",
  };
};

const contextStop = {
  id: "q9",
  ordinal: 9,
  title: "Find the Longest Segment With Limit",
  live: false,
  replaced: true,
  language: "python" as const,
  elapsedMs: 622_000,
  passedCases: 0,
  totalCases: 7,
  testRunCount: 0,
  outcome: "replaced" as const,
};

const source: MentionSource = {
  challenges: [
    { id: "q1", ordinal: 4, title: "Shrink the window until it is valid", language: "python", outcome: null, sessionId: "s1", sessionTitle: "Sliding windows", difficulty: "developing", elapsedMs: 622_000, passedCases: 6, totalCases: 7, testRunCount: 3, concepts: ["Sliding window", "Two pointers"] },
    { id: "q2", ordinal: 3, title: "Count distinct keys in one pass", language: "python", outcome: "passed", sessionId: "s1", sessionTitle: "Sliding windows", difficulty: "developing", elapsedMs: 340_000, passedCases: 9, totalCases: 9, testRunCount: 2, concepts: ["Hash maps"] },
    { id: "q3", ordinal: 2, title: "Merge two sorted rails", language: "python", outcome: "failed", sessionId: "s1", sessionTitle: "Sliding windows", difficulty: "foundation", elapsedMs: 180_000, passedCases: 3, totalCases: 8, testRunCount: 5, concepts: ["Two pointers"] },
    { id: "q4", ordinal: 1, title: "Reverse a linked list in place", language: "cpp", outcome: "passed", sessionId: "s0", sessionTitle: "Pointers", difficulty: "proficient", elapsedMs: 900_000, passedCases: 5, totalCases: 5, testRunCount: 1, concepts: ["Linked lists"] },
  ],
  concepts: [
    { slug: "arrays.sliding-window", title: "Sliding window", detail: "technique" },
    { slug: "hashing.maps", title: "Hash maps", detail: "structure" },
  ],
  sessionId: "s1",
  activeChallengeId: "q1",
  listSubmissions: () => Promise.resolve(rows),
  listSessionSubmissions: () => Promise.resolve([...rows].reverse()),
};

const REPLY = `Your first attempt read the whole array twice — see [[submission:sub-1|submission 1]]. By [[submission:sub-3|the third]] you were holding a running total, which is the idea. The problem itself is [[challenge:q1|Shrink the window until it is valid]].`;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-ui-sm font-medium tracking-[0.06em] text-muted-foreground/70">{title}</h2>
      <div className="rounded-xl border border-border bg-card p-4">{children}</div>
    </section>
  );
}

function Preview() {
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState("");
  return (
    <MarkdownLinkProvider value={{
      readSubmission: (id) => Promise.resolve(record(id)),
      onOpenSubmission: (id) => console.log("open submission", id),
      onOpenChallenge: (id) => console.log("open challenge", id),
      onOpenConcept: (slug) => console.log("open concept", slug),
    }}>
      <MentionProvider value={source}>
        <TooltipProvider>
          <div className="mx-auto flex max-w-2xl flex-col gap-8 p-10">
            <Panel title="SOLVED ATTEMPT">
              <SystemEvent body={'The learner solved attempt 6f121e42-0000-4000-8000-000000000000 — every visible and hidden test passes. This challenge required: "one pass", "constant extra space", "no sorting", "handles an empty input". Read their code'} />
            </Panel>

            <Panel title="AGENT REPLY WITH REFERENCES">
              <Markdown source={REPLY} />
            </Panel>

            <Panel title="SUBMISSION HOVER CARD">
              <SubmissionPeek submission={record("sub-2")} />
            </Panel>

            <Panel title="@ PICKER — type @ in the field">
              <Composer onChange={setDraft} onSubmit={() => setDraft("")} placeholder="Ask for a hint, or explain your approach…" value={draft} />
            </Panel>

            <Panel title="COMPOSER CONTEXT — the challenge a question is about">
              <Composer
                context={<ChallengeComposerContext onRemove={() => undefined} stop={contextStop} />}
                onChange={setAsking}
                onSubmit={() => setAsking("")}
                placeholder="Ask about Find the Longest Segment With Limit…"
                value={asking}
              />
            </Panel>
          </div>
        </TooltipProvider>
      </MentionProvider>
    </MarkdownLinkProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
