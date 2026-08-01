export type AgentTurnKind = "cold-start" | "session-start" | "attempt-complete" | "learner-message";
export type ToolStage = { activeTools: string[]; toolChoice: "required" | "auto" | "none" };

/**
 * A compiler attempt is a phase-level operation, not a free-form model tool.
 * Providers can emit several differently-shaped create_question calls in one
 * response; only the first candidate may mutate the session in that phase.
 */
export function phaseExecutionKey(name: string, inputSignature: string): string {
  return name === "create_question" ? name : `${name}:${inputSignature}`;
}

/**
 * Deterministic controller policy. The model supplies arguments for the one
 * action exposed by a stage; it never chooses the stage sequence itself.
 */
export function nextToolStage(turnKind: AgentTurnKind, outcomes: Map<string, unknown[]>, challengeCompilationLimit = 15): ToolStage {
  const completed = (name: string) => (outcomes.get(name)?.length ?? 0) > 0;
  const questionAttempts = outcomes.get("create_question") ?? [];
  const playableQuestion = questionAttempts.some((value) => value && typeof value === "object" && (value as { result?: { status?: unknown } }).result?.status === "playable");
  if (questionAttempts.length >= challengeCompilationLimit && !playableQuestion) {
    const failure = latestCompilationFailure(questionAttempts);
    throw new Error(`Challenge generation stopped after ${questionAttempts.length} rejected deterministic compilation attempts.${failure ? ` Latest failure: ${failure}` : ""}`);
  }

  // Learner chat is a bounded response turn. Session state is already in the
  // prompt, so exposing tools here would turn casual messages into read loops.
  if (turnKind === "learner-message") return { activeTools: [], toolChoice: "none" };
  if (turnKind === "cold-start") {
    const retrieval = ["search_learner_model", "search_attempt_history"].find((name) => !completed(name));
    if (retrieval) return { activeTools: [retrieval], toolChoice: "required" };
    if (!completed("ask_user_question")) return { activeTools: ["ask_user_question"], toolChoice: "required" };
    return { activeTools: [], toolChoice: "none" };
  }
  if (playableQuestion) return { activeTools: [], toolChoice: "none" };
  if (turnKind === "session-start") {
    const retrieval = ["search_learner_model", "search_attempt_history"].find((name) => !completed(name));
    if (retrieval) return { activeTools: [retrieval], toolChoice: "required" };
    if (hasRetrievedAbility(outcomes) && !completed("read_ability") && !completed("set_session_objective")) return { activeTools: ["read_ability"], toolChoice: "required" };
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
