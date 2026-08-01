import { describe, expect, it } from "vitest";
import { nextToolStage } from "./agentPolicy.js";

describe("Training Agent controller policy", () => {
  it("terminates ordinary learner chat without exposing tools", () => {
    expect(nextToolStage("learner-message", new Map())).toEqual({ activeTools: [], toolChoice: "none" });
  });

  it("exposes one deterministic action at a time", () => {
    expect(nextToolStage("session-start", new Map()).activeTools).toEqual(["search_learner_model"]);
    expect(nextToolStage("attempt-complete", new Map()).activeTools).toEqual(["inspect_current_attempt"]);
    const noAbility = new Map<string, unknown[]>([["search_learner_model", [{ result: [] }]], ["search_attempt_history", [{ result: [] }]]]);
    expect(nextToolStage("session-start", noAbility).activeTools).toEqual(["set_session_objective"]);
    const withAbility = new Map<string, unknown[]>([["search_learner_model", [{ result: [{ id: "ability" }] }]], ["search_attempt_history", [{ result: [] }]]]);
    expect(nextToolStage("session-start", withAbility).activeTools).toEqual(["read_ability"]);
  });

  it("stops after rejected challenge compilations", () => {
    const outcomes = new Map<string, unknown[]>([["create_question", [{ result: { status: "invalid" } }]]]);
    expect(() => nextToolStage("session-start", outcomes, 1)).toThrow(/No automatic regeneration/);
  });
});
