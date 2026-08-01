export type AgentTurnKind = "cold-start" | "session-start" | "attempt-complete" | "learner-message";
export type ToolStage = { activeTools: string[]; toolChoice: "required" | "auto" | "none" };

/**
 * Deterministic controller policy. The model supplies arguments for the one
 * action exposed by a stage; it never chooses the stage sequence itself.
 */
export function nextToolStage(turnKind: AgentTurnKind, outcomes: Map<string, unknown[]>, challengeCompilationLimit = 2): ToolStage {
  const completed = (name: string) => (outcomes.get(name)?.length ?? 0) > 0;
  const questionAttempts = outcomes.get("create_question") ?? [];
  const playableQuestion = questionAttempts.some((value) => value && typeof value === "object" && (value as { result?: { status?: unknown } }).result?.status === "playable");
  if (questionAttempts.length >= challengeCompilationLimit && !playableQuestion) throw new Error(`Training Agent stopped after ${challengeCompilationLimit} rejected challenge compilations; automatic regeneration is intentionally disabled.`);

  // Learner chat is a bounded response turn. Session state is already in the
  // prompt, so exposing tools here would turn casual messages into read loops.
  if (turnKind === "learner-message") return { activeTools: [], toolChoice: "none" };
  if (turnKind === "cold-start") {
    const retrieval = ["search_learner_model", "search_attempt_history"].find((name) => !completed(name));
    if (retrieval) return { activeTools: [retrieval], toolChoice: "required" };
    if (!completed("ask_learner")) return { activeTools: ["ask_learner"], toolChoice: "required" };
    return { activeTools: [], toolChoice: "none" };
  }
  if (playableQuestion) return { activeTools: [], toolChoice: "none" };
  if (turnKind === "session-start") {
    const retrieval = ["search_learner_model", "search_attempt_history"].find((name) => !completed(name));
    if (retrieval) return { activeTools: [retrieval], toolChoice: "required" };
    if (!completed("read_ability") && !completed("set_session_objective")) return { activeTools: ["read_ability"], toolChoice: "required" };
    if (!completed("set_session_objective")) return { activeTools: ["set_session_objective"], toolChoice: "required" };
    if (!completed("set_training_target")) return { activeTools: ["set_training_target"], toolChoice: "required" };
    return { activeTools: ["create_question"], toolChoice: "required" };
  }
  for (const stage of [["inspect_current_attempt", "evaluate_attempt"], ["read_ability"], ["propose_ability_update"], ["commit_session_decision"], ["search_learner_model"], ["set_training_target"]]) {
    const next = stage.find((name) => !completed(name));
    if (next) return { activeTools: [next], toolChoice: "required" };
  }
  return { activeTools: ["create_question"], toolChoice: "required" };
}
