import { describe, expect, it } from "vitest";
import { nextToolStage, phaseExecutionKey } from "./agentPolicy.js";

describe("Training Agent controller policy", () => {
  it("lets the single agent choose tools or prose for learner chat", () => {
    const stage=nextToolStage("learner-message",new Map(),15,{hasActiveQuestion:true});
    expect(stage.toolChoice).toBe("auto");
    expect(stage.activeTools).toContain("replace_current_question");
    expect(stage.activeTools).toContain("upsert_ability");
    expect(stage.activeTools).not.toContain("create_question");
  });

  it("ends tool selection after a replacement is durably playable",()=>{
    const outcomes=new Map<string,unknown[]>([["replace_current_question",[{result:{status:"playable"}}]]]);
    expect(nextToolStage("learner-message",outcomes,15,{hasActiveQuestion:true})).toEqual({activeTools:[],toolChoice:"none"});
  });

  it("requires the complete revision transaction for explicit change requests", () => {
    const outcomes = new Map<string, unknown[]>();
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: ["inspect_current_attempt"], toolChoice: "required" });
    outcomes.set("inspect_current_attempt", [{ result: { status: "active" } }]);
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: ["set_training_target"], toolChoice: "required" });
    outcomes.set("set_training_target", [{ result: { committed: true } }]);
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: ["replace_current_question"], toolChoice: "required" });
    outcomes.set("replace_current_question", [{ result: { status: "playable" } }]);
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: [], toolChoice: "none" });
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

  it("reports exhaustion after fifteen rejected candidates instead of ending the turn", () => {
    const rejected = { result: { status: "invalid", report: { checks: [{ name: "reference solution", passed: false, detail: "exit 1" }] } } };
    const outcomes = new Map<string, unknown[]>([["create_question", Array.from({ length: 15 }, () => rejected)]]);
    const stage = nextToolStage("session-start", outcomes);
    // The controller falls back to a host-authored challenge from here, so the
    // budget running out must be reportable state rather than a thrown error.
    expect(stage.exhausted).toMatchObject({ attempts: 15 });
    expect(stage.exhausted?.failure).toContain("reference solution: exit 1");
    expect(stage.activeTools).toEqual([]);
  });

  it("allows only one question compiler invocation per phase, even when the provider changes the payload", () => {
    expect(phaseExecutionKey("create_question", '{"title":"Count positives"}')).toBe("create_question");
    expect(phaseExecutionKey("create_question", '{"title":"Count values above a threshold"}')).toBe("create_question");
    expect(phaseExecutionKey("search_learner_model", '{"query":"arrays"}')).not.toBe(phaseExecutionKey("search_learner_model", '{"query":"loops"}'));
  });
});
