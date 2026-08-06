import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ChallengeHistorySummary, ConceptSummary, SessionSummary } from "@spar/domain";
import { SearchPalette } from "./components/common/SearchPalette";
import "./theme.css";

const sessions: SessionSummary[] = [
  {
    id: "s1",
    title: "Sliding windows, properly this time",
    originalGoal: "stop guessing at two-pointer bounds",
    objective: "Hold a window invariant across a shrink",
    status: "active",
    currentFocus: ["Restoring an invariant after a shrink"],
    completedQuestions: 2,
    activeQuestion: { id: "q1", title: "Longest substring without repeats", ordinal: 3 },
    questionTitles: [
      { id: "q0", title: "Minimum window substring", status: "completed" },
      { id: "qa", title: "Valid Parentheses", status: "completed" },
      { id: "q1", title: "Longest substring without repeats", status: "active" },
    ],
    totalSeconds: 5_400,
    updatedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    pinnedAt: null,
    archivedAt: null,
  },
  {
    id: "s2",
    title: "Interview prep",
    originalGoal: "get better at two pointers before Thursday",
    objective: "",
    status: "paused",
    currentFocus: [],
    completedQuestions: 0,
    activeQuestion: null,
    questionTitles: [],
    totalSeconds: 600,
    updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    pinnedAt: null,
    archivedAt: null,
  },
  {
    id: "s3",
    title: "C++ ranges",
    originalGoal: "learn views without allocating",
    objective: "Compose views over a vector",
    status: "completed",
    currentFocus: [],
    completedQuestions: 4,
    activeQuestion: null,
    questionTitles: [
      { id: "q2", title: "Views over a vector", status: "completed" },
    ],
    totalSeconds: 9_000,
    updatedAt: new Date(Date.now() - 11 * 86_400_000).toISOString(),
    pinnedAt: null,
    archivedAt: null,
  },
];

function challenge(over: Partial<ChallengeHistorySummary> & { id: string; title: string }): ChallengeHistorySummary {
  return {
    sessionId: "s1",
    sessionTitle: "Sliding windows, properly this time",
    ordinal: 1,
    language: "typescript",
    difficulty: "developing",
    status: "completed",
    replacesQuestionId: null,
    replacesQuestionTitle: null,
    replacedByQuestionId: null,
    replacedByQuestionTitle: null,
    attemptCount: 2,
    testRunCount: 5,
    lastOutcome: "passed",
    concepts: [],
    source: null,
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    ...over,
  };
}

const challenges: ChallengeHistorySummary[] = [
  challenge({ id: "c1", title: "Longest substring without repeating characters" }),
  challenge({
    id: "c2",
    title: "Two Sum",
    sessionTitle: "Interview prep",
    updatedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    source: {
      source: "leetcode",
      region: "global",
      slug: "two-sum",
      externalId: "1",
      displayId: "1",
      url: "https://leetcode.com/problems/two-sum/",
      difficulty: "easy",
      languageSlug: "typescript",
      remoteJudge: true,
      localCaseCount: 2,
      judge: "LeetCode grades this one.",
      entryName: "twoSum",
      cases: [],
      references: [],
    },
  }),
  challenge({ id: "c3", title: "Views over a vector", language: "cpp", sessionTitle: "C++ ranges" }),
];

function concept(over: Partial<ConceptSummary> & { slug: string; title: string }): ConceptSummary {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    kind: "dsa",
    description: "",
    parentSlug: null,
    parentTitle: null,
    childSlugs: [],
    challengeCount: 3,
    passedCount: 2,
    failedCount: 1,
    abandonedCount: 0,
    openCount: 0,
    attemptCount: 6,
    testRunCount: 12,
    replacedCount: 0,
    abilityCount: 1,
    firstSeenAt: null,
    lastSeenAt: null,
    ...over,
  };
}

const concepts: ConceptSummary[] = [
  concept({ slug: "sliding-window", title: "Sliding window", parentSlug: "arrays", parentTitle: "Arrays & strings", challengeCount: 7 }),
  concept({ slug: "two-pointers", title: "Two pointers", parentSlug: "arrays", parentTitle: "Arrays & strings", challengeCount: 4 }),
  concept({ slug: "ownership", title: "Ownership and lifetimes", kind: "engineering", challengeCount: 1 }),
];

function Preview() {
  const [open, setOpen] = useState(true);
  return (
    <div className="min-h-screen bg-background">
      <button className="m-6 rounded-lg border border-border px-3 py-1.5 text-content" onClick={() => setOpen(true)} type="button">
        Open search
      </button>
      <SearchPalette
        challenges={challenges}
        concepts={concepts}
        onNewSession={() => console.log("new session")}
        onOpenChallenge={(id) => console.log("challenge", id)}
        onOpenChange={setOpen}
        onOpenConcept={(slug) => console.log("concept", slug)}
        onOpenSession={(session) => console.log("session", session.id)}
        onPage={(page) => console.log("page", page)}
        open={open}
        sessions={sessions}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
