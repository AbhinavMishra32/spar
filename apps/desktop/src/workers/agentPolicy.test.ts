import { describe, expect, it } from "vitest";
import { allowedTools, nextToolStage, phaseExecutionKey, type AgentTurnKind } from "./agentPolicy.js";

const TURN_KINDS: AgentTurnKind[] = ["cold-start", "session-start", "attempt-complete", "learner-message", "challenge-revision"];

/**
 * Every tool the stage machine can ask for on this turn kind.
 *
 * Walks the machine settling the last tool of each stage, which is the branch
 * that keeps going where a first-tool choice (`ask_user_question`) suspends the
 * turn. The settled result carries every shape the machine inspects at once, so
 * the ability branch and the compiler-retry branch are both reached.
 */
function reachableStages(turnKind: AgentTurnKind, hasActiveQuestion: boolean, webSearch = false): Set<string> {
  const outcomes = new Map<string, unknown[]>();
  const seen = new Set<string>();
  const settled = { result: { ok: true, passages: [{ id: "ability" }], attempts: [], challenges: [], status: "invalid" } };
  for (let step = 0; step < 40; step += 1) {
    const stage = nextToolStage(turnKind, outcomes, 3, { hasActiveQuestion, webSearch });
    if (!stage.activeTools.length) break;
    for (const name of stage.activeTools) seen.add(name);
    const advance = stage.activeTools.at(-1)!;
    outcomes.set(advance, [...(outcomes.get(advance) ?? []), settled]);
  }
  return seen;
}

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
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: ["replay_attempt"], toolChoice: "required" });
    outcomes.set("replay_attempt", [{ result: { report: "SOLVE REPLAY" } }]);
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: ["set_training_target"], toolChoice: "required" });
    outcomes.set("set_training_target", [{ result: { committed: true } }]);
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: ["replace_current_question"], toolChoice: "required" });
    outcomes.set("replace_current_question", [{ result: { status: "playable" } }]);
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: [], toolChoice: "none" });
  });

  it("exposes one deterministic action at a time", () => {
    expect(nextToolStage("session-start", new Map()).activeTools).toEqual(["search_learner_model"]);
    expect(nextToolStage("attempt-complete", new Map()).activeTools).toEqual(["replay_attempt"]);
    const coldStartSearches = new Map<string, unknown[]>([["search_learner_model", [{ result: { passages: [] } }]], ["search_attempt_history", [{ result: { attempts: [] } }]]]);
    expect(nextToolStage("cold-start", coldStartSearches).activeTools).toEqual(["ask_user_question"]);
    const noAbility = new Map<string, unknown[]>([["search_learner_model", [{ result: [] }]], ["search_attempt_history", [{ result: [] }]], ["search_challenge_history", [{ result: { challenges: [] } }]]]);
    expect(nextToolStage("session-start", noAbility).activeTools).toEqual(["set_session_objective"]);
    const withAbility = new Map<string, unknown[]>([["search_learner_model", [{ result: { passages: [{ id: "ability" }] } }]], ["search_attempt_history", [{ result: { attempts: [] } }]], ["search_challenge_history", [{ result: { challenges: [] } }]]]);
    expect(nextToolStage("session-start", withAbility).activeTools).toEqual(["read_ability"]);
  });

  /* Requiring a tool the turn never built does not fail loudly: the provider
     writes the call out as message text, no outcome is recorded, and the same
     phase repeats until the protocol retry budget is gone. Adding
     `search_challenge_history` to the session-start stages without adding it to
     that turn's tool set did exactly that — ten identical retries and no
     challenge. The two lists have to agree, so nothing relies on remembering. */
  it("never stages a tool the turn does not build", () => {
    for (const turnKind of TURN_KINDS) {
      for (const hasActiveQuestion of [false, true]) {
        for (const webSearch of [false, true]) {
          const built = allowedTools(turnKind, hasActiveQuestion, webSearch);
          const staged = [...reachableStages(turnKind, hasActiveQuestion, webSearch)];
          expect(staged.filter((name) => !built.has(name)), `${turnKind} (activeQuestion=${hasActiveQuestion}, web=${webSearch})`).toEqual([]);
        }
      }
    }
  });

  /* Reaching outside the learner's own record is offered, never demanded. A
     planning turn with no key must not stage a tool that can only answer "not
     set up", and one with a key must still be able to decline and commit. */
  it("offers the web alongside the objective, and not at all without a key", () => {
    const retrieved = () => new Map<string, unknown[]>([
      ["search_learner_model", [{ result: { passages: [] } }]],
      ["search_attempt_history", [{ result: { attempts: [] } }]],
      ["search_challenge_history", [{ result: { challenges: [] } }]],
    ]);
    expect(nextToolStage("session-start", retrieved(), 3, { webSearch: false }).activeTools).toEqual(["set_session_objective"]);

    const offered = nextToolStage("session-start", retrieved(), 3, { webSearch: true });
    expect(offered.activeTools).toEqual(["web_search", "set_session_objective"]);

    // Declining it commits the objective and the chain moves on rather than
    // coming back to the same choice.
    const declined = retrieved();
    declined.set("set_session_objective", [{ result: { committed: true } }]);
    expect(nextToolStage("session-start", declined, 3, { webSearch: true }).activeTools).not.toContain("web_search");
  });

  it("builds the challenge library search for every turn that can be staged to read it", () => {
    expect(allowedTools("session-start").has("search_challenge_history")).toBe(true);
    expect(reachableStages("session-start", false).has("search_challenge_history")).toBe(true);
  });

  it("makes a planning turn read what it has already asked before it aims a target", () => {
    // The agent was structurally blind here: `search_challenge_history` existed
    // but no stage required it, so a session's first target was chosen from the
    // ability ledger alone and every goal re-derived the same challenge.
    const outcomes = new Map<string, unknown[]>([["search_learner_model", [{ result: { passages: [] } }]], ["search_attempt_history", [{ result: { attempts: [] } }]]]);
    expect(nextToolStage("session-start", outcomes).activeTools).toEqual(["search_challenge_history"]);
  });

  it("replays the solve before judging it, and lets a question replace the next target", () => {
    const outcomes = new Map<string, unknown[]>();
    const stage = () => nextToolStage("attempt-complete", outcomes);
    const settle = (name: string) => outcomes.set(name, [{ result: { ok: true } }]);

    // How it was solved is read first; everything after it judges that reading.
    expect(stage().activeTools).toEqual(["replay_attempt"]);
    settle("replay_attempt");
    expect(stage().activeTools).toEqual(["evaluate_attempt"]);
    for (const name of ["evaluate_attempt", "read_ability", "propose_ability_update", "commit_session_decision", "search_learner_model", "search_concept_evidence"]) settle(name);

    // The only stage with a choice: aim the next question, or ask about what the
    // trace could not explain.
    expect(stage()).toEqual({ activeTools: ["ask_user_question", "set_training_target"], toolChoice: "required" });
    settle("set_training_target");
    expect(stage().activeTools).toEqual(["create_question"]);
  });

  it("suspends the turn on a question rather than publishing a challenge over it", () => {
    const outcomes = new Map<string, unknown[]>();
    for (const name of ["replay_attempt", "evaluate_attempt", "read_ability", "propose_ability_update", "commit_session_decision", "search_learner_model", "search_concept_evidence"]) {
      outcomes.set(name, [{ result: { ok: true } }]);
    }
    outcomes.set("ask_user_question", [{ result: { pending: true } }]);

    // The learner's answer arrives as its own turn and brings the target with it.
    expect(nextToolStage("attempt-complete", outcomes)).toEqual({ activeTools: [], toolChoice: "none" });
  });

  it("retries rejected challenge compilations within the bounded budget", () => {
    const outcomes = new Map<string, unknown[]>([
      ["search_learner_model", [{ result: { passages: [] } }]],
      ["search_attempt_history", [{ result: { attempts: [] } }]],
      ["search_challenge_history", [{ result: { challenges: [] } }]],
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
