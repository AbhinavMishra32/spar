import { describe, expect, it } from "vitest";
import { allowedTools, completionInstruction, nextToolStage, phaseExecutionKey, TEACH_TOOLS, turnExecutionKey, VISUALIZER_GATE, VISUALIZER_SKILL_TOOLS, VISUALIZER_TOOLS, type AgentTurnKind } from "./agentPolicy.js";

const TURN_KINDS: AgentTurnKind[] = ["cold-start", "session-start", "attempt-complete", "learner-message", "challenge-revision"];

/**
 * Every tool the stage machine can ask for on this turn kind.
 *
 * Walks the machine settling the last tool of each stage, which is the branch
 * that keeps going where a first-tool choice (`ask_user_question`) suspends the
 * turn. The settled result carries every shape the machine inspects at once, so
 * the ability branch and the compiler-retry branch are both reached.
 */
function reachableStages(turnKind: AgentTurnKind, hasActiveQuestion: boolean, webSearch = false, practiceSource = false): Set<string> {
  const outcomes = new Map<string, unknown[]>();
  const seen = new Set<string>();
  const settled = { result: { ok: true, passages: [{ id: "ability" }], attempts: [], challenges: [], status: "invalid" } };
  for (let step = 0; step < 40; step += 1) {
    const stage = nextToolStage(turnKind, outcomes, 3, { hasActiveQuestion, webSearch, practiceSource });
    if (!stage.activeTools.length) break;
    for (const name of stage.activeTools) seen.add(name);
    const advance = stage.activeTools.at(-1)!;
    outcomes.set(advance, [...(outcomes.get(advance) ?? []), settled]);
  }
  return seen;
}

describe("Training Agent controller policy", () => {
  it("requires a truthful teaching handoff after the first challenge",()=>{
    const local=new Map<string,unknown[]>([["create_question",[{result:{status:"playable"}}]]]);
    const sourced=new Map<string,unknown[]>([["assign_practice_problem",[{result:{status:"playable",source:"codeforces"}}]]]);
    expect(completionInstruction("session-start",local)).toContain("tailored local prerequisite");
    expect(completionInstruction("session-start",local)).toContain("compact micro-lesson");
    expect(completionInstruction("cold-start",local)).toContain("compact micro-lesson");
    expect(completionInstruction("session-start",local)).toContain("never describe it as a real");
    expect(completionInstruction("session-start",sourced)).toContain("connected-provider problem");
  });

  /* The reason a challenge was set is the learner's to read, and it is only
     ever asked for on the two turns that actually set one — a reply about a
     replacement, or about something they just asked, has no new problem to
     justify and would be inventing a rationale to fill the slot. */
  it("asks every turn that sets a challenge why this problem, and no other turn",()=>{
    const local=new Map<string,unknown[]>([["create_question",[{result:{status:"playable"}}]]]);
    for(const kind of ["session-start","cold-start","attempt-complete"] as const){
      expect(completionInstruction(kind,local)).toContain("why this problem and why now");
    }
    for(const kind of ["challenge-revision","learner-message"] as const){
      expect(completionInstruction(kind,local)).not.toContain("why this problem and why now");
    }
  });

  /* The reason has to come out of the solve the turn just read. An instruction
     that only said "explain your decision" is answered with the decision
     restated, which is what the problem panel's own disclosure already did. */
  it("points the attempt-complete reason at the replay rather than the verdict",()=>{
    const outcomes=new Map<string,unknown[]>([["read_attempt",[{result:{log:[]}}]]]);
    const instruction=completionInstruction("attempt-complete",outcomes);
    expect(instruction).toContain("you have just read the solve");
    expect(instruction).toContain("what that left you unsure of");
  });

  it("stops requiring retrieval once the ledger has answered with nothing", () => {
    /* A Track with no evidence has no abilities, no attempts, and therefore no
       challenges either. Asking all three was three forced round-trips to be
       told "nothing" three times, which the learner watches go past. */
    const empty = { result: { passages: [] } };
    const outcomes = new Map<string, unknown[]>([["search_learner_model", [empty]]]);
    const stage = nextToolStage("session-start", outcomes, 15, {});
    expect(stage.activeTools).not.toContain("search_attempt_history");
    expect(stage.activeTools).not.toContain("search_challenge_history");
    // It has moved on to the work, not stalled.
    expect(stage.activeTools).toContain("set_session_objective");
  });

  it("keeps retrieving while any stage has found something", () => {
    // One hit means the ledger has something to say; the rest earn their trip.
    const outcomes = new Map<string, unknown[]>([["search_learner_model", [{ result: { passages: [{ id: "a" }] } }]]]);
    expect(nextToolStage("session-start", outcomes, 15, {}).activeTools).toEqual(["search_attempt_history"]);
  });

  it("does not stop early on a result shape it cannot read", () => {
    // The conservative direction is to keep retrieving, never to skip on a guess.
    const outcomes = new Map<string, unknown[]>([["search_learner_model", [{ result: "unexpected" }]]]);
    expect(nextToolStage("session-start", outcomes, 15, {}).activeTools).toEqual(["search_attempt_history"]);
  });

  it("bounds cold-start retrieval the same way", () => {
    const outcomes = new Map<string, unknown[]>([["search_learner_model", [{ result: { passages: [] } }]]]);
    expect(nextToolStage("cold-start", outcomes, 15, {}).activeTools).toEqual(["ask_user_question"]);
  });

  it("continues the cold-start run after the learner answers", () => {
    const outcomes = new Map<string, unknown[]>([
      ["search_learner_model", [{ result: { passages: [] } }]],
      ["search_attempt_history", [{ result: { attempts: [] } }]],
      ["ask_user_question", [{ result: { pending: false, status: "answered", answer: "Some Python" } }]],
    ]);
    expect(nextToolStage("cold-start", outcomes, 15, {}).activeTools).toEqual(["set_session_objective"]);
  });

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
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: ["read_attempt"], toolChoice: "required" });
    outcomes.set("read_attempt", [{ result: { report: "SOLVE REPLAY" } }]);
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: ["set_training_target"], toolChoice: "required" });
    outcomes.set("set_training_target", [{ result: { committed: true } }]);
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: ["replace_current_question"], toolChoice: "required" });
    outcomes.set("replace_current_question", [{ result: { status: "playable" } }]);
    expect(nextToolStage("challenge-revision", outcomes, 15, { hasActiveQuestion: true })).toEqual({ activeTools: [], toolChoice: "none" });
  });

  it("exposes one deterministic action at a time", () => {
    expect(nextToolStage("session-start", new Map()).activeTools).toEqual(["search_learner_model"]);
    expect(nextToolStage("attempt-complete", new Map()).activeTools).toEqual(["read_attempt"]);
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
          for (const practiceSource of [false, true]) {
            const built = allowedTools(turnKind, hasActiveQuestion, webSearch, practiceSource);
            const staged = [...reachableStages(turnKind, hasActiveQuestion, webSearch, practiceSource)];
            expect(staged.filter((name) => !built.has(name)), `${turnKind} (activeQuestion=${hasActiveQuestion}, web=${webSearch}, source=${practiceSource})`).toEqual([]);
          }
        }
      }
    }
  });

  /**
   * The visualiser is a skill: one line of context until it is wanted.
   *
   * Both halves matter. Offering the four working tools up front would put their
   * schemas and the briefing behind them in every turn Spar runs, which is what
   * the gate exists to avoid. Never offering them would make the gate a tool
   * whose result the agent cannot act on.
   */
  describe("the execution visualiser", () => {
    const chat = (outcomes: Array<[string, unknown[]]> = []) => nextToolStage("learner-message", new Map(outcomes), 15, { hasActiveQuestion: true }).activeTools;

    it("offers only the gate on an ordinary turn", () => {
      const offered = chat();
      expect(offered).toContain(VISUALIZER_GATE);
      expect(offered.filter((name) => VISUALIZER_SKILL_TOOLS.includes(name))).toEqual([]);
    });

    it("offers the whole toolkit once the gate has answered", () => {
      const offered = chat([[VISUALIZER_GATE, [{ result: { loaded: true } }]]]);
      for (const tool of VISUALIZER_TOOLS) expect(offered).toContain(tool);
    });

    /* Same rule as every other staged tool: staging one the turn never built is
       a silent retry loop rather than an error. */
    it("builds every visualiser tool it can stage", () => {
      for (const turnKind of ["learner-message", "attempt-complete"] as AgentTurnKind[]) {
        const built = allowedTools(turnKind, true, false, false);
        for (const tool of VISUALIZER_TOOLS) expect(built.has(tool), `${turnKind} builds ${tool}`).toBe(true);
      }
    });

    /**
     * The attempt-complete turn is the other place it belongs, and its stage
     * machine is fully deterministic — so the visualiser rides alongside a
     * required tool rather than as a stage the model could decline, which would
     * end the turn before the ability was ever updated.
     */
    it("offers the visualiser beside the ability update, once the evidence is in hand", () => {
      const graded = (extra: Array<[string, unknown[]]> = []) => new Map<string, unknown[]>([
        ["read_attempt", [{ result: {} }]],
        ["review_solution", [{ result: { review: "accepted" } }]],
        ["read_ability", [{ result: {} }]],
        ...extra,
      ]);
      const stage = nextToolStage("attempt-complete", graded());
      expect(stage.toolChoice).toBe("required");
      expect(stage.activeTools).toEqual([VISUALIZER_GATE, "propose_ability_update"]);
      // Taking the offer does not lose the required tool, so the phase still advances.
      expect(nextToolStage("attempt-complete", graded([[VISUALIZER_GATE, [{ result: {} }]]])).activeTools)
        .toEqual([...VISUALIZER_SKILL_TOOLS, "propose_ability_update"]);
    });

    /* Offered beside a required tool, the usual "you already called this"
       withdrawal does not apply — so a call budget is what stops a turn
       spending itself on the visualiser instead of on the learner's record.
       Deliberately not "stop once it has drawn something": being asked to draw
       it again is a normal thing to happen straight after a diagram, and a turn
       that answers that by saying the visualiser is gone is the worse failure. */
    it("stops offering it once the turn has spent its budget on it", () => {
      const graded: Array<[string, unknown[]]> = [
        ["read_attempt", [{ result: {} }]], ["review_solution", [{ result: { review: "accepted" } }]],
        ["read_ability", [{ result: {} }]],
      ];
      const spend = (calls: number) => new Map<string, unknown[]>([
        ...graded,
        [VISUALIZER_GATE, [{ result: {} }]],
        ["visualize_run", Array.from({ length: calls }, () => ({ result: {} }))],
      ]);
      expect(nextToolStage("attempt-complete", spend(1)).activeTools).toContain("visualize_explain");
      expect(nextToolStage("attempt-complete", spend(12)).activeTools).toEqual(["propose_ability_update"]);
    });

    /* A turn whose job is to set a challenge has nothing to visualise and a
       learner who is not looking at the conversation yet. */
    it("stays out of the turns that only set up a session", () => {
      expect(allowedTools("cold-start").has(VISUALIZER_GATE)).toBe(false);
      expect(allowedTools("session-start").has(VISUALIZER_GATE)).toBe(false);
    });
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
    /* A ledger with something in it: the repetition this stage exists to prevent
       is only possible once there is a history to repeat. An empty ledger takes
       the bounded path instead, which is asserted separately. */
    const outcomes = new Map<string, unknown[]>([["search_learner_model", [{ result: { passages: [{ id: "ability" }] } }]], ["search_attempt_history", [{ result: { attempts: [] } }]]]);
    expect(nextToolStage("session-start", outcomes).activeTools).toEqual(["search_challenge_history"]);
  });

  it("reads the solve before judging it, and lets a question replace the next target", () => {
    const outcomes = new Map<string, unknown[]>();
    const stage = () => nextToolStage("attempt-complete", outcomes);
    const settle = (name: string) => outcomes.set(name, [{ result: { ok: true } }]);

    /* How it was solved is read first, in one call — the log, the code and the
       runner's verdict used to be three required stages and three round trips
       against the same attempt — and everything after it judges that reading. */
    expect(stage().activeTools).toEqual(["read_attempt"]);
    settle("read_attempt");
    /* Then the judgement about how it was written, still before anything is
       written down, because a solution that is about to be sent back has no
       ability update and no next challenge to its name. */
    expect(stage().activeTools).toEqual(["review_solution"]);
    for (const name of ["review_solution", "read_ability", "propose_ability_update", "commit_session_decision", "search_learner_model", "search_concept_evidence"]) settle(name);

    // The stage with the choices: aim the next question, ask about what the
    // trace could not explain, or teach the thing the solve showed they lack.
    expect(stage()).toEqual({ activeTools: ["ask_user_question", ...TEACH_TOOLS, "set_training_target"], toolChoice: "required" });
    settle("set_training_target");
    expect(stage().activeTools).toEqual([...TEACH_TOOLS, "create_question"]);
  });

  it("continues the same turn from an answered question before publishing a challenge", () => {
    const outcomes = new Map<string, unknown[]>();
    for (const name of ["read_attempt", "review_solution", "read_ability", "propose_ability_update", "commit_session_decision", "search_learner_model", "search_concept_evidence"]) {
      outcomes.set(name, [{ result: { ok: true } }]);
    }
    outcomes.set("ask_user_question", [{ result: { pending: false, status: "answered", answer: "The shrink ran only once" } }]);

    expect(nextToolStage("attempt-complete", outcomes)).toEqual({ activeTools: [...TEACH_TOOLS, "set_training_target"], toolChoice: "required" });
  });

  it("exhausts challenge authoring after the first rejected public candidate", () => {
    const outcomes = new Map<string, unknown[]>([
      ["search_learner_model", [{ result: { passages: [] } }]],
      ["search_attempt_history", [{ result: { attempts: [] } }]],
      ["search_challenge_history", [{ result: { challenges: [] } }]],
      ["set_session_objective", [{ result: { committed: true } }]],
      ["set_training_target", [{ result: { committed: true } }]],
      ["create_question", [{ result: { status: "invalid" } }]],
    ]);
    const stage = nextToolStage("session-start", outcomes);
    expect(stage.activeTools).toEqual([]);
    expect(stage.exhausted?.attempts).toBe(1);
  });

  it("reports compiler failure details when an explicit authoring budget is exhausted", () => {
    const rejected = { result: { status: "invalid", report: { checks: [{ name: "reference solution", passed: false, detail: "exit 1" }] } } };
    const outcomes = new Map<string, unknown[]>([["create_question", Array.from({ length: 3 }, () => rejected)]]);
    const stage = nextToolStage("session-start", outcomes, 3);
    // The controller falls back to a host-authored challenge from here, so the
    // budget running out must be reportable state rather than a thrown error.
    expect(stage.exhausted).toMatchObject({ attempts: 3 });
    expect(stage.exhausted?.failure).toContain("reference solution: exit 1");
    expect(stage.activeTools).toEqual([]);
  });

  it("allows only one question compiler invocation per phase, even when the provider changes the payload", () => {
    expect(phaseExecutionKey("create_question", '{"title":"Count positives"}')).toBe("create_question");
    expect(phaseExecutionKey("create_question", '{"title":"Count values above a threshold"}')).toBe("create_question");
    expect(phaseExecutionKey("search_learner_model", '{"query":"arrays"}')).not.toBe(phaseExecutionKey("search_learner_model", '{"query":"loops"}'));
  });

  it("collapses create and replace into one challenge-authoring mutation per turn", () => {
    expect(turnExecutionKey("create_question")).toBe("challenge-authoring");
    expect(turnExecutionKey("replace_current_question")).toBe("challenge-authoring");
    expect(turnExecutionKey("read_ability")).toBeNull();
  });
});

/**
 * The practice source, as the controller sees it.
 *
 * These are the tests behind the claim that Spar "uses real problems when they
 * fit". The claim is a property of the stage machine rather than of the prompt:
 * the agent is made to look at the source before it decides, and then made to
 * choose between assigning what it found and writing its own. A model that
 * ignores its instructions cannot skip either step.
 */
describe("practice sources in the stage machine", () => {
  const targeted = () => new Map<string, unknown[]>([
    ["search_learner_model", [{ result: { passages: [] } }]],
    ["search_attempt_history", [{ result: { attempts: [] } }]],
    ["search_challenge_history", [{ result: { challenges: [] } }]],
    ["set_session_objective", [{ result: { committed: true } }]],
    ["read_concept_graph", [{ result: { concepts: [] } }]],
    ["set_training_target", [{ result: { committed: true } }]],
  ]);

  it("makes a planning turn look at the source before it sets a challenge", () => {
    expect(nextToolStage("session-start", targeted(), 15, { practiceSource: true })).toEqual({
      activeTools: ["search_practice_problems"],
      toolChoice: "required",
    });
  });

  it("then makes it choose between a real problem and one of its own", () => {
    const outcomes = targeted();
    outcomes.set("search_practice_problems", [{ result: { problems: [{ slug: "two-sum" }] } }]);
    const stage = nextToolStage("session-start", outcomes, 15, { practiceSource: true });
    // Both, and required: the turn cannot end in prose, and it cannot write its
    // own challenge without having seen what the source has.
    expect(stage).toEqual({ activeTools: [...TEACH_TOOLS, "assign_practice_problem", "create_question"], toolChoice: "required" });
  });

  it("asks for neither when no source is connected", () => {
    const stage = nextToolStage("session-start", targeted(), 15, {});
    expect(stage).toEqual({ activeTools: [...TEACH_TOOLS, "create_question"], toolChoice: "required" });
  });

  it("ends the turn once a real problem is assigned", () => {
    const outcomes = targeted();
    outcomes.set("search_practice_problems", [{ result: { problems: [] } }]);
    outcomes.set("assign_practice_problem", [{ result: { status: "playable" } }]);
    expect(nextToolStage("session-start", outcomes, 15, { practiceSource: true })).toEqual({ activeTools: [], toolChoice: "none" });
  });

  it("counts a refused assignment against the same budget a rejected candidate spends", () => {
    // A source that keeps refusing — every candidate already solved, every
    // problem subscription-only — would otherwise loop past the budget that
    // exists to stop exactly that.
    const outcomes = targeted();
    outcomes.set("search_practice_problems", [{ result: { problems: [] } }]);
    outcomes.set("assign_practice_problem", [1, 2, 3].map(() => ({ result: { status: "invalid", report: { checks: [{ name: "adaptive progression", passed: false, detail: "already set" }] } } })));
    const stage = nextToolStage("session-start", outcomes, 3, { practiceSource: true });
    expect(stage.exhausted).toMatchObject({ attempts: 3 });
    expect(stage.activeTools).toEqual([]);
  });

  it("makes an attempt-complete turn consult the source too, after it has read the solve", () => {
    const outcomes = new Map<string, unknown[]>([
      ["read_attempt", [{ result: { report: "log" } }]],
      ["review_solution", [{ result: { review: "accepted" } }]],
      ["read_ability", [{ result: {} }]],
      ["propose_ability_update", [{ result: { committed: true } }]],
      ["commit_session_decision", [{ result: { committed: true } }]],
      ["search_learner_model", [{ result: { passages: [] } }]],
      ["search_concept_evidence", [{ result: { concepts: [] } }]],
      ["set_training_target", [{ result: { committed: true } }]],
    ]);
    expect(nextToolStage("attempt-complete", outcomes, 15, { practiceSource: true }).activeTools).toEqual(["search_practice_problems"]);
    outcomes.set("search_practice_problems", [{ result: { problems: [] } }]);
    expect(nextToolStage("attempt-complete", outcomes, 15, { practiceSource: true }).activeTools).toEqual([...TEACH_TOOLS, "assign_practice_problem", "create_question"]);
  });

  it("offers the whole source mid-challenge, assignment included", () => {
    /* "Is this like anything I have done?" is a question about the problem in front
       of them, and "just give me a real LeetCode problem instead" is a request this
       turn can carry out. Withholding the assignment here left the agent one legal
       way to answer the second one: write its own challenge, name it after the
       problem it could not assign, and grade it locally. Whether the swap is
       allowed is the tool's judgement — it refuses unless the agent states that the
       learner asked to be moved — not something to decide by hiding the tool. */
    const stage = nextToolStage("learner-message", new Map(), 15, { hasActiveQuestion: true, practiceSource: true });
    expect(stage.activeTools).toContain("read_practice_problem");
    expect(stage.activeTools).toContain("read_practice_submissions");
    expect(stage.activeTools).toContain("assign_practice_problem");
    // Replacing a challenge in place is still the only way to edit one.
    expect(stage.activeTools).toContain("replace_current_question");
    expect(stage.activeTools).not.toContain("create_question");
  });

  /* The review is the only stage that can end an attempt-complete turn early,
     and it has to be able to: everything after it is a record of a finished
     attempt, and the attempt has just been reopened. */
  it("ends the turn when the review sends the solution back", () => {
    const outcomes = new Map<string, unknown[]>([
      ["read_attempt", [{ result: {} }]],
      ["review_solution", [{ result: { review: "rework", reopened: true } }]],
    ]);
    expect(nextToolStage("attempt-complete", outcomes)).toEqual({ activeTools: [], toolChoice: "none" });
  });

  it("carries on through the record when the review accepts", () => {
    const outcomes = new Map<string, unknown[]>([
      ["read_attempt", [{ result: {} }]],
      ["review_solution", [{ result: { review: "accepted" } }]],
    ]);
    expect(nextToolStage("attempt-complete", outcomes).activeTools).toEqual(["read_ability"]);
  });

  it("makes a revision turn choose between a real problem and one it writes", () => {
    // The likeliest moment for a real problem to be the right answer is the moment
    // the learner says this one is not what they want.
    const done = new Map<string, unknown[]>([
      ["read_attempt", [{}]],
      ["set_training_target", [{}]],
      ["search_practice_problems", [{}]],
    ]);
    const stage = nextToolStage("challenge-revision", done, 15, { hasActiveQuestion: true, practiceSource: true });
    expect(stage.toolChoice).toBe("required");
    expect(stage.activeTools).toEqual(["assign_practice_problem", "replace_current_question"]);
  });

  it("looks at what the source has before writing a replacement", () => {
    const done = new Map<string, unknown[]>([["read_attempt", [{}]], ["set_training_target", [{}]]]);
    const stage = nextToolStage("challenge-revision", done, 15, { hasActiveQuestion: true, practiceSource: true });
    expect(stage.activeTools).toEqual(["search_practice_problems"]);
  });

  it("never offers the agent a tool that would run or submit on the learner's account", () => {
    // The learner solves the problem and the learner decides when to submit it.
    for (const turnKind of TURN_KINDS) {
      for (const hasActiveQuestion of [false, true]) {
        const built = allowedTools(turnKind, hasActiveQuestion, true, true);
        expect([...built].filter((name) => name === "run_practice_code" || name === "submit_practice_solution"), turnKind).toEqual([]);
      }
    }
  });
});


/**
 * The other thing a turn can hand over.
 *
 * Asserted as a property of the stage machine rather than of the prompt: a turn
 * that taught is not *encouraged* to stop setting a challenge, it is no longer
 * staged to set one. That distinction is the whole feature — an instruction the
 * model may ignore would leave the old behaviour intact on the turns that matter.
 */
describe("teaching", () => {
  const taught = () => [{ result: { status: "taught", lessonId: "l1", title: "Aliasing" } }];
  const complete = (extra: Record<string, unknown[]> = {}) => new Map<string, unknown[]>([
    ...["read_attempt", "review_solution", "read_ability", "propose_ability_update", "commit_session_decision", "search_learner_model", "search_concept_evidence", "ask_user_question", "set_training_target"]
      .map((name) => [name, [{ result: { ok: true } }]] as [string, unknown[]]),
    ...Object.entries(extra),
  ]);

  it("ends a turn that taught instead of making it set a challenge", () => {
    expect(nextToolStage("attempt-complete", complete()).activeTools).toEqual([...TEACH_TOOLS, "create_question"]);
    expect(nextToolStage("attempt-complete", complete({ teach_lesson: taught() }))).toEqual({ activeTools: [], toolChoice: "none" });
  });

  it("still requires a challenge when the lesson was not actually written", () => {
    /* A rejected lesson is a failed call, not a turn's teaching. The old
       behaviour has to survive every path that did not end in a filed lesson. */
    const rejected = [{ result: { status: "invalid", report: { valid: false } } }];
    expect(nextToolStage("attempt-complete", complete({ teach_lesson: rejected })).activeTools).toEqual([...TEACH_TOOLS, "create_question"]);
  });

  it("offers the kit where the choice is actually made, and withdraws it once used", () => {
    const outcomes = complete();
    outcomes.delete("set_training_target");
    expect(nextToolStage("attempt-complete", outcomes).activeTools).toEqual([...TEACH_TOOLS, "set_training_target"]);
    outcomes.set("teach_lesson", taught());
    // One turn teaches one thing: the tools go the moment a lesson lands.
    expect(nextToolStage("attempt-complete", outcomes).activeTools).toEqual(["set_training_target"]);
  });

  it("is still offered at the stage that would otherwise require a challenge", () => {
    /* The bug this pins. Offering the kit only beside `set_training_target`
       meant the choice was put to the turn one stage before it could see what it
       was about to test, and a first session on a brand new subject answered
       that stage with the tool it required and went on to set a problem. The
       turn has to be able to teach at the moment the next call is the
       challenge. */
    const opened = new Map<string, unknown[]>([
      ...["search_learner_model", "search_attempt_history", "search_challenge_history", "read_ability", "set_session_objective", "read_concept_graph", "set_training_target"]
        .map((name) => [name, [{ result: { ok: true } }]] as [string, unknown[]]),
    ]);
    expect(nextToolStage("session-start", opened).activeTools).toEqual([...TEACH_TOOLS, "create_question"]);
    opened.set("teach_lesson", taught());
    expect(nextToolStage("session-start", opened)).toEqual({ activeTools: [], toolChoice: "none" });
  });

  it("is reachable on an ordinary turn, because 'I still don't get this' is one", () => {
    expect(nextToolStage("learner-message", new Map()).activeTools).toEqual(expect.arrayContaining(TEACH_TOOLS));
  });
});

describe("what a turn that taught says", () => {
  const taught = new Map<string, unknown[]>([["teach_lesson", [{ result: { status: "taught", lessonId: "l1" } }]]]);

  it("asks for the reference and refuses the restatement", () => {
    const text = completionInstruction("attempt-complete", taught);
    expect(text).toContain("[[lesson:");
    expect(text).toContain("do not restate its pages");
  });

  it("does not ask why this problem, because no problem was set", () => {
    expect(completionInstruction("attempt-complete", taught)).not.toContain("why this problem");
    expect(completionInstruction("attempt-complete", new Map())).toContain("why this problem");
  });
});
