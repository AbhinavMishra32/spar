export type AgentTurnKind = "cold-start" | "session-start" | "attempt-complete" | "learner-message";

/** Optional external research, offered only when configured. */
export const WEB_TOOLS = ["web_search", "web_fetch"];

/** The execution visualiser: a briefing behind `open_visualizer`, and the four
 *  tools that do the work. All five are always in the table; the briefing is
 *  what makes them worth calling well. */
export const VISUALIZER_GATE = "open_visualizer";
export const VISUALIZER_SKILL_TOOLS = ["visualize_run", "visualize_read_step", "visualize_find", "visualize_explain"];
export const VISUALIZER_TOOLS = [VISUALIZER_GATE, ...VISUALIZER_SKILL_TOOLS];

/** Skills are instructions on disk the coach pulls in by name. */
export const SKILL_TOOL = "load_skill";

/**
 * Reading a practice source, and setting one of its problems. The coach may
 * learn anything the source knows and set the learner a problem from it, but it
 * never runs or submits code there.
 */
export const SOURCE_READ_TOOLS = ["search_practice_problems", "read_practice_problem", "read_practice_source", "read_practice_progress", "read_practice_submissions"];
export const SOURCE_TOOLS = [...SOURCE_READ_TOOLS, "assign_practice_problem"];

/** The coach's own tools, offered on every turn. */
export const CORE_TOOLS = [
  "read_attempt", "read_submissions", "search_record", "read_record",
  "update_ability", "update_notebook", "set_challenge_mix", "record_insight", "file_review", "reopen_challenge", "review_solution",
  "ask_user_question", "teach_lesson", ...VISUALIZER_TOOLS,
];

/**
 * The tools a turn is offered: decided once, from what the session and the
 * machine allow, and then fixed for the whole turn.
 *
 * There is no per-phase table any more. The coach decides what to do and in
 * what order; a tool that does not apply right now answers with why. Keeping the
 * list stable is also what keeps the provider's prompt cache warm across the
 * model requests of one turn.
 */
export function coachTools(context: { webSearch?: boolean; practiceSource?: boolean; sparAuthoring?: boolean; skills?: boolean }): Set<string> {
  return new Set([
    ...CORE_TOOLS,
    ...(context.sparAuthoring !== false ? ["set_challenge", "edit_challenge"] : []),
    ...(context.practiceSource ? SOURCE_TOOLS : []),
    ...(context.webSearch ? WEB_TOOLS : []),
    ...(context.skills ? [SKILL_TOOL] : []),
  ]);
}

/**
 * Every tool the coach is declared, the same in every turn of every session.
 * What this turn allows is `coachTools`; the declaration is fixed because a
 * conversation is continued across turns, and a tool list that changed with
 * the web key or a provider sign-in would break the provider's cache of
 * everything after it. A call to one this turn does not allow says why.
 */
export const DECLARED_TOOLS = coachTools({ webSearch: true, practiceSource: true, sparAuthoring: true, skills: true });

/** Why a declared tool is not available this turn, in words the coach can pass on. */
export function unavailableTool(name: string): string {
  if (WEB_TOOLS.includes(name)) return `${name} is not available right now: there is no web search key, or the learner turned web search off.`;
  if (SOURCE_TOOLS.includes(name)) return `${name} is not available right now: no practice provider is connected for this session.`;
  if (name === "set_challenge" || name === "edit_challenge") return `${name} is not available in this session: the learner set it to real problems only, so Spar does not write challenges here.`;
  if (name === SKILL_TOOL) return "load_skill is not available: no skills are enabled.";
  return `${name} is not available right now.`;
}

/** The tools that can put a playable challenge in front of the learner. */
export const CHALLENGE_PUBLISHING_TOOLS = ["set_challenge", "assign_practice_problem", "reopen_challenge"];

export type Outcomes = Map<string, Array<{ input: unknown; result: unknown }>>;

const resultOf = (entry: { result: unknown } | undefined) => (entry?.result && typeof entry.result === "object" ? entry.result as Record<string, unknown> : {});

/** Whether any result this turn made a challenge playable. */
export function publishedChallenge(outcomes: Outcomes): boolean {
  return CHALLENGE_PUBLISHING_TOOLS.some((name) => (outcomes.get(name) ?? []).some((entry) => resultOf(entry).status === "playable"));
}
