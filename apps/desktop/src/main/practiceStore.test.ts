import { expect, it } from "vitest";
import type { ChallengeSource, QuestionDesign } from "@spar/domain";
import { LocalStore } from "./store.js";

/* A sourced challenge as `PracticeService.mount` produces one: no reference
   solution, no hidden tests, and a source stamp carrying who grades it. */
const sourcedDesign = (title: string): QuestionDesign => ({
  title,
  language: "javascript",
  kind: "function",
  difficulty: "foundation",
  statement: "Given an array of integers, return the indices of the two numbers that add up to the target.",
  starterFiles: { "src/solution.js": "// spar:solution:start\nvar twoSum = function(nums, target) {};\n// spar:solution:end\nexport { twoSum as entry };" },
  referenceFiles: {},
  visibleTests: { "tests/examples.test.js": "// generated from the problem's published examples" },
  hiddenTests: {},
  knownIncorrectFiles: [],
  runCommand: "node --test",
  accidentalDifficulty: [],
  expectedFailureSignatures: [],
});

const source = (overrides: Partial<ChallengeSource> = {}): ChallengeSource => ({
  source: "leetcode",
  region: "global",
  slug: "two-sum",
  externalId: "1",
  displayId: "1",
  url: "https://leetcode.com/problems/two-sum/",
  difficulty: "easy",
  languageSlug: "javascript",
  remoteJudge: true,
  scratchRun: true,
  localCaseCount: 2,
  entryName: "twoSum",
  cases: [{ name: "Example 1", input: ["[2,7,11,15]", "9"], expected: "[0,1]" }],
  judge: "LeetCode judges this one.",
  references: [{ slug: "three-sum", title: "3Sum", difficulty: "medium", relation: "similar" }],
  ...overrides,
});

function sourcedSession(store: LocalStore, options: { title?: string; source?: ChallengeSource } = {}) {
  const { sessionId } = store.createSession("Get better at hash-map lookups");
  store.setTrainingTarget(sessionId, { ability: "Index mapping", specificGap: "Remembering where a value was seen", desiredEvidence: "Uses one pass with a map", avoidTesting: [] });
  const question = store.createQuestion(sessionId, sourcedDesign(options.title ?? "Two Sum"), { valid: true }, {
    concepts: [{ slug: "index-mapping", role: "primary" }, { slug: "hash-maps", role: "supporting" }],
    source: options.source ?? source(),
  });
  return { sessionId, question };
}

it("carries where a challenge came from onto the live session and its history", () => {
  const store = new LocalStore(":memory:");
  try {
    const { sessionId } = sourcedSession(store);
    const live = store.readSession(sessionId)?.question;
    expect(live?.source).toMatchObject({ source: "leetcode", slug: "two-sum", externalId: "1", remoteJudge: true });
    // The stamp has to survive into history too: a solved LeetCode problem read
    // back next month must still say LeetCode graded it.
    expect(store.listChallenges()[0]?.source).toMatchObject({ slug: "two-sum", displayId: "1" });
    expect(store.challengeRecord(store.listChallenges()[0]!.id)?.source?.judge).toContain("LeetCode judges");
  } finally { store.close(); }
});

it("leaves a challenge Spar wrote with no source at all", () => {
  // Null is the ordinary answer, and it is what every row written before sourced
  // challenges existed reads as.
  const store = new LocalStore(":memory:");
  try {
    const { sessionId } = store.createSession("Practise loops");
    store.setTrainingTarget(sessionId, { ability: "Loop control", specificGap: "Count values", desiredEvidence: "One direct loop", avoidTesting: [] });
    store.createQuestion(sessionId, sourcedDesign("Count the values"), { valid: true });
    expect(store.readSession(sessionId)?.question?.source).toBeNull();
    expect(store.listChallenges()[0]?.source).toBeNull();
  } finally { store.close(); }
});

it("keeps the source stamp through an adaptive replacement", () => {
  const store = new LocalStore(":memory:");
  try {
    const { sessionId } = sourcedSession(store);
    store.setTrainingTarget(sessionId, { ability: "Index mapping", specificGap: "Two-pass to one-pass", desiredEvidence: "Uses one pass", avoidTesting: [] });
    store.replaceQuestion(sessionId, sourcedDesign("Two Sum II"), { valid: true }, "Too easy.", undefined, source({ slug: "two-sum-ii-input-array-is-sorted", externalId: "167", displayId: "167" }));
    expect(store.readSession(sessionId)?.question?.source?.slug).toBe("two-sum-ii-input-array-is-sorted");
    // And the challenge it replaced keeps its own, rather than inheriting.
    expect(store.listChallenges().find((row) => row.title === "Two Sum")?.source?.slug).toBe("two-sum");
  } finally { store.close(); }
});

it("caches a problem and answers from the cache until it goes stale", () => {
  const store = new LocalStore(":memory:");
  try {
    store.cachePracticeProblem({ source: "leetcode", region: "global", slug: "two-sum", title: "Two Sum", difficulty: "easy", payload: { slug: "two-sum", statement: "Given an array…" } });
    expect(store.readCachedPracticeProblem("leetcode", "global", "two-sum")).toMatchObject({ payload: { slug: "two-sum" } });
    // Zero max-age is how a caller that needs the learner's current status on the
    // problem asks for a fresh read.
    expect(store.readCachedPracticeProblem("leetcode", "global", "two-sum", 0)).toBeNull();
    // The same slug is a different problem on the other LeetCode.
    expect(store.readCachedPracticeProblem("leetcode", "cn", "two-sum")).toBeNull();
  } finally { store.close(); }
});

it("reads the source's relation graph from both ends", () => {
  const store = new LocalStore(":memory:");
  try {
    store.cachePracticeProblem({
      source: "leetcode", region: "global", slug: "three-sum", title: "3Sum", difficulty: "medium", payload: {},
      references: [{ slug: "two-sum", title: "Two Sum", difficulty: "easy", relation: "similar" }],
    });
    expect(store.practiceProblemLinks("leetcode", "global", "three-sum").outgoing).toEqual([
      { slug: "two-sum", relation: "similar", title: "Two Sum", difficulty: "easy" },
    ]);
    // LeetCode publishes relations from the newer problem to the older one, so
    // "what leads into this" only exists as the reverse read.
    expect(store.practiceProblemLinks("leetcode", "global", "two-sum").incoming).toEqual([
      { slug: "three-sum", relation: "similar", title: "3Sum", difficulty: "medium" },
    ]);
  } finally { store.close(); }
});

it("replaces a problem's links rather than accumulating them", () => {
  const store = new LocalStore(":memory:");
  try {
    const cache = (references: Array<{ slug: string; title: string; difficulty: string | null; relation: string }>) =>
      store.cachePracticeProblem({ source: "leetcode", region: "global", slug: "three-sum", title: "3Sum", difficulty: "medium", payload: {}, references });
    cache([{ slug: "two-sum", title: "Two Sum", difficulty: "easy", relation: "similar" }]);
    cache([{ slug: "four-sum", title: "4Sum", difficulty: "medium", relation: "similar" }]);
    expect(store.practiceProblemLinks("leetcode", "global", "three-sum").outgoing.map((link) => link.slug)).toEqual(["four-sum"]);
  } finally { store.close(); }
});

it("lists what has already been set from a source, so nothing is assigned twice", () => {
  const store = new LocalStore(":memory:");
  try {
    const { question } = sourcedSession(store);
    store.completeAttempt(question.attemptId, "passed");
    expect(store.assignedPracticeProblems()).toEqual([expect.objectContaining({ slug: "two-sum", source: "leetcode", title: "Two Sum" })]);
  } finally { store.close(); }
});

it("takes the cached problems on sign-out, because they record what this learner solved", () => {
  const store = new LocalStore(":memory:");
  try {
    store.cachePracticeProblem({ source: "leetcode", region: "global", slug: "two-sum", title: "Two Sum", difficulty: "easy", payload: { status: "solved" }, references: [{ slug: "three-sum", title: "3Sum", difficulty: "medium", relation: "similar" }] });
    store.clearAccountData();
    expect(store.readCachedPracticeProblem("leetcode", "global", "two-sum")).toBeNull();
    expect(store.practiceProblemLinks("leetcode", "global", "two-sum").incoming).toEqual([]);
  } finally { store.close(); }
});
