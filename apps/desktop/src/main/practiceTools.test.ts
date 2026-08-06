import { describe, expect, it, vi } from "vitest";
import type { ChallengeSource, QuestionDesign } from "@spar/domain";
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
};

function practiceStub(overrides: Partial<Record<keyof PracticeService, unknown>> = {}) {
  const written: Record<string, string> = {};
  const service = {
    sourceName: () => "LeetCode",
    callTool: vi.fn(async (name: string) => ({ tool: name, problems: [] })),
    mount: vi.fn(async () => ({ design, source, files: { ...design.starterFiles, ...design.visibleTests }, cases: [], harnessNote: "" })),
    ...overrides,
  } as unknown as PracticeService;
  const workspaces = { writeAll: vi.fn(async (_session: string, files: Record<string, string>) => { Object.assign(written, files); }) } as unknown as WorkspaceService;
  return { service, workspaces, written };
}

function targetedSession(store: LocalStore) {
  const { sessionId } = store.createSession("Get reliably good at hash-map lookups");
  store.setTrainingTarget(sessionId, { ability: "Index mapping", specificGap: "Remembering where a value was seen", desiredEvidence: "One pass with a map", avoidTesting: [] });
  return sessionId;
}

const assign = (store: LocalStore, sessionId: string, practice: PracticeService, workspaces: WorkspaceService, input: Record<string, unknown> = {}) =>
  executeTrainingTool("assign_practice_problem", {
    slug: "two-sum",
    concepts: [{ slug: "index-mapping", role: "primary" }, { slug: "hash-maps", role: "supporting" }],
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

  it("refuses a second challenge while one is still open", async () => {
    const store = new LocalStore(":memory:");
    const { service, workspaces } = practiceStub();
    try {
      const sessionId = targetedSession(store);
      await assign(store, sessionId, service, workspaces);
      const second = await assign(store, sessionId, service, workspaces, { slug: "three-sum" });
      expect(second.status).toBe("invalid");
      expect(JSON.stringify(second.report)).toContain("already active");
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
        design, source: { ...source, remoteJudge: false, localCaseCount: 0 }, files: design.starterFiles, cases: [],
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
      mount: vi.fn(async () => ({ design, source: { ...source, remoteJudge: false, localCaseCount: 2, judge: "Spar grades this one locally." }, files: design.starterFiles, cases: [], harnessNote: "" })),
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
