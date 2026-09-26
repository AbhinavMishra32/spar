import { describe, expect, it, vi } from "vitest";
import { LocalStore } from "./store.js";
import { executeTrainingTool } from "./trainingTools.js";
import { agentTurnPayload } from "./agentTurnPayload.js";
import { leetcodeBandsFor, searchCallsFor, type PracticeService } from "./practice.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";

const noWorkspace = {} as WorkspaceService;
const noRunner = {} as UtilityClient;

describe("session problem sources", () => {
  it("defaults to every source and round-trips a narrowed choice in canonical order", () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise graphs");
      expect(store.readSession(sessionId)?.summary.problemSources).toEqual(["spar", "leetcode", "codeforces"]);
      expect(store.setSessionProblemSources(sessionId, ["codeforces", "leetcode"])).toEqual(["leetcode", "codeforces"]);
      expect(store.listSessions().find((session) => session.id === sessionId)?.problemSources).toEqual(["leetcode", "codeforces"]);
      expect(() => store.setSessionProblemSources(sessionId, [])).toThrow();
      const created = store.createSession("Contest prep", undefined, ["codeforces"]);
      expect(store.problemSourcesForSession(created.sessionId)).toEqual(["codeforces"]);
    } finally { store.close(); }
  });

  it("tells the worker whether it may write challenges", () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise graphs", undefined, ["leetcode"]);
      const payload = agentTurnPayload({ store, sessionId, message: "go", turnKind: "session-start", webSearch: false, practiceSource: true, practiceSummary: null, accountId: "a" });
      expect(payload.sparAuthoring).toBe(false);
      expect(payload.problemSources).toEqual(["leetcode"]);
      expect(JSON.parse(payload.context).problemSources).toEqual(["leetcode"]);
    } finally { store.close(); }
  });

  it("refuses every authoring call, the fallback included, when Spar is deselected", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise graphs", undefined, ["leetcode", "codeforces"]);
      for (const name of ["create_question", "replace_current_question", "create_fallback_question"]) {
        const result = await executeTrainingTool(name, { title: "Mine" }, sessionId, store, noWorkspace, noRunner) as { status: string; report: { checks: Array<{ name: string }> } };
        expect(result.status).toBe("invalid");
        expect(result.report.checks[0]?.name).toBe("session sources");
      }
    } finally { store.close(); }
  });

  it("searches only the allowed providers and refuses reads and assignments from the others", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise graphs", undefined, ["spar", "codeforces"]);
      const callTool = vi.fn(async () => ({ problems: [] }));
      const practice = { callTool } as unknown as PracticeService;
      await executeTrainingTool("search_practice_problems", { concepts: ["graphs"] }, sessionId, store, noWorkspace, noRunner, undefined, practice);
      expect(callTool).toHaveBeenCalledWith("search_practice_problems", { concepts: ["graphs"] }, ["codeforces"]);
      const read = await executeTrainingTool("read_practice_problem", { source: "leetcode", slug: "two-sum" }, sessionId, store, noWorkspace, noRunner, undefined, practice) as { error: string };
      expect(read.error).toBe("not-allowed");
      const assigned = await executeTrainingTool("assign_practice_problem", { source: "leetcode", slug: "two-sum" }, sessionId, store, noWorkspace, noRunner, undefined, practice) as { status: string; report: { checks: Array<{ name: string }> } };
      expect(assigned.report.checks[0]?.name).toBe("session sources");
      expect(callTool).toHaveBeenCalledTimes(1);
    } finally { store.close(); }
  });
});

describe("rating-window search", () => {
  it("maps a window onto the LeetCode bands priced inside it", () => {
    expect(leetcodeBandsFor(1100, 1700)).toEqual(["easy", "medium"]);
    expect(leetcodeBandsFor(1900, 2400)).toEqual(["hard"]);
    // Nothing priced inside: the nearest band rather than nothing.
    expect(leetcodeBandsFor(1300, 1450)).toEqual(["easy"]);
  });

  it("passes a window through to Codeforces and splits it for LeetCode", () => {
    const args = { concepts: ["graphs"], minRating: 1100, maxRating: 1700, limit: 8 };
    expect(searchCallsFor("codeforces", args)).toEqual([args]);
    expect(searchCallsFor("leetcode", args)).toEqual([
      { concepts: ["graphs"], difficulty: "easy", limit: 4 },
      { concepts: ["graphs"], difficulty: "medium", limit: 4 },
    ]);
    expect(searchCallsFor("leetcode", { ...args, difficulty: "hard" })).toEqual([{ concepts: ["graphs"], difficulty: "hard", limit: 8 }]);
  });
});
