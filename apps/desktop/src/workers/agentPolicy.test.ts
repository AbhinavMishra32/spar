import { describe, expect, it } from "vitest";
import { CHALLENGE_PUBLISHING_TOOLS, coachTools, CORE_TOOLS, publishedChallenge, SKILL_TOOL, SOURCE_TOOLS, VISUALIZER_TOOLS, WEB_TOOLS, type AgentTurnKind, type Outcomes } from "./agentPolicy.js";

const kinds: AgentTurnKind[] = ["cold-start", "session-start", "attempt-complete", "learner-message"];
const outcomes = (entries: Record<string, unknown[]>): Outcomes =>
  new Map(Object.entries(entries).map(([name, results]) => [name, results.map((result) => ({ input: {}, result }))]));

describe("coachTools", () => {
  it("always offers the core tools and the visualiser", () => {
    const tools = coachTools({});
    for (const name of [...CORE_TOOLS, ...VISUALIZER_TOOLS]) expect(tools.has(name)).toBe(true);
  });

  it("offers web tools only when web search is configured", () => {
    for (const name of WEB_TOOLS) {
      expect(coachTools({}).has(name)).toBe(false);
      expect(coachTools({ webSearch: false }).has(name)).toBe(false);
      expect(coachTools({ webSearch: true }).has(name)).toBe(true);
    }
  });

  it("offers source tools only with a practice source, and never runs or submits there", () => {
    for (const name of SOURCE_TOOLS) {
      expect(coachTools({}).has(name)).toBe(false);
      expect(coachTools({ practiceSource: true }).has(name)).toBe(true);
    }
    const connected = coachTools({ practiceSource: true });
    expect(connected.has("run_practice_problem")).toBe(false);
    expect(connected.has("submit_practice_problem")).toBe(false);
  });

  it("offers set_challenge unless Spar authoring is switched off", () => {
    expect(coachTools({}).has("set_challenge")).toBe(true);
    expect(coachTools({ sparAuthoring: true }).has("set_challenge")).toBe(true);
    const providerOnly = coachTools({ sparAuthoring: false, practiceSource: true });
    expect(providerOnly.has("set_challenge")).toBe(false);
    expect(providerOnly.has("assign_practice_problem")).toBe(true);
  });

  it("offers load_skill only when skills exist", () => {
    expect(coachTools({}).has(SKILL_TOOL)).toBe(false);
    expect(coachTools({ skills: true }).has(SKILL_TOOL)).toBe(true);
  });

  it("does not offer tools removed with the phase table", () => {
    const tools = coachTools({ webSearch: true, practiceSource: true, skills: true });
    for (const name of ["read_session", "create_question", "replace_current_question", "set_training_target", "commit_session_decision", "propose_ability_update"]) expect(tools.has(name)).toBe(false);
  });
});

describe("publishedChallenge", () => {
  it("counts only a playable result from a publishing tool", () => {
    for (const name of CHALLENGE_PUBLISHING_TOOLS) {
      expect(publishedChallenge(outcomes({ [name]: [{ status: "playable" }] }))).toBe(true);
      expect(publishedChallenge(outcomes({ [name]: [{ status: "invalid" }] }))).toBe(false);
    }
    expect(publishedChallenge(outcomes({ teach_lesson: [{ status: "playable" }] }))).toBe(false);
    expect(publishedChallenge(outcomes({ set_challenge: [{ status: "invalid" }, { status: "playable" }] }))).toBe(true);
  });
});
