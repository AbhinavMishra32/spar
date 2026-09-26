import { describe, expect, it } from "vitest";
import { allowedTools, completionInstruction, nextToolStage, owedChallenge, phaseExecutionKey, VISUALIZER_GATE, VISUALIZER_SKILL_TOOLS, type AgentTurnKind } from "./agentPolicy.js";

const kinds: AgentTurnKind[] = ["cold-start", "session-start", "attempt-complete", "learner-message"];
const result = (status: string) => [{ result: { status } }];

describe("generalist agent tool policy", () => {
  it("offers a choice instead of forcing a tool sequence for every turn", () => {
    for (const kind of kinds) {
      const stage = nextToolStage(kind, new Map());
      expect(stage.toolChoice).toBe("auto");
      expect(stage.activeTools).toEqual(expect.arrayContaining(["set_session_objective", "set_training_target", "create_question", "teach_lesson", "ask_user_question"]));
      expect(stage.activeTools).not.toContain("read_session");
      expect(stage.activeTools).not.toContain("search_practice_problems");
    }
  });

  it("makes a correction to an active challenge possible without a text classifier", () => {
    for (const kind of kinds) {
      const priorObjective = new Map<string, unknown[]>([["set_session_objective", [{ committed: true, objective: "Old scope" }]]]);
      const stage = nextToolStage(kind, priorObjective, 1, { hasActiveQuestion: true });
      expect(stage.toolChoice).toBe("auto");
      expect(stage.activeTools).toEqual(expect.arrayContaining(["set_session_objective", "set_training_target", "replace_current_question"]));
      expect(stage.activeTools).not.toContain("create_question");
    }
  });

  it("offers source and web research only when configured, never as a prerequisite", () => {
    const plain = nextToolStage("session-start", new Map());
    expect(plain.activeTools).not.toContain("web_search");
    expect(plain.activeTools).not.toContain("search_practice_problems");
    const connected = nextToolStage("session-start", new Map(), 1, { webSearch: true, practiceSource: true });
    expect(connected.toolChoice).toBe("auto");
    expect(connected.activeTools).toEqual(expect.arrayContaining(["web_search", "search_practice_problems", "read_practice_problem", "assign_practice_problem", "create_question"]));
    expect(connected.activeTools).not.toContain("run_practice_problem");
    expect(connected.activeTools).not.toContain("submit_practice_problem");
  });

  it("offers completed-attempt tools only for that event", () => {
    for (const kind of kinds) {
      const tools = allowedTools(kind);
      expect(tools.has("review_solution")).toBe(kind === "attempt-complete");
      expect(tools.has("propose_ability_update")).toBe(kind === "attempt-complete");
      expect(tools.has("commit_session_decision")).toBe(kind === "attempt-complete");
    }
  });

  it("can inspect an earlier question during planning without forcing the read", () => {
    for (const kind of kinds) expect(allowedTools(kind).has("read_challenge")).toBe(true);
    expect(nextToolStage("session-start", new Map()).toolChoice).toBe("auto");
  });

  it("continues from one answered question without asking it again", () => {
    const answered = new Map<string, unknown[]>([["ask_user_question", [{ result: { status: "answered", answer: "Python with real Minecraft references" } }]]]);
    const stage = nextToolStage("learner-message", answered);
    expect(stage.toolChoice).toBe("auto");
    expect(stage.activeTools).not.toContain("ask_user_question");
    expect(stage.activeTools).toContain("set_training_target");
  });

  it("exposes only the visualizer gate until it has been opened", () => {
    const initial = nextToolStage("learner-message", new Map()).activeTools;
    expect(initial).toContain(VISUALIZER_GATE);
    for (const name of VISUALIZER_SKILL_TOOLS) expect(initial).not.toContain(name);
    const opened = nextToolStage("learner-message", new Map([[VISUALIZER_GATE, result("loaded")]])).activeTools;
    expect(opened).not.toContain(VISUALIZER_GATE);
    for (const name of VISUALIZER_SKILL_TOOLS) expect(opened).toContain(name);
  });

  it("keeps teaching and evidence tools available around a published challenge", () => {
    for (const kind of kinds) {
      const afterLesson = nextToolStage(kind, new Map([["teach_lesson", result("taught")]]), 1, { hasActiveQuestion: true });
      expect(afterLesson.toolChoice).toBe("auto");
      expect(afterLesson.activeTools).toContain("replace_current_question");
      expect(afterLesson.activeTools).toContain("teach_lesson");
      for (const name of ["create_question", "replace_current_question", "assign_practice_problem"]) {
        const afterChallenge = nextToolStage(kind, new Map([[name, result("playable")]]));
        expect(afterChallenge.toolChoice).toBe("auto");
        expect(afterChallenge.activeTools).toContain("teach_lesson");
        expect(afterChallenge.activeTools).not.toContain("create_question");
        expect(afterChallenge.activeTools).not.toContain("replace_current_question");
        expect(afterChallenge.activeTools).not.toContain("assign_practice_problem");
      }
    }
    expect(nextToolStage("attempt-complete", new Map([["review_solution", [{ result: { review: "rework" } }]]])).activeTools).toContain("teach_lesson");
  });

  it("lets the agent revise a rejected candidate while keeping other teaching choices available", () => {
    const outcomes = new Map<string, unknown[]>([["create_question", [{ result: { status: "invalid", report: { checks: [{ name: "reference", passed: false, detail: "exit 1" }] } } }]]]);
    const stage = nextToolStage("session-start", outcomes, 2, { practiceSource: true });
    expect(stage.toolChoice).toBe("auto");
    expect(stage.activeTools).toContain("create_question");
    expect(stage.activeTools).toEqual(expect.arrayContaining(["teach_lesson", "assign_practice_problem", "search_practice_problems"]));
    outcomes.get("create_question")!.push({ result: { status: "invalid" } });
    expect(nextToolStage("session-start", outcomes, 2).activeTools).not.toContain("create_question");
  });

  it("lets the agent choose another problem or author one after a source refusal", () => {
    const outcomes = new Map<string, unknown[]>([["assign_practice_problem", result("already-solved")]]);
    const stage = nextToolStage("session-start", outcomes, 1, { practiceSource: true });
    expect(stage.toolChoice).toBe("auto");
    expect(stage.activeTools).toEqual(expect.arrayContaining(["assign_practice_problem", "create_question"]));
  });

  it("deduplicates compiler mutations within a phase", () => {
    expect(phaseExecutionKey("create_question", "one")).toBe("create_question");
    expect(phaseExecutionKey("replace_current_question", "two")).toBe("replace_current_question");
    expect(phaseExecutionKey("read_attempt", "one")).toBe("read_attempt:one");
  });

  it("describes only the artifact actually delivered", () => {
    const taught = new Map<string, unknown[]>([["teach_lesson", result("taught")]]);
    expect(completionInstruction("session-start", taught)).toContain("[[lesson:");
    const playable = new Map<string, unknown[]>([["replace_current_question", result("playable")]]);
    expect(completionInstruction("learner-message", playable)).toContain("why this problem and why now");
    expect(completionInstruction("learner-message", new Map())).not.toContain("why this problem and why now");
  });

  it("keeps an attempt-complete turn open until a next challenge is published", () => {
    const rejected = new Map<string, unknown[]>([["create_question", [{ result: { status: "invalid", report: { checks: [{ name: "reference solution", passed: false, detail: "expected: 2 | actual: 3" }] } } }]]]);
    const owed = owedChallenge("attempt-complete", rejected, false, "(1) reference solution: expected: 2 | actual: 3");
    expect(owed).toContain("expected: 2 | actual: 3");
    expect(owed).toContain("owes the learner their next challenge");
    /* An answered question is a result inside this same turn, not an ending. */
    expect(owedChallenge("attempt-complete", new Map([["ask_user_question", [{ result: { status: "answered", answer: "x" } }]]]), false)).not.toBe("");
    expect(owedChallenge("attempt-complete", new Map([["ask_user_question", [{ result: { status: "cancelled" } }]]]), false)).toBe("");
    expect(owedChallenge("attempt-complete", new Map([["review_solution", [{ result: { review: "rework" } }]]]), false)).toBe("");
    expect(owedChallenge("attempt-complete", new Map([["create_question", result("playable")]]), false)).toBe("");
    expect(owedChallenge("attempt-complete", new Map([["create_fallback_question", result("playable")]]), false)).toBe("");
  });

  it("owes a retry only on other turns that already tried to author", () => {
    expect(owedChallenge("learner-message", new Map(), false)).toBe("");
    expect(owedChallenge("session-start", new Map([["create_question", result("invalid")]]), false)).toContain("Call the authoring tool again");
    expect(owedChallenge("session-start", new Map([["create_question", result("invalid")]]), false, "(1) session lifecycle: already active")).toBe("");
  });

  it("closes authoring once the host fallback publishes and names it as a standard exercise", () => {
    const outcomes = new Map<string, unknown[]>([["create_question", result("invalid")], ["create_fallback_question", result("playable")]]);
    expect(nextToolStage("attempt-complete", outcomes, 3).activeTools).not.toContain("create_question");
    expect(completionInstruction("attempt-complete", outcomes)).toContain("standard local tracing exercise");
  });
});

describe("sessions that take provider problems only", () => {
  it("never offers the authoring tools", () => {
    for (const kind of kinds) {
      for (const active of [false, true]) {
        const tools = allowedTools(kind, active, false, true, false);
        expect(tools.has("create_question")).toBe(false);
        expect(tools.has("replace_current_question")).toBe(false);
        expect(tools.has("assign_practice_problem")).toBe(true);
      }
    }
  });

  it("owes a provider problem after an attempt, quoting the last refusal", () => {
    const outcomes = new Map<string, unknown[]>([["assign_practice_problem", [{ result: { status: "invalid", report: { checks: [{ passed: false, detail: "subscription-only" }] } } }]]]);
    const owed = owedChallenge("attempt-complete", outcomes, false, "", false);
    expect(owed).toContain("assign_practice_problem");
    expect(owed).toContain("subscription-only");
    expect(owed).not.toContain("create_question");
    expect(owedChallenge("learner-message", new Map(), false, "", false)).toBe("");
  });
});
