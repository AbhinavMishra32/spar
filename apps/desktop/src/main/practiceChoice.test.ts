import { describe, expect, it, vi } from "vitest";
import type { ChallengeSource, QuestionDesign } from "@spar/domain";
import type { PracticeProblem } from "@spar/practice";
import { LocalStore } from "./store.js";
import type { PracticeService } from "./practice.js";
import type { WorkspaceService } from "./workspaces.js";
import { chosenAbility, chosenConcepts, chosenReport, chosenTarget, openChosenProblem, practiceSourceName } from "./practiceChoice.js";

const JUDGE = { judge: "Codeforces judges this one." };

function problem(over: Partial<Parameters<typeof chosenTarget>[0]> = {}) {
  return {
    title: "Watermelon",
    difficulty: "easy" as const,
    displayId: "4/A",
    source: "codeforces" as const,
    concepts: [{ slug: "greedy", role: "primary" as const }],
    topicTags: [{ slug: "math", name: "Math" }],
    ...over,
  };
}

describe("chosenAbility", () => {
  it("opens the ability under the problem's primary concept", () => {
    expect(chosenAbility({
      concepts: [{ slug: "arrays", role: "supporting" }, { slug: "graphs", role: "primary" }],
      topicTags: [{ slug: "math", name: "Math" }],
    })).toBe("Graphs");
  });

  it("falls back to the first concept when nothing is marked primary", () => {
    // The vocabulary's own title for the slug, not the slug title-cased: an
    // ability called "Arrays" and one called "Arrays & sequences" are two
    // abilities, and only one of them is the one the rollups already use.
    expect(chosenAbility({ concepts: [{ slug: "arrays", role: "supporting" }], topicTags: [] })).toBe("Arrays & sequences");
  });

  it("falls back to the source's own topic tag when Spar mapped no concept", () => {
    expect(chosenAbility({ concepts: [], topicTags: [{ slug: "two-pointers", name: "Two pointers" }] })).toBe("Two pointers");
  });

  it("still names something for a problem carrying no metadata at all", () => {
    // An ability that exists is what keeps the challenge visible to the rollups;
    // a blank title would file it under nothing.
    expect(chosenAbility({ concepts: [], topicTags: [] })).toBe("Problem solving");
  });
});

describe("chosenTarget", () => {
  it("says plainly that Spar did not diagnose this", () => {
    const target = chosenTarget(problem(), JUDGE);
    expect(target.specificGap).toContain("Not diagnosed by Spar");
    expect(target.specificGap).toContain("chose Watermelon");
    expect(target.specificGap).toContain("Codeforces 4/A");
  });

  it("carries the judge into the evidence it is after", () => {
    expect(chosenTarget(problem(), JUDGE).desiredEvidence).toContain("Codeforces judges this one.");
  });

  it("rules nothing out, because the learner already chose", () => {
    expect(chosenTarget(problem(), JUDGE).avoidTesting).toEqual([]);
  });

  it("names the session after the problem", () => {
    expect(chosenTarget(problem(), JUDGE).objective).toBe("Solving Watermelon on Codeforces.");
  });

  it("names the source the learner actually picked from", () => {
    const target = chosenTarget(problem({ source: "leetcode", displayId: "1", title: "Two Sum" }), { judge: "LeetCode judges this one." });
    expect(target.objective).toBe("Solving Two Sum on LeetCode.");
    expect(target.specificGap).toContain("LeetCode 1");
  });

  it("drops the display id from the label when the source published none", () => {
    expect(chosenTarget(problem({ displayId: "" }), JUDGE).specificGap).toContain("(Codeforces, easy)");
  });
});

describe("chosenConcepts", () => {
  it("passes the source's mapping through untouched, roles included", () => {
    expect(chosenConcepts({ concepts: [{ slug: "graphs", role: "primary" }, { slug: "bfs", role: "supporting" }] }))
      .toEqual([{ slug: "graphs", role: "primary" }, { slug: "bfs", role: "supporting" }]);
  });

  it("is empty rather than invented when the problem carries no concepts", () => {
    expect(chosenConcepts({ concepts: [] })).toEqual([]);
  });
});

describe("chosenReport", () => {
  it("records who grades it and that the learner picked it", () => {
    const report = chosenReport(JUDGE);
    expect(report.valid).toBe(true);
    expect(report.sourced).toBe(true);
    expect(report.chosenByLearner).toBe(true);
    expect(report.checks.map((check: { passed: boolean }) => check.passed)).toEqual([true, true]);
    expect(report.checks[0]!.detail).toBe("Codeforces judges this one.");
  });
});

describe("practiceSourceName", () => {
  it("uses each source's own name for itself", () => {
    expect(practiceSourceName("leetcode")).toBe("LeetCode");
    expect(practiceSourceName("codeforces")).toBe("Codeforces");
  });
});

/* ---- Opening one, against a real store ------------------------------------
   The unit tests above fix the wording; these fix the wiring, which is the part
   that broke. Picking a problem used to post an instruction to the agent and wait
   for a turn to publish the challenge, so everything below — a live challenge, a
   target, an ability, tagged concepts — existed only if a model answered. */

const design: QuestionDesign = {
  title: "Watermelon",
  language: "cpp",
  kind: "repository",
  difficulty: "foundation",
  statement: "Split the watermelon into two even parts.",
  starterFiles: { "src/main.cpp": "int main() {}" },
  referenceFiles: {},
  visibleTests: { "tests/examples.cpp": "// the published example" },
  hiddenTests: {},
  knownIncorrectFiles: [],
  runCommand: "./build/main",
  accidentalDifficulty: [],
  expectedFailureSignatures: [],
};

const mountedSource: ChallengeSource = {
  source: "codeforces", region: "global", slug: "4/A", externalId: "4A", displayId: "4/A",
  url: "https://codeforces.com/problemset/problem/4/A", difficulty: "easy", languageSlug: "cpp",
  remoteJudge: true, scratchRun: false, localCaseCount: 2, judge: "Codeforces judges this one.",
  entryName: "", cases: [], references: [],
};

const mountedProblem = {
  source: "codeforces", region: "global", slug: "4/A", externalId: "4A", displayId: "4/A", title: "Watermelon",
  url: mountedSource.url, difficulty: "easy", paidOnly: false, statement: design.statement, hints: [],
  topicTags: [{ slug: "math", name: "Math" }], concepts: [{ slug: "graphs", role: "primary" }, { slug: "arrays", role: "supporting" }],
  references: [], languages: [{ language: "cpp", slug: "cpp", starter: "int main() {}" }], signature: null,
  examples: [], sampleTestcases: [], acceptanceRate: null, status: "todo",
} satisfies PracticeProblem;

function harness(over: { source?: Partial<ChallengeSource> } = {}) {
  const store = new LocalStore(":memory:");
  const written: Record<string, string> = {};
  const source = { ...mountedSource, ...over.source };
  const practice = {
    mount: vi.fn(async () => ({
      problem: mountedProblem,
      design,
      source,
      files: { ...design.starterFiles, ...design.visibleTests },
      cases: [],
      harnessNote: "",
    })),
  } as unknown as PracticeService;
  const workspaces = {
    writeAll: vi.fn(async (_session: string, files: Record<string, string>) => { Object.assign(written, files); }),
  } as unknown as WorkspaceService;
  return { store, practice, workspaces, written };
}

describe("openChosenProblem", () => {
  it("leaves a live challenge behind with no agent turn to wait for", async () => {
    const { store, practice, workspaces } = harness();
    const { sessionId } = await openChosenProblem({ store, practice, workspaces }, { source: "codeforces", slug: "4/A" });

    const session = store.readSession(sessionId);
    expect(session?.question?.title).toBe("Watermelon");
    expect(session?.question?.attemptCompletedAt).toBeNull();
    expect(session?.summary.status).toBe("active");
  });

  it("writes the workspace before the challenge exists to open it", async () => {
    const { store, practice, workspaces, written } = harness();
    await openChosenProblem({ store, practice, workspaces }, { source: "codeforces", slug: "4/A" });
    expect(Object.keys(written).sort()).toEqual(["src/main.cpp", "tests/examples.cpp"]);
  });

  it("posts nothing to the agent, and says in the transcript who chose it", async () => {
    const { store, practice, workspaces } = harness();
    const { sessionId } = await openChosenProblem({ store, practice, workspaces }, { source: "codeforces", slug: "4/A" });

    const messages = store.readSession(sessionId)?.messages ?? [];
    // The old path wrote a paragraph of tool directions as a *learner* message,
    // so the first thing on screen was an instruction addressed to somebody else.
    expect(messages.every((entry) => entry.role === "system")).toBe(true);
    expect(messages.at(-1)?.body).toContain("The learner chose it from the problem library");
    expect(messages.at(-1)?.body).toContain("Codeforces judges this one.");
  });

  it("persists a target and opens the ability it names", async () => {
    const { store, practice, workspaces } = harness();
    const { sessionId } = await openChosenProblem({ store, practice, workspaces }, { source: "codeforces", slug: "4/A" });

    const target = store.latestTarget(sessionId);
    expect(target?.ability_title).toBe("Graphs");
    // Present as a document, not merely named on a row — an ability that exists
    // only in a training target is one the Abilities page cannot show.
    expect(store.readAbilityDetail(String(target?.ability_id))?.ability.title).toBe("Graphs");
  });

  it("tags the challenge with the source's concepts, roles intact", async () => {
    const { store, practice, workspaces } = harness();
    const { sessionId } = await openChosenProblem({ store, practice, workspaces }, { source: "codeforces", slug: "4/A" });

    const concepts = store.readSession(sessionId)?.question?.concepts ?? [];
    expect(concepts.find((concept) => concept.role === "primary")?.slug).toBe("graphs");
    expect(concepts.map((concept) => concept.slug)).toContain("arrays");
  });

  it("keeps the source stamp on the challenge, so the workspace can say who grades it", async () => {
    const { store, practice, workspaces } = harness();
    const { sessionId } = await openChosenProblem({ store, practice, workspaces }, { source: "codeforces", slug: "4/A" });

    expect(store.readSession(sessionId)?.question?.source?.slug).toBe("4/A");
    expect(store.readSession(sessionId)?.question?.source?.remoteJudge).toBe(true);
  });

  it("mounts in the learner's language when they have one", async () => {
    const { store, practice, workspaces } = harness();
    store.saveProfile({ name: "A", experience: "new", focus: [], weakness: "", language: "cpp", completedAt: "2026-08-01T00:00:00.000Z" });
    await openChosenProblem({ store, practice, workspaces }, { source: "codeforces", slug: "4/A" });
    expect(practice.mount).toHaveBeenCalledWith(expect.objectContaining({ language: "cpp" }));
  });

  it("refuses a problem nothing could grade, rather than opening an unmarkable one", async () => {
    const { store, practice, workspaces } = harness({ source: { remoteJudge: false, localCaseCount: 0 } });
    await expect(openChosenProblem({ store, practice, workspaces }, { source: "codeforces", slug: "4/A" }))
      .rejects.toThrow(/cannot grade/);
    // And leaves nothing behind: a dead session in the sidebar is worse than the error.
    expect(store.listSessions()).toHaveLength(0);
  });
});
