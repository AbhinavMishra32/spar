import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { BootstrapData, SparApi } from "../shared/api";
import { HomePage } from "./components/pages/HomePage";
import { ConceptMap } from "./components/problems/ConceptMap";
import { SettingsPage } from "./components/pages/SettingsPage";
import "./theme.css";

/* A harness for the three surfaces that carry Spar's argument about the learner,
   in a browser and without a store behind them. Not shipped; same reason as
   auth-preview and harness.html. */

const now = new Date().toISOString();
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

/* Solved challenges, so Home's shelf has stones on it. */
const TOPICS = ["trees", "graphs", "strings", "arrays", "dynamic-programming", "hashing"];
const DIFFS = ["foundation", "developing", "proficient", "advanced", "developing", "foundation", "proficient"] as const;
const stones: any[] = Array.from({ length: 11 }, (_, index) => ({
  id: `stone-${index}`, ordinal: index + 1, title: `Challenge ${index + 1}`, difficulty: DIFFS[index % DIFFS.length],
  lastOutcome: "passed", updatedAt: ago(index * 30), concepts: [{ slug: TOPICS[index % TOPICS.length], parentSlug: null, title: TOPICS[index % TOPICS.length] }],
}));

const ability = (over: Partial<any>): any => ({
  abilityId: "a1", title: "Two-pointer invariants", proficiency: 0.7, confidence: 0.6,
  evidenceCount: 4, lastEvidenceAt: ago(20), trainingStatus: "monitoring", trend: "stable",
  currentBelief: "Holds the invariant when the window only grows.", nextVerification: "A problem where the window must shrink.",
  updatedAt: ago(20), ...over,
});

const progress: any = {
  /* The rating as the store now writes it: Glicko-2 on the Codeforces scale,
     with the deviation narrowing as results accumulate. The preview carries it so
     the chart's confidence band has something true to draw. */
  rating: { id: "r7", rating: 1476, deviation: 118, volatility: 0.059, provisional: true, reason: "Solved a 1500-rated Codeforces problem unaided.", occurredAt: ago(6) },
  ratingHistory: [
    { id: "r1", rating: 1500, deviation: 350, volatility: 0.06, provisional: true, reason: "Initial provisional rating", occurredAt: ago(320) },
    { id: "r2", rating: 1392, deviation: 271, volatility: 0.06, provisional: true, reason: "Gave up on Shrink until valid", occurredAt: ago(300) },
    { id: "r3", rating: 1448, deviation: 224, volatility: 0.06, provisional: true, reason: "Solved Meet in the middle", occurredAt: ago(232) },
    { id: "r4", rating: 1371, deviation: 189, volatility: 0.059, provisional: true, reason: "Gave up on Compact in place", occurredAt: ago(160) },
    { id: "r5", rating: 1416, deviation: 161, volatility: 0.059, provisional: true, reason: "Solved Hidden transit map with one hint", occurredAt: ago(90) },
    { id: "r6", rating: 1452, deviation: 137, volatility: 0.059, provisional: true, reason: "Solved Restore the window invariant", occurredAt: ago(40) },
    { id: "r7", rating: 1476, deviation: 118, volatility: 0.059, provisional: true, reason: "Solved a 1500-rated Codeforces problem unaided.", occurredAt: ago(6) },
  ],
  abilities: [
    ability({ abilityId: "a1", title: "Two-pointer invariants", proficiency: 0.82, confidence: 0.71, trend: "improving" }),
    ability({ abilityId: "a2", title: "Hash-map counting", proficiency: 0.88, confidence: 0.8, trend: "stable" }),
    ability({ abilityId: "a3", title: "Graph traversal with visited sets", proficiency: 0.44, confidence: 0.5, trainingStatus: "training", trend: "improving" }),
    ability({ abilityId: "a4", title: "Recurrence to bottom-up DP", proficiency: 0.3, confidence: 0.35, trainingStatus: "diagnosing", trend: "unknown" }),
    ability({ abilityId: "a5", title: "Amortised complexity argument", proficiency: 0.5, confidence: 0.2, trainingStatus: "unknown", trend: "unknown" }),
    ability({ abilityId: "a6", title: "Binary search on the answer", proficiency: 0.6, confidence: 0.3, trainingStatus: "unknown", trend: "declining" }),
  ],
  patterns: [
    { id: "p1", title: "Off-by-one on the shrinking edge", description: "Three separate window problems ended one element short. The growing edge is always right; the shrinking one is not.", abilityId: "a1", status: "pattern", evidenceCount: 3, lastObservedAt: ago(28), updatedAt: ago(28) },
    { id: "p2", title: "Reaches for recursion before the base case exists", description: "", abilityId: "a4", status: "hypothesis", evidenceCount: 2, lastObservedAt: ago(70), updatedAt: ago(70) },
  ],
  notices: [
    { id: "n1", title: "Graph traversal moved to active training", body: "Two failed attempts in a row on visited-set handling put this ahead of the DP work.", createdAt: ago(6) },
    { id: "n2", title: "Hash-map counting looks settled", body: "Four unaided passes. Spar will stop setting problems for it and check back in a fortnight.", createdAt: ago(30) },
  ],
};

const abilityLedger: any[] = [
  { id: "a1", title: "Two-pointer invariants", status: "independent", version: 3, evidenceCount: 4,
    summary: "You can hold two indices under a stated rule and move them without rescanning — and you can say what the rule is while you do it.",
    markdown: "## Notes", concepts: [{ slug: "two-pointers", title: "Two pointers", kind: "dsa" }], practice: [], earnedAt: ago(40), updatedAt: ago(20) },
  { id: "a2", title: "Hash-map counting", status: "independent", version: 2, evidenceCount: 5,
    summary: "You reach for a frequency map before a nested loop, and you know when the map is cheaper than sorting.",
    markdown: "", concepts: [{ slug: "hash-maps", title: "Hash maps", kind: "dsa" }], practice: [], earnedAt: ago(120), updatedAt: ago(60) },
  { id: "a3", title: "Graph traversal with visited sets", status: "developing", version: 1, evidenceCount: 2,
    summary: "You can write BFS from memory; the visited set is still going in after the first wrong answer rather than before.",
    markdown: "", concepts: [{ slug: "graphs", title: "Graphs", kind: "dsa" }], practice: [], earnedAt: null, updatedAt: ago(6) },
  { id: "a4", title: "Recurrence to bottom-up DP", status: "uncertain", version: 1, evidenceCount: 0,
    summary: "Spar set this as a target after the memoisation attempt stalled.",
    markdown: "", concepts: [{ slug: "dp", title: "Dynamic programming", kind: "dsa" }], practice: [], earnedAt: null, updatedAt: ago(70) },
];

/* A small subject tree with the shape the real one has: areas with sub-concepts
   under them, some carrying evidence and some never attempted. The slugs match
   the ones `abilityLedger` claims over, which is what produces the cross-links. */
const concept = (over: Partial<any>): any => ({
  id: "00000000-0000-0000-0000-000000000000", slug: "x", title: "X", kind: "dsa", description: "",
  parentSlug: null, parentTitle: null, childSlugs: [], challengeCount: 0, passedCount: 0, failedCount: 0,
  abandonedCount: 0, openCount: 0, attemptCount: 0, testRunCount: 0, replacedCount: 0, abilityCount: 0,
  firstSeenAt: null, lastSeenAt: null, ...over,
});

const conceptFixtures: any[] = [
  concept({ slug: "arrays", title: "Arrays", childSlugs: ["two-pointers", "hash-maps", "sliding-window"], challengeCount: 9, passedCount: 6, failedCount: 2, abandonedCount: 1, abilityCount: 2 }),
  concept({ slug: "two-pointers", title: "Two pointers", parentSlug: "arrays", parentTitle: "Arrays", challengeCount: 5, passedCount: 4, failedCount: 1, abilityCount: 1 }),
  concept({ slug: "hash-maps", title: "Hash maps", parentSlug: "arrays", parentTitle: "Arrays", challengeCount: 4, passedCount: 4, abilityCount: 1 }),
  concept({ slug: "sliding-window", title: "Sliding window", parentSlug: "arrays", parentTitle: "Arrays" }),
  concept({ slug: "graph-area", title: "Graphs", childSlugs: ["graphs", "shortest-paths"], challengeCount: 3, passedCount: 1, failedCount: 2, abilityCount: 1 }),
  concept({ slug: "graphs", title: "Traversal", parentSlug: "graph-area", parentTitle: "Graphs", challengeCount: 3, passedCount: 1, failedCount: 2, abilityCount: 1 }),
  concept({ slug: "shortest-paths", title: "Shortest paths", parentSlug: "graph-area", parentTitle: "Graphs" }),
  concept({ slug: "dp-area", title: "Dynamic programming", kind: "dsa", childSlugs: ["dp", "memoisation"], challengeCount: 1, failedCount: 1 }),
  concept({ slug: "dp", title: "Bottom-up DP", parentSlug: "dp-area", parentTitle: "Dynamic programming", challengeCount: 1, failedCount: 1 }),
  concept({ slug: "memoisation", title: "Memoisation", parentSlug: "dp-area", parentTitle: "Dynamic programming" }),
  concept({ slug: "testing", title: "Testing", kind: "craft", childSlugs: ["unit-tests"], challengeCount: 2, passedCount: 2 }),
  concept({ slug: "unit-tests", title: "Unit tests", kind: "craft", parentSlug: "testing", parentTitle: "Testing", challengeCount: 2, passedCount: 2 }),
];

const data: BootstrapData = {
  account: { id: "u1", displayName: "A", email: "a@example.com" },
  profile: { language: "python" } as any,
  sessions: [{ id: "s1", activeQuestion: null } as any],
  saved: [],
  challenges: [], abilities: [], concepts: conceptFixtures, tracks: [], activeTrack: null,
  recommendation: {
    id: "rec1", trackId: "t1", trackTitle: "Graph fundamentals", sessionId: "s1", questionId: null,
    challengeTitle: "Number of Islands", abilityId: "a3", abilityTitle: "Graph traversal with visited sets",
    intent: "diagnose", source: "leetcode",
    reason: "You have passed two grid problems by scanning, and failed the one that needed a visited set. This is the smallest problem that cannot be solved the first way.",
    reasoning: [
      "The last two failures were both on revisiting a cell you had already cleared.",
      "Your hash-map counting is strong enough that the bookkeeping will not be what trips you up.",
      "A diagnose problem now is cheaper than another week of DP work built on a shaky traversal.",
    ],
    mode: { kind: "recommended" }, createdAt: now,
  } as any,
  progress, trackProgress: {}, baseline: { status: "complete", confidence: 0.6, directEvidenceCount: 4, importedEvidenceCount: 0, completedAt: ago(300), sessionId: null },
  reviews: { totalCards: 0, dueCount: 0, dueTodayCount: 0, retention: null, nextDueAt: null, upcoming: [], reviewedToday: 0, streakDays: 0, byQuestion: {} },
  trainingMode: { kind: "recommended" }, theme: "dark", syncState: "synced", restore: "done", serverConfigured: true,
};

(window as any).spar = {
  build: { version: "0.4.0", packaged: false },
  onProviderOAuthEvent: () => () => {},
  updateState: async () => ({ status: "current", currentVersion: "0.4.0" }),
  onUpdateState: () => () => {},
};

const api = {
  onProviderOAuthEvent: () => () => {},
  onUpdateState: () => () => {},
  onPracticeSourceEvent: () => () => {},
  async practiceSources() { return [{ source: "leetcode", state: "connected" }] as any; },
  async updateState() { return { status: "current", currentVersion: "0.4.0" } as any; },
  async listProviders() { return { providers: [{ id: "chatgpt", label: "ChatGPT", kind: "subscription", models: [{ id: "gpt-5.6", label: "GPT-5.6 Luna" }], model: "gpt-5.6", connected: true, isDefault: true }], defaultProvider: "chatgpt" } as any; },
  async providerUsage() { return [] as any; },
  async providerAccount() { return null; },
  async learningEngine() { return { state: null } as any; },
  async webSearchStatus() { return { enabled: true, hasKey: true } as any; },
  async setDefaultProvider() {},
  async setPreferredLanguage() {},
  async disconnectProvider() {},
  async signOut() {},
  async deleteAccount() {},
  async readAbility() {
    return {
      ability: {
        id: "a1", title: "Two-pointer invariants", status: "independent", version: 3, evidenceCount: 4,
        summary: "You can hold two indices under a stated rule and move them without rescanning — and you can say what the rule is while you do it.",
        markdown: "## Notes\n\nFirst seen on Container With Most Water. The move rule was stated correctly before the code was written, which is what made this an ability rather than a lucky pass.",
        concepts: [{ slug: "two-pointers", title: "Two pointers", kind: "dsa" }],
        practice: ["Solve 3Sum without sorting first, and say why it costs more.", "Take a sliding-window problem and write the invariant as a comment before the loop."],
        earnedAt: ago(40), updatedAt: ago(20),
      },
      machine: { proficiency: 0.82, confidence: 0.71, trend: "improving", trainingStatus: "monitoring", currentBelief: "Holds the invariant when the window only grows, and states it before writing the loop.", nextVerification: "A problem where the window has to shrink on a condition that is not the obvious one." },
      patterns: progress.patterns.slice(0, 1),
      evidence: [
        { challengeId: "c1", sessionId: "s1", title: "Container With Most Water", sessionTitle: "Graph fundamentals", difficulty: "medium", language: "python", outcome: "passed", occurredAt: ago(40) },
        { challengeId: "c2", sessionId: "s1", title: "Longest Substring Without Repeating", sessionTitle: "Graph fundamentals", difficulty: "medium", language: "python", outcome: "failed", occurredAt: ago(70) },
      ],
      learnerEvidence: [
        { id: "e1", abilityId: "a1", attemptId: null, eventId: null, statement: "Stated the move rule before writing the loop.", polarity: "supporting", independence: "independent", strength: 0.8, occurredAt: ago(40) },
        { id: "e2", abilityId: "a1", attemptId: null, eventId: null, statement: "Shrunk the window one element too far.", polarity: "contradictory", independence: "independent", strength: 0.5, occurredAt: ago(70) },
      ],
    } as any;
  },
} as unknown as SparApi;

function Harness() {
  const [page, setPage] = useState<"home" | "map" | "settings">("home");
  const [dark, setDark] = useState(true);
  const [ability, setAbility] = useState<string | null>(null);
  return (
    <div className={dark ? "dark" : ""}>
      <div className="flex h-screen flex-col bg-[var(--app-window-fill)] text-foreground">
        <div className="flex shrink-0 gap-2 px-3 py-2">
          <button className="rounded-md border border-border px-2 py-1 text-ui" onClick={() => setPage("home")} type="button">Home</button>
          <button className="rounded-md border border-border px-2 py-1 text-ui" onClick={() => setPage("map")} type="button">Map</button>
          <button className="rounded-md border border-border px-2 py-1 text-ui" onClick={() => setPage("settings")} type="button">Settings</button>
          <button className="rounded-md border border-border px-2 py-1 text-ui" onClick={() => setDark((value) => !value)} type="button">{dark ? "Light" : "Dark"}</button>
        </div>
        <div className="min-h-0 flex-1 bg-background">
          {page === "home" && <HomePage abilities={abilityLedger} ability={ability} api={api} busy={false} challenges={stones} concepts={[]} data={data} onBaseline={() => {}} onCreateTrack={() => {}} onMode={async () => {}} onNavigate={() => {}} onOpen={() => {}} onOpenAbility={setAbility} onOpenConcept={() => {}} onOpenSession={() => {}} onPractise={() => {}} />}
          {page === "map" && <div className="mx-auto w-full max-w-[72rem] px-8 pt-6"><ConceptMap abilities={abilityLedger} concepts={conceptFixtures} onOpenAbility={setAbility} onOpenConcept={() => {}} progress={progress} query="" /></div>}
          {page === "settings" && <SettingsPage account={data.account!} api={api} baseline={data.baseline} language="python" onBaseline={async () => {}} onLanguageChange={() => {}} onSignedOut={async () => {}} onThemeChange={async () => {}} theme="dark" />}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
