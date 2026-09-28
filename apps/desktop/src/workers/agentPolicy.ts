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

/** The tools that can put a playable challenge in front of the learner. */
export const CHALLENGE_PUBLISHING_TOOLS = ["set_challenge", "assign_practice_problem", "reopen_challenge"];

export type Outcomes = Map<string, Array<{ input: unknown; result: unknown }>>;

const resultOf = (entry: { result: unknown } | undefined) => (entry?.result && typeof entry.result === "object" ? entry.result as Record<string, unknown> : {});

/** Whether any result this turn made a challenge playable. */
export function publishedChallenge(outcomes: Outcomes): boolean {
  return CHALLENGE_PUBLISHING_TOOLS.some((name) => (outcomes.get(name) ?? []).some((entry) => resultOf(entry).status === "playable"));
}

/**
 * Whether the turn is about to end owing the learner a next step.
 *
 * One case only: the learner just finished an attempt, nothing is open, and the
 * turn neither set a challenge nor taught a lesson. The coach gets one reminder
 * — it usually just read a rejection as news to report — and after that its
 * judgement stands. A review that sent the solution back reopens the challenge,
 * and a question the learner dismissed is an answer; neither owes anything.
 */
export function owesChallenge(turnKind: AgentTurnKind, outcomes: Outcomes, hasActiveQuestion: boolean): boolean {
  if (turnKind !== "attempt-complete" || hasActiveQuestion) return false;
  if (publishedChallenge(outcomes)) return false;
  if (resultOf(outcomes.get("review_solution")?.at(-1)).review === "rework") return false;
  if (resultOf(outcomes.get("ask_user_question")?.at(-1)).status === "cancelled") return false;
  if ((outcomes.get("teach_lesson") ?? []).some((entry) => resultOf(entry).status === "taught")) return false;
  return true;
}
