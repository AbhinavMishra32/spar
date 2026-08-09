export type AgentTurnKind = "cold-start" | "session-start" | "attempt-complete" | "learner-message" | "challenge-revision";
export type ToolStage = { activeTools: string[]; toolChoice: "required" | "auto" | "none"; exhausted?: { attempts: number; failure: string } };

/**
 * The final tool-free phase is part of teaching, not a receipt for a database
 * write.  Keeping this host-authored also makes provenance non-negotiable: a
 * locally authored prerequisite cannot be described as a real judge problem.
 */
export function completionInstruction(turnKind:AgentTurnKind,outcomes:Map<string,unknown[]>):string{
  const playable=(name:string)=>(outcomes.get(name)??[]).some((value)=>Boolean(value&&typeof value==="object"&&(value as {result?:{status?:unknown}}).result?.status==="playable"));
  if(turnKind==="session-start"){
    const provenance=playable("assign_practice_problem")
      ? "A connected-provider problem is now playable. Name it as a provider problem only from the successful assignment result."
      : "A tailored local prerequisite challenge is now playable. Call it local and tailored; never describe it as a real, sourced, judged, Codeforces, or LeetCode problem.";
    return `${provenance} Give a compact micro-lesson for the target's one central idea, connect that idea to the challenge, and end with one concrete first action for the learner. Do not provide code, pseudocode that is the full solution, or the completed answer. Do not merely report that the target or challenge was created.`;
  }
  if(turnKind==="attempt-complete")return "State the evidence-backed learning decision, explain the one idea the next challenge transfers, and end with one concrete first action. Do not give the solution.";
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
export const SOURCE_READ_TOOLS = ["search_practice_problems", "read_practice_problem", "read_practice_source", "read_practice_progress", "read_practice_submissions"];
export const SOURCE_TOOLS = [...SOURCE_READ_TOOLS, "assign_practice_problem"];

export function allowedTools(turnKind: AgentTurnKind, hasActiveQuestion = false, webSearch = false, practiceSource = false): Set<string> {
  const web = webSearch ? WEB_TOOLS : [];
  const source = practiceSource ? SOURCE_TOOLS : [];
  if (turnKind === "cold-start") return new Set(["search_learner_model", "search_attempt_history", "ask_user_question"]);
  if (turnKind === "session-start") return new Set(["search_learner_model", "search_attempt_history", "search_challenge_history", "read_ability", "read_concept_graph", "search_concept_evidence", "ask_user_question", "set_session_objective", "set_training_target", "create_question", ...source, ...web]);
  if (turnKind === "attempt-complete") return new Set(["replay_attempt", "inspect_current_attempt", "evaluate_attempt", "read_ability", "propose_ability_update", "commit_session_decision", "search_learner_model", "search_attempt_history", "search_challenge_history", "read_concept_graph", "search_concept_evidence", "ask_user_question", "set_training_target", "create_question", ...source, ...web]);
  /* Both ways of changing the challenge, because "give me a real problem instead"
     is a revision request like any other. Withholding the assignment here was a
     dead end with one exit: the agent could not hand over the LeetCode problem the
     learner asked for, so it wrote its own challenge, named it after that problem,
     and had it graded locally — a counterfeit of the thing that was available all
     along. A sourced problem supersedes rather than edits, which the store already
     records as a replacement. */
  if (turnKind === "challenge-revision") return new Set(["replay_attempt", "inspect_current_attempt", "set_training_target", "replace_current_question", ...source]);
  return new Set(["read_session", ...(hasActiveQuestion ? ["inspect_current_attempt", "replace_current_question"] : ["create_question"]), ...source, "replay_attempt", "read_attempt", "read_ability", "search_learner_model", "search_attempt_history", "search_challenge_history", "read_challenge", "read_concept_graph", "search_concept_evidence", "ask_user_question", "set_session_objective", "set_training_target", "upsert_ability", ...web]);
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
 * Deterministic controller policy. The model supplies arguments for the one
 * action exposed by a stage; it never chooses the stage sequence itself.
 */
export function nextToolStage(turnKind: AgentTurnKind, outcomes: Map<string, unknown[]>, challengeCompilationLimit = 15, context: { hasActiveQuestion?: boolean; webSearch?: boolean; practiceSource?: boolean } = {}): ToolStage {
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
    if (!completed("replay_attempt")) return { activeTools: ["replay_attempt"], toolChoice: "required" };
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
      "read_session",
      ...(context.hasActiveQuestion ? ["inspect_current_attempt", "replace_current_question"] : ["create_question"]),
      /* The source stays available in full even mid-challenge. The reads because
         "is this like anything I have done?" is a question about the problem in
         front of them; the assignment because "give me a real problem instead" is
         a request this turn can actually carry out, and the tool refuses on its
         own unless the agent says the learner asked to be moved. */
      ...(context.practiceSource ? SOURCE_TOOLS : []),
      "replay_attempt", "read_attempt", "read_ability", "search_learner_model", "search_attempt_history", "search_challenge_history", "read_challenge", "read_concept_graph", "search_concept_evidence", "ask_user_question", "set_session_objective", "set_training_target", "upsert_ability",
      ...(context.webSearch ? WEB_TOOLS : []),
    ],
    toolChoice: "auto",
  };
  if (turnKind === "cold-start") {
    const retrieval = ["search_learner_model", "search_attempt_history"].find((name) => !completed(name));
    if (retrieval) return { activeTools: [retrieval], toolChoice: "required" };
    if (!completed("ask_user_question")) return { activeTools: ["ask_user_question"], toolChoice: "required" };
    return { activeTools: [], toolChoice: "none" };
  }
  if (playableQuestion) return { activeTools: [], toolChoice: "none" };
  /* A challenge the learner has not finished is the session's current state, and
     the host refuses to publish a second one over it. Forcing create_question
     here spent the whole compilation budget on candidates that were rejected for
     lifecycle before they were ever compiled — fifteen times, then a fallback
     that was refused for the same reason. There is nothing for this turn to do. */
  if (context.hasActiveQuestion) return { activeTools: [], toolChoice: "none" };
  if (turnKind === "session-start") {
    /* The challenge library is retrieved alongside the ability ledger, not left to
       the model's discretion. Without this stage the agent aiming a session's
       first target could not see what it had already asked, and every new goal
       re-derived the same off-by-one loop repair from the one ability the ledger
       happened to contain — twelve times, across four unrelated goals. */
    const retrieval = ["search_learner_model", "search_attempt_history", "search_challenge_history"].find((name) => !completed(name));
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
       open so a rejected candidate retries the compiler, not the vocabulary. */
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
  /* A question asked of the learner suspends the turn where it is asked. The
     answer arrives as its own turn and carries the target and the next challenge
     with it, so continuing to the compiler here would publish a challenge aimed
     at a gap the learner is in the middle of explaining. */
  if (completed("ask_user_question")) return { activeTools: [], toolChoice: "none" };

  /* The replay comes before everything else on an attempt-complete turn: it is
     the account of how the challenge was solved, and every judgement made after
     it — the ability update, the decision, the next target — is supposed to be a
     judgement about that. `search_concept_evidence` sits between the wider
     search and the next target because after the target is chosen it can no
     longer change the aim. */
  for (const stage of [["replay_attempt", "evaluate_attempt"], ["read_ability"], ["propose_ability_update"], ["commit_session_decision"], ["search_learner_model"], ["search_concept_evidence"]]) {
    const next = stage.find((name) => !completed(name));
    if (next) return { activeTools: [next], toolChoice: "required" };
  }
  /* The one stage with a real choice in it. Everything needed to aim the next
     question has been read by now, so the agent either aims it or says that the
     trace raised something only the learner can answer — and asking is a first
     class outcome of reading a replay rather than a failure to decide. */
  if (!completed("set_training_target")) return { activeTools: ["ask_user_question", "set_training_target"], toolChoice: "required" };
  if (context.practiceSource && !completed("search_practice_problems")) return { activeTools: ["search_practice_problems"], toolChoice: "required" };
  return challengeStage();
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

function hasRetrievedAbility(outcomes: Map<string, unknown[]>) {
  const latest=outcomes.get("search_learner_model")?.at(-1);
  if(!latest||typeof latest!=="object")return false;
  const result=(latest as {result?:unknown}).result;
  if(Array.isArray(result))return result.length>0;
  return Boolean(result&&typeof result==="object"&&Array.isArray((result as {passages?:unknown}).passages)&&(result as {passages:unknown[]}).passages.length>0);
}
