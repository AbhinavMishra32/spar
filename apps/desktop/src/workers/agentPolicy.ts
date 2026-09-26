export type AgentTurnKind = "cold-start" | "session-start" | "attempt-complete" | "learner-message";
export type ToolStage = { activeTools: string[]; toolChoice: "required" | "auto" | "none" };

/**
 * What every turn that hands over a challenge owes the learner.
 *
 * Shared between the two turn kinds that set one so they cannot drift into
 * asking for different things, and written as one paragraph of prose rather than
 * a numbered list on purpose — an instruction shaped like a form is answered
 * with a form.
 */
const WHY_THIS_PROBLEM = "Before anything else, tell them why this problem and why now, in your own words and addressed to them. Name the specific thing that led you here and what it makes you want to find out, then say what solving this is worth later — the harder thing it is a rung on. Only claim what your evidence actually supports, and if it supports nothing about them yet, say what you are choosing from instead rather than inventing a history. Write it as one person talking to another about their own work: no heading over it, no \"what changed\" list, no restating the challenge title back at them, and never the same opening sentence twice in one session. Two or three sentences, and a reason they could not have guessed from the problem statement alone.";

/**
 * The final tool-free phase is part of teaching, not a receipt for a database
 * write.  Keeping this host-authored also makes provenance non-negotiable: a
 * locally authored prerequisite cannot be described as a real judge problem.
 *
 * It is also where a challenge is justified to the person who has to solve it.
 * That used to happen in the problem panel, under a disclosure called "Why this
 * problem" holding the target's own `specificGap` and `desiredEvidence` — which
 * is Spar's internal note to itself about what it is trying to find out, printed
 * at the learner in the vocabulary of a test plan. It said nothing about them.
 * A reason worth reading names the moment in their own last solve that produced
 * it, and only the turn that just read that solve is holding it.
 *
 * So the reason is asked for here, in the reply, and the phrasing below is
 * deliberately anti-formulaic: the failure mode of this instruction is not a
 * model that refuses to explain itself, it is a model that writes the same three
 * headings every turn until the explanation is furniture the learner scrolls
 * past. Naming the specific evidence is what stops that, because the evidence is
 * different every time.
 */
/**
 * What a turn that taught owes the learner instead.
 *
 * The failure mode this exists to prevent is the obvious one: a model that has
 * just written five pages and then writes those five pages again in prose,
 * because every instinct it has says a reply should contain the explanation. The
 * lesson is already on the screen. What the reply is for is the part the lesson
 * cannot carry — why this, for them, now — and the pointer that opens it.
 *
 * The reference is spelled out because it has to be exact: the id from the
 * result, not the title, not a paraphrase. A chip that resolves to nothing is
 * worse than the plain sentence it replaced.
 */
const TAUGHT_THIS_TURN = "You have written them a lesson and they can see it, so do not restate its pages. Say what made you teach this now, using what the learner told you or what their work shows, then point at the lesson as [[lesson:<the id the result returned>|its title]] and give one concrete thing to do with it. Two or three sentences. Never invent prior work or claim a lesson the result does not show you filed.";

/** Whether this turn filed a lesson, by the host's own account of it. */
function filedLesson(outcomes: Map<string, unknown[]>): boolean {
  return (outcomes.get("teach_lesson") ?? []).some((value) => Boolean(value && typeof value === "object" && (value as { result?: { status?: unknown } }).result?.status === "taught"));
}

export function completionInstruction(turnKind:AgentTurnKind,outcomes:Map<string,unknown[]>):string{
  const playable=(name:string)=>(outcomes.get(name)??[]).some((value)=>Boolean(value&&typeof value==="object"&&(value as {result?:{status?:unknown}}).result?.status==="playable"));
  if(playable("create_question")||playable("replace_current_question")||playable("assign_practice_problem")||playable("create_fallback_question")){
    /* The host's fallback is checked first because it is the one whose
       provenance is easiest to misstate: it is published after tailored
       candidates were rejected, so the turn's other outcomes all describe a
       challenge written for the learner that they did not get. */
    const provenance=playable("create_fallback_question")&&!playable("create_question")&&!playable("replace_current_question")&&!playable("assign_practice_problem")
      ? "A standard local tracing exercise, set by the host, is now playable. Call it a standard exercise rather than one written for their gap, say briefly what it will still show you about their reasoning, and never describe it as a real, sourced, or judged problem."
      : playable("assign_practice_problem")
      ? "A connected-provider problem is now playable. Name it as a provider problem only from the successful assignment result."
      : "A tailored local prerequisite challenge is now playable. Call it local and tailored; never describe it as a real, sourced, judged, Codeforces, or LeetCode problem.";
    return `${provenance} ${filedLesson(outcomes) ? "A lesson was also published; point to it using its returned lesson id without restating its pages. " : ""}${WHY_THIS_PROBLEM} Explain the choice using evidence actually available, including the learner's latest correction when relevant. Give one concrete first action. Do not provide the solution or merely report a database write.`;
  }
  if(filedLesson(outcomes))return TAUGHT_THIS_TURN;
  if(turnKind==="attempt-complete")return "Explain the evidence-backed learning decision from the completed attempt and the next useful step. Do not imply that a new challenge was set unless a tool result proves it.";
  return "Answer the learner concisely. State only changes supported by successful tool results.";
}

/** Optional external research, offered only when configured. */
export const WEB_TOOLS = ["web_search", "web_fetch"];

/**
 * Reading a practice source, and setting one of its problems.
 *
 * Split into reads and the one write for the same reason the MCP server splits
 * them: the agent may learn anything the source knows and may set the learner a
 * problem from it, but it may never run or submit code there. Those two tools
 * exist and are deliberately not in this list.
 *
 * Withheld entirely when no source is configured, so a learner who has connected
 * nothing does not pay a round trip per session for tools that can only answer
 * "not connected".
 */
/** Open the visualizer before its detailed tools are available. */
export const VISUALIZER_GATE = "open_visualizer";
export const VISUALIZER_SKILL_TOOLS = ["visualize_run", "visualize_read_step", "visualize_find", "visualize_explain"];
export const VISUALIZER_TOOLS = [VISUALIZER_GATE, ...VISUALIZER_SKILL_TOOLS];

/** The visualiser tools a stage may offer right now: the gate, plus the toolkit
 *  once the gate has answered. */
function visualizerStageTools(outcomes: Map<string, unknown[]>): string[] {
  return (outcomes.get(VISUALIZER_GATE)?.length ?? 0) > 0 ? VISUALIZER_TOOLS : [VISUALIZER_GATE];
}

/** Keep visualization work finite within a turn. */
const VISUALIZER_TURN_BUDGET = 8;

/** The visualizer toolkit is available after its gate responds. */
function visualizerOffer(outcomes: Map<string, unknown[]>): string[] {
  /* Bounded by calls, not by having drawn once. "Show me that again with the
     other input" is a reasonable thing to be asked immediately after a diagram,
     and a turn that answers it by saying the visualiser is gone is worse than a
     turn that spends two more calls. */
  const spent = VISUALIZER_TOOLS.reduce((total, name) => total + (outcomes.get(name)?.length ?? 0), 0);
  if (spent >= VISUALIZER_TURN_BUDGET) return [];
  const offered = visualizerStageTools(outcomes);
  // The gate answers once; asking again returns the same briefing.
  return (outcomes.get(VISUALIZER_GATE)?.length ?? 0) > 0 ? offered.filter((name) => name !== VISUALIZER_GATE) : offered;
}

/**
 * Skills are instructions on disk that the agent pulls in by name. Offered on
 * every turn that has at least one enabled skill; a turn may load several, but
 * not endlessly — past the budget the tool drops out of the table.
 */
export const SKILL_TOOL = "load_skill";
const SKILL_TURN_BUDGET = 4;

/** Teaching is available when the agent finds it useful. */
export const TEACH_TOOLS = ["teach_lesson", "read_lesson", "search_lessons"];

/** The agent may read, teach, and continue within its turn budget. */
function teachOffer(_outcomes: Map<string, unknown[]>): string[] {
  return TEACH_TOOLS;
}

export const SOURCE_READ_TOOLS = ["search_practice_problems", "read_practice_problem", "read_practice_source", "read_practice_progress", "read_practice_submissions"];
export const SOURCE_TOOLS = [...SOURCE_READ_TOOLS, "assign_practice_problem"];

/**
 * `sparAuthoring` is the session's own setting, not a fact about the machine.
 * When the learner deselects Spar-written problems the authoring tools are not
 * offered at all, so the only way to publish a challenge is to find one at a
 * provider — the host refuses them too, but a tool the model cannot see is one
 * it cannot spend a turn on.
 */
export function allowedTools(turnKind: AgentTurnKind, hasActiveQuestion = false, webSearch = false, practiceSource = false, sparAuthoring = true, skills = false): Set<string> {
  const web = webSearch ? WEB_TOOLS : [];
  const source = practiceSource ? SOURCE_TOOLS : [];
  const authoring = sparAuthoring ? (hasActiveQuestion ? ["replace_current_question"] : ["create_question"]) : [];
  // A session setup event has no solve to inspect. Keep its tool table small;
  // the agent still chooses freely among evidence, teaching, and challenge work.
  if (turnKind === "cold-start" || turnKind === "session-start") return new Set([
    ...TEACH_TOOLS, ...authoring, ...(skills ? [SKILL_TOOL] : []),
    ...source, ...web, "search_learner_model", "search_attempt_history",
    "search_challenge_history", "read_challenge", "read_ability", "read_concept_graph",
    "search_concept_evidence", "ask_user_question", "set_session_objective",
    "set_training_target",
  ]);
  return new Set([...VISUALIZER_TOOLS, ...TEACH_TOOLS,
    ...authoring, ...source, ...(skills ? [SKILL_TOOL] : []),
    "read_attempt", "read_submissions", "read_ability", "search_learner_model",
    "search_attempt_history", "search_challenge_history", "read_challenge",
    "read_concept_graph", "search_concept_evidence", "ask_user_question",
    "set_session_objective", "set_training_target", "upsert_ability", ...web,
    ...(turnKind === "attempt-complete" ? ["review_solution", "propose_ability_update", "record_insight", "commit_session_decision"] : []),
  ]);
}

/**
 * A compiler attempt is a phase-level operation, not a free-form model tool.
 * Providers can emit several differently-shaped create_question calls in one
 * response; only the first candidate may mutate the session in that phase.
 */
export function phaseExecutionKey(name: string, inputSignature: string): string {
  return name === "create_question" || name === "replace_current_question" ? name : `${name}:${inputSignature}`;
}

/** Tool availability follows durable state. The agent chooses actions and order. */
export function nextToolStage(turnKind: AgentTurnKind, outcomes: Map<string, unknown[]>, challengeCompilationLimit = 2, context: { hasActiveQuestion?: boolean; webSearch?: boolean; practiceSource?: boolean; sparAuthoring?: boolean; skills?: boolean } = {}): ToolStage {
  const authored = [...(outcomes.get("create_question") ?? []), ...(outcomes.get("replace_current_question") ?? [])];
  const assignments = outcomes.get("assign_practice_problem") ?? [];
  const playableQuestion = [...authored, ...assignments, ...(outcomes.get("create_fallback_question") ?? [])].some((value) => value && typeof value === "object" && (value as { result?: { status?: unknown } }).result?.status === "playable");
  const authoringSpent = authored.length >= challengeCompilationLimit;
  const available = allowedTools(turnKind, context.hasActiveQuestion, context.webSearch, context.practiceSource, context.sparAuthoring ?? true, context.skills ?? false);
  const offered = [...available].filter((name) => {
    if ((authoringSpent || playableQuestion) && (name === "create_question" || name === "replace_current_question")) return false;
    /* Once a problem is set, the search for one is over for this turn: the
       searching tools went on being offered, and a turn that had just set a
       problem spent sixteen more calls second-guessing it. */
    if (playableQuestion && (name === "assign_practice_problem" || name === "search_practice_problems" || name === "read_practice_problem")) return false;
    if (name === VISUALIZER_GATE) return visualizerOffer(outcomes).includes(name);
    if (VISUALIZER_SKILL_TOOLS.includes(name)) return visualizerOffer(outcomes).includes(name);
    if (TEACH_TOOLS.includes(name)) return teachOffer(outcomes).includes(name);
    if (name === "ask_user_question") return !(outcomes.get(name)?.length);
    if (name === SKILL_TOOL) return (outcomes.get(name)?.length ?? 0) < SKILL_TURN_BUDGET;
    /* With nothing else able to publish, a provider-only session gets a few more
       tries at finding a problem that mounts: a refusal there is usually one
       subscription-only or unparseable problem, not a sign to stop looking. */
    if (name === "assign_practice_problem") return assignments.length < (context.sparAuthoring === false ? 5 : 3);
    // Review and ability decisions are single outcomes. Objectives and targets
    // remain editable because the learner may correct them during this turn.
    if (["upsert_ability", "propose_ability_update", "commit_session_decision", "review_solution"].includes(name)) {
      return !(outcomes.get(name)?.length);
    }
    /* Filing an insight is for a solve that stands. After a rework verdict the
       challenge is open again and there is nothing solved to file yet; a card
       filed once is refined by the next solve, not by a second call now. */
    if (name === "record_insight") {
      const reworked = (outcomes.get("review_solution") ?? []).some((entry) => (entry as { result?: { review?: unknown } } | null)?.result?.review === "rework");
      return !reworked && !(outcomes.get(name) ?? []).some((entry) => (entry as { result?: { status?: unknown } } | null)?.result?.status === "filed");
    }
    return true;
  });
  return { activeTools: offered, toolChoice: "auto" };
}

/** The tools that can put a playable challenge in front of the learner. */
export const CHALLENGE_PUBLISHING_TOOLS = ["create_question", "replace_current_question", "assign_practice_problem"];

/** Whether any result this turn made a challenge playable, the host's fallback
 *  included. */
export function publishedChallenge(outcomes: Map<string, unknown[]>): boolean {
  return [...CHALLENGE_PUBLISHING_TOOLS, "create_fallback_question"].some((name) =>
    (outcomes.get(name) ?? []).some((entry) => (entry as { result?: { status?: unknown } } | null)?.result?.status === "playable"),
  );
}

/**
 * What the learner is still owed before this turn may end, as the instruction
 * that tells the model so — or "" when the turn may finish as it is.
 *
 * Two turns owe a challenge. An attempt-complete turn always does: the learner
 * just finished one, the host asked for "exactly one next pedagogical action",
 * and the only actions that end such a turn without a new challenge are a
 * review that reopened the attempt (the host says not to set one) or a question
 * the learner dismissed. An answered ask_user_question is not one of them: the
 * answer comes back as that call's result inside this same turn, so after it
 * the turn still has to aim and publish the next challenge. And any turn that
 * already tried to author one owes it, because the model has decided a
 * challenge is the right move and a compiler rejection does not change that.
 *
 * `rejection` is the compiler's own account of the latest rejected candidate,
 * quoted back in full so the next call can fix it.
 */
export function owedChallenge(turnKind: AgentTurnKind, outcomes: Map<string, unknown[]>, hasActiveQuestion: boolean, rejection = "", sparAuthoring = true): string {
  if (publishedChallenge(outcomes)) return "";
  const latest = (name: string) => ((outcomes.get(name)?.at(-1) as { result?: Record<string, unknown> } | undefined)?.result ?? {});
  if (latest("review_solution").review === "rework") return "";
  if (latest("ask_user_question").status === "cancelled") return "";
  const authored = (outcomes.get("create_question")?.length ?? 0) + (outcomes.get("replace_current_question")?.length ?? 0);
  /* Another challenge became active while this turn compiled. Nothing is owed:
     the learner has one, and a retry would only be rejected the same way. */
  if (rejection.includes("session lifecycle:")) return "";
  const retry = rejection
    ? `The last challenge candidate was rejected and nothing was published: ${rejection} Fix exactly those failures — or, if the same failures keep returning, choose a simpler task that exercises the same idea — and call the authoring tool again. `
    : "";
  const never = "Do not end the turn, and do not tell the learner that a challenge failed validation or was not published, while an authoring call remains.";
  if (!sparAuthoring) {
    /* Nothing can be authored, so the only thing owed is a provider problem, and
       only after a completed attempt: a refused assignment is not a rejected
       candidate, and there is no authoring call to "fix". */
    if (turnKind !== "attempt-complete" || hasActiveQuestion) return "";
    const refusal = ((outcomes.get("assign_practice_problem")?.at(-1) as { result?: { report?: { checks?: Array<{ passed?: boolean; detail?: string }> } } } | undefined)?.result?.report?.checks ?? []).find((check) => check.passed === false)?.detail;
    return `${refusal ? `The last assignment was refused: ${refusal} ` : ""}This turn follows a completed attempt and still owes the learner their next challenge. This session only takes problems from its providers, so search them, read the best candidates, and assign one with assign_practice_problem before your final reply. If nothing matches the exact concept, widen to its parent area or a neighbouring rating before giving up.`;
  }
  if (turnKind === "attempt-complete" && !hasActiveQuestion) {
    return `${retry}This turn follows a completed attempt and still owes the learner their next challenge. Publish one with create_question (or assign_practice_problem, when it is offered and a connected-provider problem fits) before you give your final reply. ${never}`;
  }
  if (authored > 0) return `${retry || "The last challenge candidate was not published. Call the authoring tool again with a corrected design. "}${never}`;
  return "";
}
