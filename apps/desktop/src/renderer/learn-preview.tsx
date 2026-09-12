import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { BootstrapData, SparApi } from "../shared/api";
import { TodayPage } from "./components/pages/TodayPage";
import { ProgressPage } from "./components/pages/ProgressPage";
import { SettingsPage } from "./components/pages/SettingsPage";
import "./theme.css";

/* A harness for the three surfaces that carry Spar's argument about the learner,
   in a browser and without a store behind them. Not shipped; same reason as
   auth-preview and harness.html. */

const now = new Date().toISOString();
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const ability = (over: Partial<any>): any => ({
  abilityId: "a1", title: "Two-pointer invariants", proficiency: 0.7, confidence: 0.6,
  evidenceCount: 4, lastEvidenceAt: ago(20), trainingStatus: "monitoring", trend: "stable",
  currentBelief: "Holds the invariant when the window only grows.", nextVerification: "A problem where the window must shrink.",
  updatedAt: ago(20), ...over,
});

const progress: any = {
  rating: { id: "r5", rating: 1284, provisional: true, reason: "Two unaided passes on medium graph problems moved this up; still provisional until five more attempts land.", occurredAt: ago(6) },
  ratingHistory: [
    { id: "r1", rating: 1100, provisional: true, reason: "", occurredAt: ago(200) },
    { id: "r2", rating: 1155, provisional: true, reason: "", occurredAt: ago(160) },
    { id: "r3", rating: 1130, provisional: true, reason: "", occurredAt: ago(90) },
    { id: "r4", rating: 1240, provisional: true, reason: "", occurredAt: ago(40) },
    { id: "r5", rating: 1284, provisional: true, reason: "", occurredAt: ago(6) },
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

const data: BootstrapData = {
  account: { id: "u1", displayName: "A", email: "a@example.com" },
  profile: { language: "python" } as any,
  sessions: [{ id: "s1", activeQuestion: null } as any],
  challenges: [], abilities: [], concepts: [], tracks: [], activeTrack: null,
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
  async updateState() { return { status: "current", currentVersion: "0.4.0" } as any; },
  async listProviders() { return { providers: [{ id: "chatgpt", label: "ChatGPT", kind: "subscription", models: [{ id: "gpt-5.6", label: "GPT-5.6 Luna" }], model: "gpt-5.6", connected: true, isDefault: true }], defaultProvider: "chatgpt" } as any; },
  async providerUsage() { return [] as any; },
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
  const [page, setPage] = useState<"today" | "progress" | "settings">("today");
  const [dark, setDark] = useState(true);
  const [ability, setAbility] = useState<string | null>(null);
  return (
    <div className={dark ? "dark" : ""}>
      <div className="flex h-screen flex-col bg-[var(--app-window-fill)] text-foreground">
        <div className="flex shrink-0 gap-2 px-3 py-2">
          <button className="rounded-md border border-border px-2 py-1 text-ui" onClick={() => setPage("today")} type="button">Today</button>
          <button className="rounded-md border border-border px-2 py-1 text-ui" onClick={() => setPage("progress")} type="button">Progress</button>
          <button className="rounded-md border border-border px-2 py-1 text-ui" onClick={() => setPage("settings")} type="button">Settings</button>
          <button className="rounded-md border border-border px-2 py-1 text-ui" onClick={() => setDark((value) => !value)} type="button">{dark ? "Light" : "Dark"}</button>
        </div>
        <div className="min-h-0 flex-1 bg-background">
          {page === "today" && <TodayPage busy={false} data={data} onBaseline={() => {}} onCreateTrack={() => {}} onMode={async () => {}} onOpen={() => {}} onProgress={() => setPage("progress")} />}
          {page === "progress" && <ProgressPage abilities={abilityLedger} ability={ability} api={api} challenges={[]} concepts={[]} onOpenAbility={setAbility} onOpenConcept={() => {}} onOpenSession={() => {}} onPractise={() => {}} progress={progress} />}
          {page === "settings" && <SettingsPage api={api} baseline={data.baseline} language="python" onBaseline={async () => {}} onLanguageChange={() => {}} onSignedOut={async () => {}} onThemeChange={async () => {}} theme="dark" />}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
