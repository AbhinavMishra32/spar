export type AgentTurnKind = "cold-start" | "session-start" | "attempt-complete" | "learner-message" | "challenge-revision";
export type ToolStage = { activeTools: string[]; toolChoice: "required" | "auto" | "none"; exhausted?: { attempts: number; failure: string } };

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
export function completionInstruction(turnKind:AgentTurnKind,outcomes:Map<string,unknown[]>):string{
  const playable=(name:string)=>(outcomes.get(name)??[]).some((value)=>Boolean(value&&typeof value==="object"&&(value as {result?:{status?:unknown}}).result?.status==="playable"));
  if(turnKind==="session-start"||turnKind==="cold-start"){
    const provenance=playable("assign_practice_problem")
      ? "A connected-provider problem is now playable. Name it as a provider problem only from the successful assignment result."
      : "A tailored local prerequisite challenge is now playable. Call it local and tailored; never describe it as a real, sourced, judged, Codeforces, or LeetCode problem.";
    return `${provenance} ${WHY_THIS_PROBLEM} Here that reason comes from what you read before choosing: the ability you picked up and why it was worth picking up now, a run of past challenges that kept circling one thing, or — on a first session with nothing behind it — what they told you in their own words. Say so plainly rather than implying a history you do not have. Then give a compact micro-lesson for the target's one central idea, connect that idea to the challenge, and end with one concrete first action for the learner. Do not provide code, pseudocode that is the full solution, or the completed answer. Do not merely report that the target or challenge was created.`;
  }
  if(turnKind==="attempt-complete")return `${WHY_THIS_PROBLEM} Here you have the strongest version of that reason available anywhere in Spar: you have just read the solve. Use what is actually in it — the step they took first, the fix they made and how long after the failure, the case they never reached, the second shrink they stopped before — and say what that left you unsure of, which is the thing this next challenge is for. Then state the evidence-backed learning decision, explain the one idea the next challenge transfers, and end with one concrete first action. Do not give the solution.`;
  if(turnKind==="challenge-revision")return "State what changed in the successful replacement and why it better matches the learner's request. Preserve the successful result's provider or local provenance.";
  return "State what changed from the successful durable result and answer the learner concisely. Preserve provider or local provenance and do not claim an action the result does not prove.";
}

/**
 * Which tools are constructed for a turn at all.
 *
 * This must be a superset of every stage `nextToolStage` can reach for the same
 * turn kind. A stage naming a tool that was never built is a tool the provider
 * cannot call, and `required` toolChoice then demands something that does not
 * exist — the provider answers by writing the call out as message text
 * (`{"tool":"search_challenge_history","input":{…}}`), which records no outcome,
 * so the stage never completes and the identical phase runs again until the
 * protocol retry budget is spent. It lives beside the stage machine, and the
 * subset relationship is asserted in this module's tests, rather than depending
 * on whoever edits one list remembering the other.
 */
/** Reaching outside the learner's own record. Only ever offered — never a stage
 *  the turn cannot leave — and withheld entirely when no key is configured, so a
 *  learner who has not set one up does not pay a provider round-trip per session
 *  for a tool that can only answer "not set up". */
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
/**
 * The execution visualiser, loaded on demand.
 *
 * `open_visualizer` is always on the table and the other four are not, which is
 * the whole arrangement in one line. Spar can trace a program and draw every
 * value in it at any step, and telling the agent how to use that well takes
 * several hundred words — how to find the step that matters, when a picture
 * beats a paragraph, why it must never draw a working solution to the challenge
 * the learner is on. Carrying that in every turn's context would be paying for
 * it on turns that only set a challenge.
 *
 * So the gate tool costs one line until the agent decides this is a turn about
 * state, and its result is the briefing plus the four tools that do the work.
 * The stage machine reads the same signal the model does — the gate having been
 * called this turn — so "the skill is loaded" is a fact about the transcript
 * rather than a flag someone has to remember to clear.
 */
export const VISUALIZER_GATE = "open_visualizer";
export const VISUALIZER_SKILL_TOOLS = ["visualize_run", "visualize_read_step", "visualize_find", "visualize_explain"];
export const VISUALIZER_TOOLS = [VISUALIZER_GATE, ...VISUALIZER_SKILL_TOOLS];

/** The visualiser tools a stage may offer right now: the gate, plus the toolkit
 *  once the gate has answered. */
function visualizerStageTools(outcomes: Map<string, unknown[]>): string[] {
  return (outcomes.get(VISUALIZER_GATE)?.length ?? 0) > 0 ? VISUALIZER_TOOLS : [VISUALIZER_GATE];
}

/** How many visualiser calls one deterministic turn may spend before the stage
 *  stops offering them. Enough to open it, trace, find the step and show it,
 *  with room for a second look — and finite, because an attempt-complete turn
 *  has an ability to update and a challenge to set after this. */
const VISUALIZER_TURN_BUDGET = 8;

/**
 * The visualiser, offered inside a required stage.
 *
 * Withdrawn once it has been spent, and once a picture has actually been shown:
 * a turn that has drawn its diagram has had its use of this, and leaving the
 * tools on the table invites a second one nobody asked for.
 */
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

export const SOURCE_READ_TOOLS = ["search_practice_problems", "read_practice_problem", "read_practice_source", "read_practice_progress", "read_practice_submissions"];
export const SOURCE_TOOLS = [...SOURCE_READ_TOOLS, "assign_practice_problem"];

export function allowedTools(turnKind: AgentTurnKind, hasActiveQuestion = false, webSearch = false, practiceSource = false): Set<string> {
  const web = webSearch ? WEB_TOOLS : [];
  const source = practiceSource ? SOURCE_TOOLS : [];
  if (turnKind === "cold-start") return allowedTools("session-start", hasActiveQuestion, webSearch, practiceSource);
  if (turnKind === "session-start") return new Set(["search_learner_model", "search_attempt_history", "search_challenge_history", "read_ability", "read_concept_graph", "search_concept_evidence", "ask_user_question", "set_session_objective", "set_training_target", "create_question", ...source, ...web]);
  if (turnKind === "attempt-complete") return new Set([...VISUALIZER_TOOLS, "read_attempt", "review_solution", "read_ability", "propose_ability_update", "commit_session_decision", "search_learner_model", "search_attempt_history", "search_challenge_history", "read_concept_graph", "search_concept_evidence", "ask_user_question", "set_training_target", "create_question", ...source, ...web]);
  /* Both ways of changing the challenge, because "give me a real problem instead"
     is a revision request like any other. Withholding the assignment here was a
     dead end with one exit: the agent could not hand over the LeetCode problem the
     learner asked for, so it wrote its own challenge, named it after that problem,
     and had it graded locally — a counterfeit of the thing that was available all
     along. A sourced problem supersedes rather than edits, which the store already
     records as a replacement. */
  if (turnKind === "challenge-revision") return new Set(["read_attempt", "set_training_target", "replace_current_question", ...source]);
  return new Set([...VISUALIZER_TOOLS, "read_session", ...(hasActiveQuestion ? ["replace_current_question"] : ["create_question"]), ...source, "read_attempt", "read_ability", "search_learner_model", "search_attempt_history", "search_challenge_history", "read_challenge", "read_concept_graph", "search_concept_evidence", "ask_user_question", "set_session_objective", "set_training_target", "upsert_ability", ...web]);
}

/**
 * A compiler attempt is a phase-level operation, not a free-form model tool.
 * Providers can emit several differently-shaped create_question calls in one
 * response; only the first candidate may mutate the session in that phase.
 */
export function phaseExecutionKey(name: string, inputSignature: string): string {
  return name === "create_question" || name === "replace_current_question" ? name : `${name}:${inputSignature}`;
}

/**
 * Challenge authoring is one public mutation for the whole turn, even if the
 * provider advances to another phase or switches from create to replace. The
 * host repairs a rejected candidate privately inside that original call.
 */
export function turnExecutionKey(name: string): string | null {
  return name === "create_question" || name === "replace_current_question" ? "challenge-authoring" : null;
}

/**
 * Deterministic controller policy. The model supplies arguments for the one
 * action exposed by a stage; it never chooses the stage sequence itself.
 */
export function nextToolStage(turnKind: AgentTurnKind, outcomes: Map<string, unknown[]>, challengeCompilationLimit = 1, context: { hasActiveQuestion?: boolean; webSearch?: boolean; practiceSource?: boolean } = {}): ToolStage {
  const completed = (name: string) => (outcomes.get(name)?.length ?? 0) > 0;
  /* An assignment counts as an attempt at setting the challenge, exactly like a
     compilation. Without this a source that keeps refusing — every candidate
     already solved, every problem subscription-only — would loop past the budget
     that exists to stop precisely that. */
  const questionAttempts = [...(outcomes.get("create_question") ?? []),...(outcomes.get("replace_current_question") ?? []),...(outcomes.get("assign_practice_problem") ?? [])];
  /**
   * The stage that sets the challenge.
   *
   * Both ways of doing it are offered together, `required`, so the model has to
   * pick one and cannot answer in prose. This is the whole mechanism behind
   * "prefer a real problem when one fits": a turn cannot end without either
   * setting a real problem or consciously writing one instead, and it has just
   * been made to look at what the source has.
   */
  const challengeStage = (): ToolStage => context.practiceSource
    ? { activeTools: ["assign_practice_problem", "create_question"], toolChoice: "required" }
    : { activeTools: ["create_question"], toolChoice: "required" };
  const playableQuestion = questionAttempts.some((value) => value && typeof value === "object" && (value as { result?: { status?: unknown } }).result?.status === "playable");
  // Exhausting the budget is a fact for the controller to act on, not a reason
  // to end the turn. Throwing here left the learner with a compiler error and
  // no challenge; the caller now falls back to a host-authored design so the
  // session always has something to attempt.
  if (questionAttempts.length >= challengeCompilationLimit && !playableQuestion) {
    return { activeTools: [], toolChoice: "none", exhausted: { attempts: questionAttempts.length, failure: latestCompilationFailure(questionAttempts) } };
  }

  // Explicit difficulty/change requests are state transitions, not optional
  // chat. Require each durable phase so the model cannot acknowledge the
  // request without actually replacing the active challenge.
  if (turnKind === "challenge-revision") {
    if (playableQuestion) return { activeTools: [], toolChoice: "none" };
    if (!completed("read_attempt")) return { activeTools: ["read_attempt"], toolChoice: "required" };
    if (!completed("set_training_target")) return { activeTools: ["set_training_target"], toolChoice: "required" };
    /* One optional look at what the source has before the swap is written, for the
       same reason the session-start path takes one: the learner asking for a
       different challenge is the likeliest moment for a real problem to be the
       right answer, and it cannot be chosen without being searched for. */
    if (context.practiceSource && !completed("search_practice_problems")) return { activeTools: ["search_practice_problems"], toolChoice: "required" };
    return context.practiceSource
      ? { activeTools: ["assign_practice_problem", "replace_current_question"], toolChoice: "required" }
      : { activeTools: ["replace_current_question"], toolChoice: "required" };
  }

  // The same agent handles conversation and mutations. `auto` lets ordinary
  // chat end in prose while real requests can inspect or change host state.
  if (turnKind === "learner-message" && playableQuestion) return { activeTools: [], toolChoice: "none" };
  if (turnKind === "learner-message") return {
    activeTools: [
      /* Offered on every ordinary turn, because "why does this do that" is an
         ordinary turn. A learner stuck on state rarely says "show me a diagram";
         they say "I thought i was 3 here", and the agent has to be able to reach
         for the picture on its own from that. */
      ...visualizerStageTools(outcomes),
      "read_session",
      ...(context.hasActiveQuestion ? ["replace_current_question"] : ["create_question"]),
      /* The source stays available in full even mid-challenge. The reads because
         "is this like anything I have done?" is a question about the problem in
         front of them; the assignment because "give me a real problem instead" is
         a request this turn can actually carry out, and the tool refuses on its
         own unless the agent says the learner asked to be moved. */
      ...(context.practiceSource ? SOURCE_TOOLS : []),
      "read_attempt", "read_ability", "search_learner_model", "search_attempt_history", "search_challenge_history", "read_challenge", "read_concept_graph", "search_concept_evidence", "ask_user_question", "set_session_objective", "set_training_target", "upsert_ability",
      ...(context.webSearch ? WEB_TOOLS : []),
    ],
    toolChoice: "auto",
  };
  if (turnKind === "cold-start") {
    const retrieval = nextRetrieval(outcomes, ["search_learner_model", "search_attempt_history"]);
    if (retrieval) return { activeTools: [retrieval], toolChoice: "required" };
    if (!completed("ask_user_question")) return { activeTools: ["ask_user_question"], toolChoice: "required" };
    /* The question's tool call remains open until the learner answers, so this
       is still the same run. Continue through the ordinary session-start stages
       instead of ending here and manufacturing a second learner turn. */
    return nextToolStage("session-start", outcomes, challengeCompilationLimit, context);
  }
  if (playableQuestion) return { activeTools: [], toolChoice: "none" };
  /* A challenge the learner has not finished is the session's current state, and
     the host refuses to publish a second one over it. Forcing create_question
     here spent the whole compilation budget on candidates that were rejected for
     lifecycle before they were ever compiled — repeatedly, then a fallback
     that was refused for the same reason. There is nothing for this turn to do. */
  if (context.hasActiveQuestion) return { activeTools: [], toolChoice: "none" };
  if (turnKind === "session-start") {
    /* The challenge library is retrieved alongside the ability ledger, not left to
       the model's discretion. Without this stage the agent aiming a session's
       first target could not see what it had already asked, and every new goal
       re-derived the same off-by-one loop repair from the one ability the ledger
       happened to contain — twelve times, across four unrelated goals. */
    const retrieval = nextRetrieval(outcomes, ["search_learner_model", "search_attempt_history", "search_challenge_history"]);
    if (retrieval) return { activeTools: [retrieval], toolChoice: "required" };
    if (hasRetrievedAbility(outcomes) && !completed("read_ability") && !completed("set_session_objective")) return { activeTools: ["read_ability"], toolChoice: "required" };
    /* One optional look outward, before the objective fixes what this session is
       about. Offered alongside the objective rather than as a stage of its own so
       the agent can decline it in the same breath it commits — a goal like "learn
       recursion" needs nothing from the web, and "pass a Google interview" might.
       Bounded by `completed`, so it is at most one search and one read per turn
       and the chain cannot sit here choosing to search forever. */
    if (!completed("set_session_objective")) {
      const grounding = context.webSearch ? WEB_TOOLS.filter((name) => !completed(name)) : [];
      if (grounding.length) return { activeTools: [...grounding.slice(0, 1), "set_session_objective"], toolChoice: "required" };
      return { activeTools: ["set_session_objective"], toolChoice: "required" };
    }
    /* The vocabulary is read before the target is set, not after. The target's
       gap and the challenge's primary concept have to name the same thing, and a
       model that has not seen the existing slugs invents a near-duplicate for a
       concept the learner already has evidence under — which splits that
       evidence in two and hides both halves. Gated on the target still being
       open so challenge authoring stays focused on the compiler, not the vocabulary. */
    if (!completed("set_training_target")) {
      if (!completed("read_concept_graph")) return { activeTools: ["read_concept_graph"], toolChoice: "required" };
      return { activeTools: ["set_training_target"], toolChoice: "required" };
    }
    /* Look at what the world already asks before writing something. This stage is
       the difference between a source the agent *may* use and one it actually
       does: a real problem carries a real judge, a difficulty somebody
       calibrated, and the learner's own history with it, and none of that is
       available to a challenge invented on the spot. One search, once per turn —
       then the agent is free to assign what it found or to write its own. */
    if (context.practiceSource && !completed("search_practice_problems")) return { activeTools: ["search_practice_problems"], toolChoice: "required" };
    return challengeStage();
  }
  /* The replay comes before everything else on an attempt-complete turn: it is
     the account of how the challenge was solved, and every judgement made after
     it — the ability update, the decision, the next target — is supposed to be a
     judgement about that. `search_concept_evidence` sits between the wider
     search and the next target because after the target is chosen it can no
     longer change the aim. */
  /**
   * The solution was sent back, so this turn is over.
   *
   * Everything below this point writes down what was learned from a finished
   * attempt and aims the next one. Neither applies to an attempt the agent has
   * just reopened: there is no ability to update from a solution that is being
   * rewritten, and setting a new challenge on top of the one the learner has
   * been asked to redo is the opposite of what the review just said.
   */
  if ((outcomes.get("review_solution") ?? []).some(reworked)) return { activeTools: [], toolChoice: "none" };

  /* The review comes after the evidence and before anything is written down.
     It needs the replay and the code to judge how the challenge was solved, and
     everything after it — the ability, the decision, the next target — is only
     worth writing if the attempt actually counts. */
  for (const stage of [["read_attempt"], ["review_solution"], ["read_ability"], ["propose_ability_update"], ["commit_session_decision"], ["search_learner_model"], ["search_concept_evidence"]]) {
    const next = stage.find((name) => !completed(name));
    if (!next) continue;
    /* One place in this sequence where the visualiser is offered, and it is
       here on purpose. The replay and the deterministic evaluation are both in
       hand — so the agent knows what went wrong — and nothing has been written
       down yet. This is the moment where "your loop exits one step early" can
       stop being a sentence and become the step where it exits.
       
       Offered alongside a required tool rather than as a stage of its own,
       because an `auto` stage that the model declines ends the turn, and ending
       an attempt-complete turn before the ability is updated would lose the
       evidence the attempt was for. Picking either advances the phase. */
    return next === "propose_ability_update"
      ? { activeTools: [...visualizerOffer(outcomes), next], toolChoice: "required" }
      : { activeTools: [next], toolChoice: "required" };
  }
  /* The one stage with a real choice in it. Everything needed to aim the next
     question has been read by now, so the agent either aims it or says that the
     trace raised something only the learner can answer — and asking is a first
     class outcome of reading a replay rather than a failure to decide. */
  if (!completed("set_training_target")) return {
    activeTools: [...(completed("ask_user_question") ? [] : ["ask_user_question"]), "set_training_target"],
    toolChoice: "required",
  };
  if (context.practiceSource && !completed("search_practice_problems")) return { activeTools: ["search_practice_problems"], toolChoice: "required" };
  return challengeStage();
}

/** Whether one recorded `review_solution` outcome sent the solution back. */
function reworked(entry: unknown): boolean {
  const result = entry && typeof entry === "object" ? (entry as { result?: unknown }).result : null;
  return Boolean(result && typeof result === "object" && (result as { review?: unknown }).review === "rework");
}

function latestCompilationFailure(attempts: unknown[]): string {
  const latest = attempts.at(-1);
  if (!latest || typeof latest !== "object") return "";
  const result = (latest as { result?: unknown }).result;
  if (!result || typeof result !== "object") return "";
  const report = (result as { report?: unknown }).report;
  if (!report || typeof report !== "object") return "";
  const checks = (report as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) return "";
  return checks.flatMap((check) => {
    if (!check || typeof check !== "object") return [];
    const item = check as Record<string, unknown>;
    return item.passed === false ? [`${String(item.name ?? "validation")}: ${String(item.detail ?? "failed")}`] : [];
  }).join("; ").slice(0, 800);
}

/** Whether one recorded tool outcome came back with anything in it.
 *
 *  Every retrieval tool answers with a single named collection — `passages`,
 *  `attempts`, `challenges` — so "did this find something" is one shape, read
 *  once, rather than a special case per tool. An outcome that is not a
 *  collection at all counts as a hit: the conservative direction is to keep
 *  retrieving, never to stop early on a shape this does not recognise. */
function retrievalFound(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return true;
  const result = (entry as { result?: unknown }).result;
  if (Array.isArray(result)) return result.length > 0;
  if (!result || typeof result !== "object") return true;
  const rows = Object.values(result as Record<string, unknown>).filter(Array.isArray);
  return rows.length ? rows.some((row) => (row as unknown[]).length > 0) : true;
}

/**
 * The next retrieval stage to require, or nothing when the ledger has already
 * answered.
 *
 * Retrieval is sequential and each stage is required, which on a Track whose
 * ledger is empty meant three forced round-trips to be told "nothing" three
 * times — the learner watches "Checking relevant hashmap abilities", "Checking
 * relevant hashmap attempts", "Checking prior hashmap challenge coverage" go by
 * and none of them can return anything, because an empty Track has no abilities,
 * no attempts and therefore no challenges either. The first empty answer is the
 * whole answer.
 *
 * Only a clean sweep stops it: one hit anywhere means the ledger has something
 * to say and the remaining stages are worth their round-trip. This bounds the
 * cold path without narrowing the warm one.
 */
function nextRetrieval(outcomes: Map<string, unknown[]>, stages: readonly string[]): string | undefined {
  const done = stages.filter((name) => (outcomes.get(name)?.length ?? 0) > 0);
  if (done.length && done.every((name) => (outcomes.get(name) ?? []).every((entry) => !retrievalFound(entry)))) return undefined;
  return stages.find((name) => (outcomes.get(name)?.length ?? 0) === 0);
}

function hasRetrievedAbility(outcomes: Map<string, unknown[]>) {
  const latest=outcomes.get("search_learner_model")?.at(-1);
  if(!latest||typeof latest!=="object")return false;
  const result=(latest as {result?:unknown}).result;
  if(Array.isArray(result))return result.length>0;
  return Boolean(result&&typeof result==="object"&&Array.isArray((result as {passages?:unknown}).passages)&&(result as {passages:unknown[]}).passages.length>0);
}
