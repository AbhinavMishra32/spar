import { describe, expect, it, vi } from "vitest";
import { connectPracticeMcp } from "./client.js";
import { PRACTICE_READ_TOOLS, PRACTICE_TOOLS } from "./tools.js";
import type { PracticeGateway, PracticeProblemBundle } from "../gateway.js";
import { PracticeAuthError, PracticeSourceError, type PracticeAccount, type PracticeProblem, type PracticeVerdict } from "../types.js";

const PROBLEM: PracticeProblem = {
  source: "leetcode",
  region: "global",
  slug: "two-sum",
  externalId: "1",
  displayId: "1",
  title: "Two Sum",
  url: "https://leetcode.com/problems/two-sum/",
  difficulty: "easy",
  paidOnly: false,
  statement: "Given an array of integers…",
  hints: ["Try a hash map."],
  topicTags: [{ slug: "array", name: "Array" }, { slug: "hash-table", name: "Hash Table" }],
  concepts: [{ slug: "arrays", role: "primary" }, { slug: "hash-maps", role: "supporting" }],
  references: [{ slug: "three-sum", title: "3Sum", difficulty: "medium", relation: "similar", paidOnly: false }],
  languages: [{ language: "javascript", slug: "javascript", starter: "var twoSum = function(nums, target) {};" }],
  signature: { name: "twoSum", params: [{ name: "nums", type: "integer[]" }, { name: "target", type: "integer" }], returnType: "integer[]", classBased: false },
  examples: [{ input: ["[2,7,11,15]", "9"], output: "[0,1]", explanation: "" }],
  sampleTestcases: ["[2,7,11,15]\n9"],
  acceptanceRate: 55.4,
  status: "todo",
};

const ACCOUNT: PracticeAccount = {
  source: "leetcode", region: "global", username: "learner", userId: "9", premium: false, verified: true, avatarUrl: "",
  solved: { total: 41, easy: 30, medium: 10, hard: 1 },
  available: { total: 3000, easy: 800, medium: 1600, hard: 600 },
  skills: [{ slug: "array", name: "Array", solved: 20, band: "fundamental" }, { slug: "dp", name: "DP", solved: 0, band: "advanced" }],
  streak: 4,
  capturedAt: new Date(0).toISOString(),
};

const VERDICT: PracticeVerdict = {
  outcome: "passed", status: "Accepted", statusCode: 10, passedCases: 63, totalCases: 63,
  runtime: "48 ms", memory: "42 MB", runtimePercentile: 90, memoryPercentile: 40,
  compileError: "", runtimeError: "", failedCase: null, caseAnswers: [], stdout: [],
  submitted: true, submissionId: "7", submissionUrl: "https://leetcode.com/submissions/detail/7/", judgedAt: new Date(0).toISOString(),
};

function gateway(overrides: Partial<PracticeGateway> = {}): PracticeGateway {
  const bundle: PracticeProblemBundle = {
    problem: PROBLEM,
    cases: [{ name: "Example 1", input: ["[2,7,11,15]", "9"], expected: "[0,1]", origin: "statement" }],
    capabilities: { remoteJudge: true, officialTestcases: true, search: true, progress: true, submissionHistory: true },
    judge: "LeetCode judges this one.",
  };
  return {
    sourceId: "leetcode",
    region: "global",
    state: async () => "connected",
    capabilities: async () => bundle.capabilities,
    account: async () => ACCOUNT,
    search: async () => ({ total: 2, problems: [{ source: "leetcode", slug: "two-sum", displayId: "1", title: "Two Sum", difficulty: "easy", paidOnly: false, acceptanceRate: 55.4, topicTags: ["array"], concepts: ["arrays"], status: "solved" }], appliedTags: ["array"], droppedTags: [] }),
    problem: async () => bundle,
    daily: async () => bundle,
    random: async () => "two-sum",
    progress: async () => [{ slug: "three-sum", title: "3Sum", difficulty: "medium", status: "TRIED", lastResult: "Wrong Answer", lastSubmittedAt: new Date(0).toISOString(), topicTags: ["array"] }],
    submissions: async () => [{ id: "7", slug: "two-sum", title: "Two Sum", verdict: "Accepted", accepted: true, language: "javascript", runtime: "48 ms", memory: "42 MB", submittedAt: new Date(0).toISOString(), code: "" }],
    submissionDetail: async () => ({ id: "7", slug: "two-sum", title: "Two Sum", verdict: "Accepted", accepted: true, language: "javascript", runtime: "48 ms", memory: "42 MB", submittedAt: new Date(0).toISOString(), code: "var twoSum = () => [0,1];" }),
    run: async () => ({ ...VERDICT, submitted: false }),
    submit: async () => VERDICT,
    ...overrides,
  };
}

describe("the practice MCP server", () => {
  it("offers the read tools to Spar and withholds the ones that spend a submission", async () => {
    // The learner solves the problem and the learner decides when to submit it.
    // An agent that could submit would be putting its own code on their record.
    const connection = await connectPracticeMcp({ gateway: gateway() });
    const names = (await connection.listTools()).map((tool) => tool.name);
    expect(names.sort()).toEqual(PRACTICE_READ_TOOLS.map((tool) => tool.name).sort());
    expect(names).not.toContain("submit_practice_solution");
    await connection.close();
  });

  it("offers everything when judging is allowed, as the stdio server does", async () => {
    const connection = await connectPracticeMcp({ gateway: gateway(), allowJudging: true });
    const names = (await connection.listTools()).map((tool) => tool.name);
    expect(names.sort()).toEqual(PRACTICE_TOOLS.map((tool) => tool.name).sort());
    await connection.close();
  });

  it("describes every tool it offers", async () => {
    const connection = await connectPracticeMcp({ gateway: gateway(), allowJudging: true });
    for (const tool of await connection.listTools()) {
      expect(tool.description.length, `${tool.name} has no description`).toBeGreaterThan(60);
    }
    await connection.close();
  });

  it("validates arguments at the protocol boundary", async () => {
    const connection = await connectPracticeMcp({ gateway: gateway() });
    // A slug is required, so a call without one must not reach the source.
    await expect(connection.call("read_practice_problem", {})).rejects.toThrow();
    await connection.close();
  });

  it("reads a problem with the two facts that decide what a verdict means", async () => {
    const connection = await connectPracticeMcp({ gateway: gateway() });
    const result = await connection.call("read_practice_problem", { slug: "two-sum" }) as Record<string, unknown>;
    expect(result.title).toBe("Two Sum");
    expect(result.concepts).toEqual(PROBLEM.concepts);
    expect(result.judge).toContain("LeetCode judges");
    expect(String(result.grading)).toContain("hidden case");
    expect(result.sampleCases).toHaveLength(1);
    expect(result.statement).toBe("Given an array of integers…");
    await connection.close();
  });

  it("drops the statement when the caller only needs the shape", async () => {
    const connection = await connectPracticeMcp({ gateway: gateway() });
    const result = await connection.call("read_practice_problem", { slug: "two-sum", includeStatement: false }) as Record<string, unknown>;
    expect(result.statement).toBeUndefined();
    expect(result.signature).toBeTruthy();
    await connection.close();
  });

  it("says a local grade is not an acceptance", async () => {
    // This is the sentence that stops a local pass being reported as the source
    // having accepted the answer.
    const disconnected = gateway({
      state: async () => "disconnected",
      capabilities: async () => ({ remoteJudge: false, officialTestcases: true, search: true, progress: false, submissionHistory: false }),
      problem: async () => ({
        problem: PROBLEM,
        cases: [{ name: "Example 1", input: ["[2,7,11,15]", "9"], expected: "[0,1]", origin: "statement" }],
        capabilities: { remoteJudge: false, officialTestcases: true, search: true, progress: false, submissionHistory: false },
        judge: "LeetCode is not connected, so Spar grades this one locally.",
      }),
    });
    const connection = await connectPracticeMcp({ gateway: disconnected });
    const result = await connection.call("read_practice_problem", { slug: "two-sum" }) as Record<string, unknown>;
    expect(String(result.grading)).toContain("weaker evidence");
    expect(String(result.grading)).toContain("must not be described as one");
    await connection.close();
  });

  it("tells the caller not to assign a problem nothing can grade", async () => {
    const ungradable = gateway({
      problem: async () => ({
        problem: PROBLEM,
        cases: [],
        capabilities: { remoteJudge: false, officialTestcases: false, search: true, progress: false, submissionHistory: false },
        judge: "Not connected.",
      }),
    });
    const connection = await connectPracticeMcp({ gateway: ungradable });
    const result = await connection.call("read_practice_problem", { slug: "two-sum" }) as Record<string, unknown>;
    expect(String(result.grading)).toContain("Do not assign it");
    await connection.close();
  });

  it("reports what the learner has already solved, so nothing is set twice", async () => {
    const connection = await connectPracticeMcp({ gateway: gateway() });
    const result = await connection.call("search_practice_problems", { concepts: ["arrays"] }) as Record<string, unknown>;
    expect((result.problems as Array<{ learnerStatus: string }>)[0]?.learnerStatus).toBe("solved");
    expect(String(result.note)).toContain("already solved");
    await connection.close();
  });

  it("warns when a search result needs a subscription Spar cannot assume", async () => {
    const paid = gateway({ search: async () => ({ total: 1, problems: [{ source: "leetcode", slug: "x", displayId: "9", title: "Paid", difficulty: "hard", paidOnly: true, acceptanceRate: null, topicTags: [], concepts: [], status: "unknown" }], appliedTags: [], droppedTags: [] }) });
    const connection = await connectPracticeMcp({ gateway: paid });
    const result = await connection.call("search_practice_problems", {}) as Record<string, unknown>;
    expect(String(result.warning)).toContain("subscription-only");
    await connection.close();
  });

  it("reads the source's own view of the learner, with the zero-solve tags dropped", async () => {
    const connection = await connectPracticeMcp({ gateway: gateway() });
    const result = await connection.call("read_practice_source", {}) as Record<string, unknown>;
    const account = result.account as { username: string; topSkills: Array<{ slug: string }> };
    expect(result.state).toBe("connected");
    expect(account.username).toBe("learner");
    expect(account.topSkills.map((skill) => skill.slug)).toEqual(["array"]);
    await connection.close();
  });

  it("names an unfinished attempt as the candidate it is", async () => {
    const connection = await connectPracticeMcp({ gateway: gateway() });
    const result = await connection.call("read_practice_progress", { status: "attempted" }) as Record<string, unknown>;
    expect(String(result.note)).toContain("walked away from");
    expect(result.count).toBe(1);
    await connection.close();
  });

  it("fetches submission code only when it is asked for", async () => {
    const detail = vi.fn(async () => null);
    const connection = await connectPracticeMcp({ gateway: gateway({ submissionDetail: detail }) });
    await connection.call("read_practice_submissions", { slug: "two-sum" });
    expect(detail).not.toHaveBeenCalled();
    await connection.call("read_practice_submissions", { slug: "two-sum", includeCode: true });
    expect(detail).toHaveBeenCalledOnce();
    await connection.close();
  });

  it("returns an expired session as a readable result rather than ending the turn", async () => {
    const broken = gateway({ problem: async () => { throw new PracticeAuthError("LeetCode refused this session."); } });
    const connection = await connectPracticeMcp({ gateway: broken });
    const result = await connection.call("read_practice_problem", { slug: "two-sum" }) as Record<string, unknown>;
    expect(result.error).toBe("not-connected");
    expect(result.retryable).toBe(false);
    expect(String(result.note)).toContain("Carry on without it");
    await connection.close();
  });

  it("marks a source outage retryable and refuses to call it evidence", async () => {
    const broken = gateway({ search: async () => { throw new PracticeSourceError("LeetCode is rate-limiting this machine.", 429); } });
    const connection = await connectPracticeMcp({ gateway: broken });
    const result = await connection.call("search_practice_problems", {}) as Record<string, unknown>;
    expect(result.error).toBe("source-failed");
    expect(result.retryable).toBe(true);
    expect(String(result.note)).toContain("not treat this as a fact about the learner");
    await connection.close();
  });

  it("reports every call to the host, failures included", async () => {
    const onCall = vi.fn();
    const connection = await connectPracticeMcp({ gateway: gateway({ problem: async () => { throw new PracticeAuthError("nope"); } }), onCall });
    await connection.call("search_practice_problems", {});
    await connection.call("read_practice_problem", { slug: "two-sum" });
    expect(onCall).toHaveBeenCalledWith({ tool: "search_practice_problems", ok: true, detail: "1 of 2 problems" });
    expect(onCall).toHaveBeenCalledWith({ tool: "read_practice_problem", ok: false, detail: expect.stringContaining("not-connected") });
    await connection.close();
  });

  it("judges through the gateway when judging is allowed", async () => {
    const submit = vi.fn(async () => VERDICT);
    const connection = await connectPracticeMcp({ gateway: gateway({ submit }), allowJudging: true });
    const result = await connection.call("submit_practice_solution", { slug: "two-sum", language: "javascript", code: "var twoSum = () => [0,1];" }) as Record<string, unknown>;
    expect(submit).toHaveBeenCalledWith({ slug: "two-sum", externalId: "1", language: "javascript", code: "var twoSum = () => [0,1];" });
    expect((result.verdict as PracticeVerdict).outcome).toBe("passed");
    await connection.close();
  });

  it("passes custom testcases through to a scratch run", async () => {
    const run = vi.fn(async () => ({ ...VERDICT, submitted: false }));
    const connection = await connectPracticeMcp({ gateway: gateway({ run }), allowJudging: true });
    await connection.call("run_practice_code", { slug: "two-sum", language: "javascript", code: "x", testcases: "[1,2]\n3" });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ dataInput: "[1,2]\n3" }));
    await connection.close();
  });
});
