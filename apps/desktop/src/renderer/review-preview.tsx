import { createRoot } from "react-dom/client";
import { useState } from "react";
import type { ReviewCard, ReviewOverview, ReviewPending } from "@spar/domain";
import { ChallengesPage } from "./components/pages/ChallengesPage";
import { ToolRow } from "./components/agent/ActivityRow";
import { TrackPage } from "./components/pages/TrackPage";
import "./theme.css";

/* A harness for the spaced-review page and the thread's filed-insight view,
   without Electron or a model. Not shipped; here for the same reason
   harness.html is. */

if (new URLSearchParams(location.search).get("theme") !== "light") document.documentElement.classList.add("dark");

const DAY = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset * DAY).toISOString();

const base: Omit<ReviewCard, "id" | "questionId" | "title" | "questionTitle" | "dueAt"> = {
  sessionId: "00000000-0000-4000-8000-000000000001", attemptId: null,
  trigger: "Longest contiguous run under a constraint",
  insight: "Grow the right edge every step; move the left edge only while the window breaks the constraint.",
  invariant: "After the inner loop the window is always valid, so its length is a candidate answer.",
  click: { summary: "Replaced the restart-from-scratch scan with a left pointer that only moves forward (run 4).", runOrdinal: 4, diff: "-  for (let start = 0; start < n; start++) {\n+  let left = 0;\n+  for (let right = 0; right < n; right++) {\n+    while (count(left, right) > k) left++;" },
  independence: "independent",
  pitfalls: [{ mistake: "Reset the window on every violation", fix: "advance the left edge instead" }, { mistake: "Updated the best length before shrinking", fix: "shrink first, then measure" }],
  rubric: ["two pointers", "left only moves forward", "O(n)"], transfer: ["Longest substring without repeats", "Max consecutive ones with k flips"],
  concepts: [{ slug: "sliding-window", title: "Sliding window", role: "primary" } as never], targets: ["turning-point", "pattern"],
  state: "review", stability: 3.2, difficulty: 5.1, lastReviewAt: iso(-4), reps: 2, lapses: 0, retrievability: 0.81, suspended: false, version: 1, createdAt: iso(-9), updatedAt: iso(-4),
};
const cards: ReviewCard[] = [
  { ...base, id: "00000000-0000-4000-8000-00000000000a", questionId: "q1", title: "Shrink the window from the left", questionTitle: "Longest calm stretch", dueAt: iso(-1) },
  { ...base, id: "00000000-0000-4000-8000-00000000000b", questionId: "q2", title: "Monotonic stack for next greater", questionTitle: "Next warmer day", dueAt: iso(-0.1), retrievability: 0.88, concepts: [] },
  { ...base, id: "00000000-0000-4000-8000-00000000000c", questionId: "q3", title: "Prefix sums turn ranges into subtraction", questionTitle: "Range totals", dueAt: iso(6), retrievability: 0.97, reps: 4, stability: 11 },
];
const overview = (due: number): ReviewOverview => ({
  totalCards: 3, dueCount: due, dueTodayCount: due, retention: 0.87, nextDueAt: iso(due ? -1 : 6),
  upcoming: Array.from({ length: 14 }, (_, index) => ({ date: new Date(Date.now() + index * DAY).toISOString().slice(0, 10), count: index === 0 ? due : index === 6 ? 1 : index === 3 ? 2 : 0 })),
  reviewedToday: 3 - due - 1 < 0 ? 0 : 3 - due - 1, streakDays: 4, byQuestion: {},
});
let due = cards.slice(0, 2);
const pending = (card: ReviewCard): ReviewPending => ({
  id: "00000000-0000-4000-8000-0000000000f1", cardId: card.id, createdAt: new Date().toISOString(), format: "recognize", target: "pattern",
  prompt: "What's the recipe for a **fixed-size sliding window** over an array?",
  cue: "What should happen to the stretch the moment it breaks the rule?",
});
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const api = {
  reviewQueue: async () => ({ due, cards, overview: overview(due.length) }),
  readReviewCard: async (id: string) => ({ card: cards.find((card) => card.id === id)!, logs: [
    { id: "l1", cardId: id, reviewedAt: iso(-9), source: "solve", format: null, rating: 3, suggestedRating: null, prompt: null, answer: null, feedback: "Filed on solve", elapsedDays: 0, scheduledDays: 2, retrievability: 1, stabilityBefore: 0, stabilityAfter: 2.3, difficultyAfter: 5 },
    { id: "l2", cardId: id, reviewedAt: iso(-4), source: "recall", format: "invariant", rating: 3, suggestedRating: 3, prompt: "State the invariant the window keeps.", answer: "It is always valid after shrinking.", feedback: "Right — and that is why its length is a candidate.", elapsedDays: 5, scheduledDays: 3.4, retrievability: 0.85, stabilityBefore: 2.3, stabilityAfter: 3.2, difficultyAfter: 5.1 },
  ], intervals: { again: { days: 1, dueAt: iso(1) }, hard: { days: 4, dueAt: iso(4) }, good: { days: 9, dueAt: iso(9) }, easy: { days: 16, dueAt: iso(16) } } }),
  startReview: async ({ cardId, target }: { cardId: string; target?: ReviewPending["target"] }) => { await wait(700); return { ...pending(cards.find((card) => card.id === cardId)!), ...(target ? { target } : {}) }; },
  setReviewTargets: async ({ cardId, targets }: { cardId: string; targets: ReviewCard["targets"] }) => { const card = cards.find((entry) => entry.id === cardId)!; card.targets = targets; return card; },
  revealReviewCue: async () => pending(cards[0]!).cue,
  revealReviewAnswer: async () => { await wait(150); return { answer: "1. Total the first `k` items — that's the first candidate.\n2. For each next item: add it, subtract the one `k` back, compare.\n3. Start `best` from the first window, not `0`.", intervals: { again: { days: 1, dueAt: iso(1) }, hard: { days: 3, dueAt: iso(3) }, good: { days: 8, dueAt: iso(8) }, easy: { days: 19, dueAt: iso(19) } } }; },
  abandonReview: async () => undefined,
  listChallengePreviews: async () => ({}),
  answerReview: async () => {
    await wait(800);
    return {
      pendingId: "p", cardId: due[0]!.id, card: due[0]!, suggestedRating: 3, capReason: null,
      intervals: { again: { days: 1, dueAt: iso(1) }, hard: { days: 5, dueAt: iso(5) }, good: { days: 11, dueAt: iso(11) }, easy: { days: 21, dueAt: iso(21) } },
      grade: { verdict: "partial", rating: 2, hits: ["add the new item, drop the old"], misses: ["start best from the first window"], feedback: "Right slide — but starting best at 0 breaks when every sum is negative.", misconception: null },
    };
  },
  commitReview: async () => { due = due.slice(1); return { overview: overview(due.length) }; },
  suspendReview: async () => undefined,
};

(window as unknown as { spar: unknown }).spar = { setReviewTargets: api.setReviewTargets };

function Harness() {
  const [error, setError] = useState("");
  /* ?sources: the Track page, for its New session dialog. */
  if (new URLSearchParams(location.search).has("sources")) {
    return <div className="h-screen bg-background"><TrackPage api={api as never} busy={false} challenges={[]} onCreate={async () => {}} onOpen={() => {}} runs={{} as never} sessions={[]} track={{ id: "t", title: "Learn binary tree from basics", goal: "learn binary tree from basics" } as never} /></div>;
  }
  return (
    <div className="min-h-screen bg-background">
      {error && <p className="p-2 text-destructive">{error}</p>}
      <div className={new URLSearchParams(location.search).has("tool") ? "hidden" : "h-[720px]"}>
        <ChallengesPage
          api={api as never}
          challenges={cards.map((card, index) => ({ id: card.questionId, title: card.questionTitle, sessionTitle: "Sliding windows", sessionId: card.sessionId, language: "python", difficulty: "developing", status: "completed", lastOutcome: "passed", testRunCount: 4 + index, attemptCount: 1, updatedAt: iso(-index - 1), concepts: [], source: null, replacesQuestionId: null, replacedByQuestionId: null, replacesQuestionTitle: null, replacedByQuestionTitle: null, assistance: "independent" }) as never)}
          concepts={[]}
          onError={setError}
          onOpen={() => {}}
          onOpenConcept={() => {}}
          onResolve={(id, review, rest) => setError(`resolve ${id} card=${review.cardId} rest=${rest.length}`)}
          onReviewsChanged={() => {}}
          reviews={{ ...overview(due.length), byQuestion: Object.fromEntries(cards.map((card) => [card.questionId, { cardId: card.id, title: card.title, state: card.state, dueAt: card.dueAt, lastReviewAt: card.lastReviewAt, reps: card.reps, lapses: card.lapses, retrievability: card.retrievability, createdAt: card.createdAt, suspended: card.suspended }])) }}
        />
      </div>
      <div className="mx-auto mt-8 max-w-[40rem] px-4 text-thread">
        <ToolRow
          part={{
            kind: "tool", id: "insight", tool: "record_insight", label: "record_insight", actionTitle: "", detail: "First review in 1 day", phase: "done", files: [], stages: [], startedAt: Date.now() - 900, endedAt: Date.now(),
            input: JSON.stringify({
              title: "Replace the outgoing item with the incoming item",
              trigger: "When a problem asks for an aggregate over every contiguous block of the same length and neighboring blocks overlap heavily, consider whether one departing item and one arriving item can update the aggregate.",
              insight: "Adjacent fixed-size windows share all but one item. Keep the aggregate for the current window, remove the value at the old left edge, and add the value just beyond the old right edge. Build and evaluate a complete initial window first.",
              invariant: "Before evaluating a window, the running sum equals the sum of exactly the k elements currently inside it; the maximum records the greatest sum among complete windows evaluated so far.",
              click: { summary: "After several failed runs, the final edit moved the maximum comparison outside the initialization loop, so it compared the completed first window rather than partial sums.", diff: "-        max_sum = max(max_sum, w_sum)\n+\n+    max_sum = max(max_sum, w_sum)" },
              independence: "assisted",
              pitfalls: [{ mistake: "Updated the maximum while accumulating the first window, allowing a partial sum to count as a candidate", fix: "Compare the maximum only after all k elements of the initial window have been added." }, { mistake: "Started the slide at index k - 1", fix: "The first new item is at index k." }],
              transfer: ["fixed-size window averages", "rolling hash", "k-length substring counts"],
            }),
            output: JSON.stringify({ status: "filed", cardId: "00000000-0000-4000-8000-00000000000a", targets: ["turning-point", "pattern", "pitfall"], created: true, firstReviewInDays: 1, dueAt: iso(1), related: [] }),
          }}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
