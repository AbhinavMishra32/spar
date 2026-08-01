import { describe, expect, it } from "vitest";
import { nextToolStage, phaseExecutionKey } from "./agentPolicy.js";

describe("Training Agent controller policy", () => {
  it("terminates ordinary learner chat without exposing tools", () => {
    expect(nextToolStage("learner-message", new Map())).toEqual({ activeTools: [], toolChoice: "none" });
  });

  it("exposes one deterministic action at a time", () => {
    expect(nextToolStage("session-start", new Map()).activeTools).toEqual(["search_learner_model"]);
    expect(nextToolStage("attempt-complete", new Map()).activeTools).toEqual(["inspect_current_attempt"]);
    const coldStartSearches = new Map<string, unknown[]>([["search_learner_model", [{ result: { passages: [] } }]], ["search_attempt_history", [{ result: { attempts: [] } }]]]);
    expect(nextToolStage("cold-start", coldStartSearches).activeTools).toEqual(["ask_user_question"]);
    const noAbility = new Map<string, unknown[]>([["search_learner_model", [{ result: [] }]], ["search_attempt_history", [{ result: [] }]]]);
    expect(nextToolStage("session-start", noAbility).activeTools).toEqual(["set_session_objective"]);
    const withAbility = new Map<string, unknown[]>([["search_learner_model", [{ result: { passages: [{ id: "ability" }] } }]], ["search_attempt_history", [{ result: { attempts: [] } }]]]);
    expect(nextToolStage("session-start", withAbility).activeTools).toEqual(["read_ability"]);
  });

  it("retries rejected challenge compilations within the bounded budget", () => {
    const outcomes = new Map<string, unknown[]>([
      ["search_learner_model", [{ result: { passages: [] } }]],
      ["search_attempt_history", [{ result: { attempts: [] } }]],
      ["set_session_objective", [{ result: { committed: true } }]],
      ["set_training_target", [{ result: { committed: true } }]],
      ["create_question", [{ result: { status: "invalid" } }]],
    ]);
    expect(nextToolStage("session-start", outcomes).activeTools).toEqual(["create_question"]);
  });

  it("stops after fifteen rejected candidates and reports the latest deterministic failed check", () => {
    const rejected = { result: { status: "invalid", report: { checks: [{ name: "reference solution", passed: false, detail: "exit 1" }] } } };
    const outcomes = new Map<string, unknown[]>([["create_question", Array.from({ length: 15 }, () => rejected)]]);
    expect(() => nextToolStage("session-start", outcomes)).toThrow(/15 rejected.*reference solution: exit 1/);
  });

  it("allows only one question compiler invocation per phase, even when the provider changes the payload", () => {
    expect(phaseExecutionKey("create_question", '{"title":"Count positives"}')).toBe("create_question");
    expect(phaseExecutionKey("create_question", '{"title":"Count values above a threshold"}')).toBe("create_question");
    expect(phaseExecutionKey("search_learner_model", '{"query":"arrays"}')).not.toBe(phaseExecutionKey("search_learner_model", '{"query":"loops"}'));
  });
});
