import { describe, expect, it, vi } from "vitest";
import type { ChallengeSource, QuestionDesign } from "@spar/domain";
import type { PracticeProblem } from "@spar/practice";
import { LocalStore } from "./store.js";
import { executeTrainingTool } from "./trainingTools.js";
import type { PracticeService } from "./practice.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";

/* The mount a connected source produces: one starter file, tests generated from
   the problem's published examples, and the stamp saying who grades it. */
const design: QuestionDesign = {
  title: "Two Sum",
  language: "javascript",
  kind: "function",
  difficulty: "foundation",
  statement: "Given an array of integers, return the indices of the two numbers that add up to the target.",
  starterFiles: { "src/solution.js": "// spar:solution:start\nvar twoSum = function(nums, target) {};\n// spar:solution:end\nexport { twoSum as entry };" },
  referenceFiles: {},
  visibleTests: { "tests/examples.test.js": "// two published examples" },
  hiddenTests: {},
  knownIncorrectFiles: [],
  runCommand: "node --test",
  accidentalDifficulty: [],
  expectedFailureSignatures: [],
};

const source: ChallengeSource = {
  source: "leetcode", region: "global", slug: "two-sum", externalId: "1", displayId: "1",
  url: "https://leetcode.com/problems/two-sum/", difficulty: "easy", languageSlug: "javascript",
  remoteJudge: true, localCaseCount: 2, judge: "LeetCode judges this one.", references: [],
  scratchRun: true,
  entryName: "twoSum",
  cases: [{ name: "Example 1", input: ["[2,7,11,15]", "9"], expected: "[0,1]" }],
};

const problem = {
  source: "leetcode", region: "global", slug: "two-sum", externalId: "1", displayId: "1", title: "Two Sum",
  url: "https://leetcode.com/problems/two-sum/", difficulty: "easy", paidOnly: false, statement: design.statement,
  hints: [], topicTags: [{ slug: "hash-table", name: "Hash Table" }], concepts: [{ slug: "hash-maps", role: "primary" }],
  references: [], languages: [{ language: "javascript", slug: "javascript", starter: design.starterFiles["src/solution.js"]! }],
  signature: { name: "twoSum", params: [{ name: "nums", type: "number[]" }, { name: "target", type: "number" }], returnType: "number[]", classBased: false },
  examples: [], sampleTestcases: [], acceptanceRate: 50, status: "todo",
} satisfies PracticeProblem;

function practiceStub(overrides: Partial<Record<keyof PracticeService, unknown>> = {}) {
  const written: Record<string, string> = {};
  const service = {
    sourceName: () => "LeetCode",
    callTool: vi.fn(async (name: string) => ({ tool: name, problems: [] })),
    mount: vi.fn(async () => ({ problem, design, source, files: { ...design.starterFiles, ...design.visibleTests }, cases: [], harnessNote: "" })),
    ...overrides,
  } as unknown as PracticeService;
  const workspaces = {
    writeAll: vi.fn(async (_session: string, files: Record<string, string>) => { Object.assign(written, files); }),
    /* The replacing path clears the old challenge's files first. Modelled here
       because leaving the previous challenge's tests in the sandbox is exactly the
       failure the real `replaceAll` exists to prevent. */
    replaceAll: vi.fn(async (_session: string, files: Record<string, string>) => {
      for (const path of Object.keys(written)) delete written[path];
      Object.assign(written, files);
    }),
  } as unknown as WorkspaceService;
  return { service, workspaces, written };
}

function targetedSession(store: LocalStore) {
  const { sessionId } = store.createSession("Get reliably good at hash-map lookups");
  store.setTrainingTarget(sessionId, { ability: "Index mapping", specificGap: "Remembering where a value was seen", desiredEvidence: "One pass with a map", avoidTesting: [] });
  return sessionId;
}

const assign = (store: LocalStore, sessionId: string, practice: PracticeService, workspaces: WorkspaceService, input: Record<string, unknown> = {}) =>
  executeTrainingTool("assign_practice_problem", {
    source: "leetcode",
    slug: "two-sum",
    concepts: [{ slug: "index-mapping", parentSlug: "hash-maps", role: "primary" }, { slug: "hash-maps", role: "supporting" }],
    why: "They solved the two-pass version and stalled on doing it in one, so this discriminates whether they can hold the seen-map while scanning.",
    ...input,
  }, sessionId, store, workspaces, {} as UtilityClient, undefined, practice) as Promise<Record<string, unknown>>;

describe("assign_practice_problem", () => {
  it("mounts a real problem as the session's challenge, tagged in Spar's vocabulary", async () => {
    const store = new LocalStore(":memory:");
    const { service, workspaces, written } = practiceStub();
    try {
      const sessionId = targetedSession(store);
      const result = await assign(store, sessionId, service, workspaces);

      expect(result.status).toBe("playable");
      expect(service.mount).toHaveBeenCalledWith(expect.objectContaining({ source: "leetcode", slug: "two-sum" }));
      expect(result.judge).toContain("LeetCode judges");
      expect(written["src/solution.js"]).toContain("twoSum");
      const question = store.readSession(sessionId)?.question;
      expect(question?.title).toBe("Two Sum");
      expect(question?.source?.slug).toBe("two-sum");
      // Tagged with the gap the target names, not with the source's own shelf.
      expect(question?.concepts[0]?.slug).toBe("index-mapping");
    } finally { store.close(); }
  });

  it("records why it was set, so a later turn can read what was being tested", async () => {
    const store = new LocalStore(":memory:");
    const { service, workspaces } = practiceStub();
    try {
      const sessionId = targetedSession(store);
      await assign(store, sessionId, service, workspaces);
      expect(store.readSession(sessionId)?.messages.at(-1)?.body).toContain("discriminates whether they can hold the seen-map");
    } finally { store.close(); }
  });

  it("rejects a provider problem outside both the target ability and demonstrated level", async () => {
    const store = new LocalStore(":memory:");
    const { service, workspaces } = practiceStub({
      mount: vi.fn(async () => ({
        problem: { ...problem, difficulty: "hard", concepts: [{ slug: "graphs", role: "primary" as const }] },
        design: { ...design, difficulty: "advanced" as const },
        source: { ...source, difficulty: "hard" as const },
        files: { ...design.starterFiles, ...design.visibleTests }, cases: [], harnessNote: "",
      })),
    });
    try {
      const result = await assign(store, targetedSession(store), service, workspaces, { why: "This is a generally useful contest problem." });
      const report = result.report as { checks: Array<{ name: string; passed: boolean }> };
      expect(result.status).toBe("invalid");
      expect(report.checks.filter((check) => !check.passed).map((check) => check.name))
        .toEqual(expect.arrayContaining(["learner level", "provider concept", "target rationale"]));
      expect(workspaces.writeAll).not.toHaveBeenCalled();
    } finally { store.close(); }
  });

  it("refuses a second challenge while one is still open", async () => {
    const store = new LocalStore(":memory:");
    const { service, workspaces } = practiceStub();
    try {
      const sessionId = targetedSession(store);
      await assign(store, sessionId, service, workspaces);
      const second = await assign(store, sessionId, service, workspaces, { slug: "three-sum" });
      expect(second.status).toBe("invalid");
      expect(JSON.stringify(second.report)).toContain("already active");
      // And says how to do the thing the learner actually asked for.
      expect(JSON.stringify(second.report)).toContain("replaceReason");
    } finally { store.close(); }
  });

  it("supersedes the open challenge when the learner asked for a different problem", async () => {
    // "Just give me a LeetCode problem" arrives mid-challenge. Without this the
    // agent's only legal move was to write its own challenge named after the
    // problem it could not assign, and have it graded locally.
    const store = new LocalStore(":memory:");
    const { service, workspaces, written } = practiceStub();
    try {
      const sessionId = targetedSession(store);
      const first = await assign(store, sessionId, service, workspaces);
      const firstQuestion = first.question as { id: string; attemptId: string };

      const swapped = practiceStub({
        mount: vi.fn(async () => ({
          problem,
          design: { ...design, title: "Best Time to Buy and Sell Stock" },
          source: { ...source, slug: "best-time-to-buy-and-sell-stock", displayId: "121" },
          files: { "src/solution.js": "// spar:solution:start\nvar maxProfit = function(prices) {};\n// spar:solution:end" },
          cases: [], harnessNote: "",
        })),
      });
      const result = await assign(store, sessionId, swapped.service, workspaces, {
        slug: "best-time-to-buy-and-sell-stock",
        replaceReason: "They asked for a real LeetCode problem instead of the diagnostic.",
      });

      expect(result.status).toBe("playable");
      expect(result.replacedQuestionId).toBe(firstQuestion.id);
      const question = store.readSession(sessionId)?.question;
      expect(question?.title).toBe("Best Time to Buy and Sell Stock");
      // The real problem, judged by the real judge — not a local imitation of it.
      expect(question?.source?.slug).toBe("best-time-to-buy-and-sell-stock");
      expect(question?.source?.remoteJudge).toBe(true);
      // The abandoned attempt keeps its history and says why it ended.
      const closing = store.readAttempt(firstQuestion.attemptId).at(-1);
      expect(closing?.type).toBe("attempt_completed");
      expect(closing?.payload).toMatchObject({ outcome: "replaced" });
      // And the previous challenge's files are gone from the sandbox.
      expect(written["tests/examples.test.js"]).toBeUndefined();
      expect(written["src/solution.js"]).toContain("maxProfit");
    } finally { store.close(); }
  });

  it("refuses to swap in the problem they are already on", async () => {
    const store = new LocalStore(":memory:");
    const { service, workspaces } = practiceStub();
    try {
      const sessionId = targetedSession(store);
      await assign(store, sessionId, service, workspaces);
      const again = await assign(store, sessionId, service, workspaces, { replaceReason: "They asked for something else." });
      expect(again.status).toBe("invalid");
      expect(JSON.stringify(again.report)).toContain("already on");
    } finally { store.close(); }
  });

  it("refuses a problem the learner has already been set", async () => {
    // The library is one library to the learner; a session boundary is an
    // implementation detail, and the same problem twice reads as repetition.
    const store = new LocalStore(":memory:");
    const { service, workspaces } = practiceStub();
    try {
      const first = targetedSession(store);
      const assigned = await assign(store, first, service, workspaces);
      store.completeAttempt((assigned.question as { attemptId: string }).attemptId, "passed");
      const second = targetedSession(store);
      const result = await assign(store, second, service, workspaces);
      expect(result.status).toBe("invalid");
      expect(JSON.stringify(result.report)).toContain("already been set");
    } finally { store.close(); }
  });

  it("refuses a problem nothing could grade", async () => {
    // No judge at the source and no case recoverable from the statement: setting
    // it would be asking someone to solve something with no way to find out
    // whether they had.
    const store = new LocalStore(":memory:");
    const { service, workspaces } = practiceStub({
      mount: vi.fn(async () => ({
        problem, design, source: { ...source, remoteJudge: false, localCaseCount: 0 }, files: design.starterFiles, cases: [],
        harnessNote: "This is a design problem: it asks for a class with several methods rather than one function.",
      })),
    });
    try {
      const result = await assign(store, targetedSession(store), service, workspaces);
      expect(result.status).toBe("invalid");
      expect(JSON.stringify(result.report)).toContain("Nothing could grade this");
      expect(JSON.stringify(result.report)).toContain("design problem");
    } finally { store.close(); }
  });

  it("allows a locally-graded problem when the source published examples", async () => {
    const store = new LocalStore(":memory:");
    const { service, workspaces } = practiceStub({
      mount: vi.fn(async () => ({ problem, design, source: { ...source, remoteJudge: false, localCaseCount: 2, judge: "Spar grades this one locally." }, files: design.starterFiles, cases: [], harnessNote: "" })),
    });
    try {
      const result = await assign(store, targetedSession(store), service, workspaces);
      expect(result.status).toBe("playable");
      expect(result.judge).toContain("locally");
      expect(result.localCases).toBe(2);
    } finally { store.close(); }
  });

  it("turns a source failure into an instruction rather than an exception", async () => {
    // A dead session or a subscription-only problem is the same message to the
    // agent: not this one, choose another or write your own.
    const store = new LocalStore(":memory:");
    const { service, workspaces } = practiceStub({
      mount: vi.fn(async () => { throw new Error("LeetCode refused this session."); }),
    });
    try {
      const result = await assign(store, targetedSession(store), service, workspaces);
      expect(result.status).toBe("invalid");
      expect(JSON.stringify(result.report)).toContain("Pick a different problem or write the challenge yourself");
    } finally { store.close(); }
  });

  it("says so plainly when no source is connected at all", async () => {
    const store = new LocalStore(":memory:");
    try {
      const result = await executeTrainingTool("assign_practice_problem", { slug: "two-sum" }, targetedSession(store), store, {} as WorkspaceService, {} as UtilityClient) as Record<string, unknown>;
      expect(JSON.stringify(result.report)).toContain("No practice source is connected");
    } finally { store.close(); }
  });

  it("refuses an unscoped slug because providers do not share an identifier namespace", async () => {
    const store = new LocalStore(":memory:");
    const { service, workspaces } = practiceStub();
    try {
      const result = await executeTrainingTool("assign_practice_problem", {
        slug: "two-sum",
        concepts: [{ slug: "index-mapping", role: "primary" }],
        why: "This would test whether the learner can preserve the complement map during one pass.",
      }, targetedSession(store), store, workspaces, {} as UtilityClient, undefined, service) as Record<string, unknown>;
      expect(result.status).toBe("invalid");
      expect(JSON.stringify(result.report)).toContain("provider identity");
      expect(service.mount).not.toHaveBeenCalled();
    } finally { store.close(); }
  });
});

describe("source reads", () => {
  it("passes a read straight through to the source's own MCP server", async () => {
    const store = new LocalStore(":memory:");
    const { service, workspaces } = practiceStub();
    try {
      const sessionId = targetedSession(store);
      const result = await executeTrainingTool("search_practice_problems", { concepts: ["hash-maps"] }, sessionId, store, workspaces, {} as UtilityClient, undefined, service);
      expect(service.callTool).toHaveBeenCalledWith("search_practice_problems", { concepts: ["hash-maps"] });
      expect(result).toMatchObject({ tool: "search_practice_problems" });
    } finally { store.close(); }
  });

  it("answers a read with a carry-on result when there is no source", async () => {
    const store = new LocalStore(":memory:");
    try {
      const result = await executeTrainingTool("read_practice_source", {}, targetedSession(store), store, {} as WorkspaceService, {} as UtilityClient) as Record<string, unknown>;
      expect(result.error).toBe("not-connected");
    } finally { store.close(); }
  });
});
