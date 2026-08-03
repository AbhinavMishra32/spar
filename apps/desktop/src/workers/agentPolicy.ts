export type AgentTurnKind = "cold-start" | "session-start" | "attempt-complete" | "learner-message" | "challenge-revision";
export type ToolStage = { activeTools: string[]; toolChoice: "required" | "auto" | "none"; exhausted?: { attempts: number; failure: string } };

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
export function nextToolStage(turnKind: AgentTurnKind, outcomes: Map<string, unknown[]>, challengeCompilationLimit = 15, context: { hasActiveQuestion?: boolean } = {}): ToolStage {
  const completed = (name: string) => (outcomes.get(name)?.length ?? 0) > 0;
  const questionAttempts = [...(outcomes.get("create_question") ?? []),...(outcomes.get("replace_current_question") ?? [])];
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
    return { activeTools: ["replace_current_question"], toolChoice: "required" };
  }

  // The same agent handles conversation and mutations. `auto` lets ordinary
  // chat end in prose while real requests can inspect or change host state.
  if (turnKind === "learner-message" && playableQuestion) return { activeTools: [], toolChoice: "none" };
  if (turnKind === "learner-message") return {
    activeTools: ["read_session", ...(context.hasActiveQuestion ? ["inspect_current_attempt", "replace_current_question"] : ["create_question"]), "replay_attempt", "read_attempt", "read_ability", "search_learner_model", "search_attempt_history", "search_challenge_history", "read_challenge", "read_concept_graph", "search_concept_evidence", "ask_user_question", "set_session_objective", "set_training_target", "upsert_ability"],
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
    const retrieval = ["search_learner_model", "search_attempt_history"].find((name) => !completed(name));
    if (retrieval) return { activeTools: [retrieval], toolChoice: "required" };
    if (hasRetrievedAbility(outcomes) && !completed("read_ability") && !completed("set_session_objective")) return { activeTools: ["read_ability"], toolChoice: "required" };
    if (!completed("set_session_objective")) return { activeTools: ["set_session_objective"], toolChoice: "required" };
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
    return { activeTools: ["create_question"], toolChoice: "required" };
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
  return { activeTools: ["create_question"], toolChoice: "required" };
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
