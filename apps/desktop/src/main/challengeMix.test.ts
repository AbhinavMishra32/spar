import { describe, expect, it } from "vitest";
import { DEFAULT_CHALLENGE_MIX } from "@spar/domain";
import { LocalStore } from "./store.js";
import { executeTrainingTool } from "./trainingTools.js";
import { agentTurnPayload } from "./agentTurnPayload.js";
import { challengeMixInstructions, sparChoice } from "../shared/challengeMix.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";

const turn = (store: LocalStore, sessionId: string) =>
  agentTurnPayload({ store, sessionId, message: "go", turnKind: "learner-message", webSearch: false, practiceSource: true, practiceSummary: null, accountId: "a" }).context;
const tool = (store: LocalStore, sessionId: string, input: Record<string, unknown>) =>
  executeTrainingTool("set_challenge_mix", input, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as Promise<Record<string, unknown>>;

describe("coaching settings", () => {
  it("say nothing to the coach at the defaults", () => {
    expect(challengeMixInstructions(DEFAULT_CHALLENGE_MIX, ["spar", "leetcode", "codeforces"], "python")).toBe("");
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Trees");
      expect(store.readSession(sessionId)?.summary.challengeMix).toEqual(DEFAULT_CHALLENGE_MIX);
      expect(turn(store, sessionId)).not.toContain("## Coaching settings");
    } finally { store.close(); }
  });

  it("reach the coach's journey once set", () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Trees");
      store.setSessionChallengeMix(sessionId, { ...DEFAULT_CHALLENGE_MIX, sparUse: "struggling", lenses: [{ id: "lang-idioms", depth: "mention" }, { id: "from-scratch", depth: "drill" }], instructions: "Always give me a TreeNode class" });
      const context = turn(store, sessionId);
      expect(context).toContain("## Coaching settings");
      expect(context).toContain("Write a Spar problem when the learner is struggling");
      expect(context).toContain("idioms (lang-idioms) — mention:");
      expect(context).toContain("- Build it yourself (from-scratch) — drill:");
      expect(context).toContain("Always give me a TreeNode class");
    } finally { store.close(); }
  });

  it("name the language lenses after the Track's language, with no table per language", () => {
    const mix = { ...DEFAULT_CHALLENGE_MIX, lenses: [{ id: "lang-idioms", depth: "teach" as const }, { id: "lang-deep", depth: "mention" as const }] };
    expect(challengeMixInstructions(mix, ["spar"], "rust")).toContain("- Rust idioms (lang-idioms) — teach:");
    expect(challengeMixInstructions(mix, ["spar"], "cpp")).toContain("- Deep C++ (lang-deep) — mention:");
  });

  it("leave the Spar rule out when the sources already decide", () => {
    const mix = { ...DEFAULT_CHALLENGE_MIX, sparUse: "more" as const };
    expect(challengeMixInstructions(mix, ["leetcode"], "python")).toBe("");
    expect(challengeMixInstructions(mix, ["spar"], "python")).toBe("");
    expect(sparChoice(["leetcode"], mix)).toBe("never");
    expect(sparChoice(["spar"], mix)).toBe("always");
    expect(sparChoice(["spar", "codeforces"], mix)).toBe("more");
  });

  it("carry over to the next session on the same Track", () => {
    const store = new LocalStore(":memory:");
    try {
      const first = store.createSession("Trees");
      store.setSessionChallengeMix(first.sessionId, { ...DEFAULT_CHALLENGE_MIX, lenses: [{ id: "lang-stdlib", depth: "teach" }] });
      const trackId = store.trackIdForSession(first.sessionId)!;
      const next = store.createSession("More trees", trackId);
      expect(store.challengeMixForSession(next.sessionId).lenses).toEqual([{ id: "lang-stdlib", depth: "teach" }]);
    } finally { store.close(); }
  });

  it("change only what the coach sends, and move the sources at the ladder's ends", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Trees");
      store.setSessionChallengeMix(sessionId, { ...DEFAULT_CHALLENGE_MIX, lenses: [{ id: "lang-idioms", depth: "teach" }], instructions: "Keep it short" });

      const added = await tool(store, sessionId, { lenses: [{ id: "complexity", depth: "drill" }, { id: "custom:bit-tricks", label: "Bit tricks", depth: "mention" }], spar: "less", note: "Fewer Spar problems" });
      expect(added.status).toBe("saved");
      expect(store.challengeMixForSession(sessionId)).toMatchObject({
        sparUse: "less",
        lenses: [{ id: "lang-idioms", depth: "teach" }, { id: "complexity", depth: "drill" }, { id: "custom:bit-tricks", label: "Bit tricks", depth: "mention" }],
        instructions: "Keep it short",
      });

      await tool(store, sessionId, { spar: "never", note: "Real problems only" });
      expect(store.problemSourcesForSession(sessionId)).toEqual(["leetcode", "codeforces"]);
      /* Drill needs a Spar problem to carry it; with Spar off the coach teaches instead. */
      expect(turn(store, sessionId)).toContain("- Complexity (complexity) — teach:");

      await tool(store, sessionId, { spar: "struggling", lenses: [{ id: "lang-idioms", depth: "off" }], note: "Spar to repair" });
      expect(store.problemSourcesForSession(sessionId)).toEqual(["spar", "leetcode", "codeforces"]);
      expect(store.challengeMixForSession(sessionId).lenses.map((lens) => lens.id)).toEqual(["complexity", "custom:bit-tricks"]);

      await tool(store, sessionId, { spar: "always", note: "Only Spar" });
      expect(store.problemSourcesForSession(sessionId)).toEqual(["spar"]);
      expect((await tool(store, sessionId, { spar: "always", note: "Again" })).status).toBe("unchanged");
    } finally { store.close(); }
  });

  it("keep a coach suggestion pending, and never re-offer one that is on or turned down", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Heaps");
      store.setSessionChallengeMix(sessionId, { ...DEFAULT_CHALLENGE_MIX, lenses: [{ id: "lang-idioms", depth: "teach" }], dismissed: ["lang-types"] });
      const result = await tool(store, sessionId, { suggest: [{ id: "lang-stdlib", reason: "You hand-rolled a heap twice.", example: { before: "a hand-rolled heap", after: "heapq.heappush(h, x)" } }, { id: "lang-types", reason: "No hints." }, { id: "lang-idioms", reason: "Loops." }], note: "Suggested a lens" });
      expect(store.challengeMixForSession(sessionId).suggestions).toEqual([{ id: "lang-stdlib", reason: "You hand-rolled a heap twice.", example: { before: "a hand-rolled heap", after: "heapq.heappush(h, x)" } }]);
      expect(result.skippedSuggestions).toBe("2 suggestions were already on, pending or turned down.");
      expect(turn(store, sessionId)).toContain("Lenses you suggested that the learner has not answered yet: Standard library");
      expect(turn(store, sessionId)).toContain("turned these lens suggestions down: lang-types");

      /* Accepting the lens settles the suggestion. */
      await tool(store, sessionId, { lenses: [{ id: "lang-stdlib", depth: "teach" }], note: "Added" });
      expect(store.challengeMixForSession(sessionId).suggestions).toEqual([]);
    } finally { store.close(); }
  });
});

describe("lenses across the whole Track", () => {
  const drill = { ...DEFAULT_CHALLENGE_MIX, lenses: [{ id: "lang-deep", depth: "drill" as const }, { id: "lang-idioms", depth: "teach" as const }] };
  const context = (store: LocalStore, sessionId: string, input: Record<string, unknown>) =>
    executeTrainingTool("challenge_builder_context", input, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as Promise<Record<string, unknown>>;

  it("sit at the end of the journey, as standing orders with a history per lens", () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Trees");
      store.setSessionChallengeMix(sessionId, drill);
      let text = turn(store, sessionId);
      expect(text.indexOf("## Coaching settings")).toBeGreaterThan(text.indexOf("## Challenges on this Track"));
      expect(text.indexOf("## Coaching settings")).toBeLessThan(text.indexOf("## Available this turn"));
      expect(text).toContain("rather than a checklist for every reply");
      expect(text).toContain("So far: nothing yet.");
      store.logLens(sessionId, "lang-idioms", "feedback", "for i in range(len(xs)) → enumerate(xs)");
      text = turn(store, sessionId);
      expect(text).toMatch(/So far: feedback \d+m ago — for i in range\(len\(xs\)\) → enumerate\(xs\)/);
    } finally { store.close(); }
  });

  it("leave carrying a lens to the coach, and refuse only one the learner does not have", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Trees");
      store.setSessionChallengeMix(sessionId, drill);
      expect((await context(store, sessionId, { mode: "new" })).refused).toBeUndefined();
      expect((await context(store, sessionId, { mode: "new", lens: { id: "nope", sideQuest: "something long enough" } })).refused).toContain("not one of the learner's lenses");
      const carried = await context(store, sessionId, { mode: "new", lens: { id: "lang-deep", sideQuest: "Use __slots__ on the node class and say why" } });
      expect(carried.refused).toBeUndefined();
      expect(carried.lens).toMatchObject({ label: "Deep JavaScript" });
      expect((await context(store, sessionId, { mode: "revise" })).refused).toBeUndefined();
    } finally { store.close(); }
  });

  it("log what the review read through a lens, and only for lenses that are on", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Trees");
      store.setSessionChallengeMix(sessionId, drill);
      await executeTrainingTool("review_solution", { attemptId: "00000000-0000-4000-8000-000000000000", verdict: "accepted", observedComplexity: "O(n)", approach: "Recursion over both children", reasons: ["Clean recursion"], lenses: [{ id: "lang-idioms", note: "sum() over a generator reads better" }, { id: "off-lens", note: "should be dropped" }] }, sessionId, store, {} as WorkspaceService, {} as UtilityClient).catch(() => undefined);
      expect(store.lensLog(sessionId)).toEqual({ "lang-idioms": [expect.objectContaining({ kind: "feedback", note: "sum() over a generator reads better" })] });
    } finally { store.close(); }
  });
});
