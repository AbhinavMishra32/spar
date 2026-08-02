import type { AgentActivityFile, AgentStreamEvent } from "../../../shared/api";

export type ToolPhase = "running" | "done" | "error";

export type RunPart =
  | { kind: "text"; id: string; body: string }
  | {
      kind: "tool";
      id: string;
      tool: string;
      label: string;
      detail: string;
      phase: ToolPhase;
      files: AgentActivityFile[];
      startedAt: number;
      endedAt?: number;
    }
  | { kind: "status"; id: string; body: string }
  | { kind: "error"; id: string; body: string };

export type AgentRun = {
  runId: string;
  parts: RunPart[];
  status: "streaming" | "done" | "error";
  startedAt: number;
};

/**
 * Folds the raw utility-process stream into the shape the transcript renders.
 * Consecutive text deltas append to the trailing text part so streaming reads as
 * one growing message rather than a wall of fragments, and a tool's start/end
 * pair updates one row in place via its callId.
 */
export function reduceRun(current: AgentRun | null, event: AgentStreamEvent): AgentRun | null {
  const run: AgentRun = current && current.runId === event.runId
    ? current
    : { runId: event.runId, parts: [], status: "streaming", startedAt: Date.now() };

  const parts = [...run.parts];
  const last = parts[parts.length - 1];

  switch (event.type) {
    case "text": {
      const text = event.text ?? "";
      if (!text) return run;
      if (last?.kind === "text") parts[parts.length - 1] = { ...last, body: last.body + text };
      else parts.push({ kind: "text", id: `${event.runId}-t${parts.length}`, body: text });
      return { ...run, parts, status: "streaming" };
    }

    case "tool": {
      const tool = event.tool ?? "tool";
      const id = event.callId ?? `${event.runId}-x${parts.length}`;
      const index = parts.findIndex((part) => part.kind === "tool" && part.id === id);

      if (event.phase === "end") {
        if (index < 0) return run;
        const existing = parts[index] as Extract<RunPart, { kind: "tool" }>;
        parts[index] = {
          ...existing,
          phase: event.ok === false ? "error" : "done",
          detail: event.detail ?? existing.detail,
          ...(event.files ? { files: event.files } : {}),
          endedAt: Date.now(),
        };
        return { ...run, parts };
      }

      if (index >= 0) return run;
      parts.push({
        kind: "tool",
        id,
        tool,
        label: event.label ?? "",
        detail: event.detail ?? "",
        phase: "running",
        files: event.files ?? [],
        startedAt: Date.now(),
      });
      return { ...run, parts, status: "streaming" };
    }

    case "status": {
      const body = event.detail ?? event.text ?? "";
      // Provider protocol chatter belongs in the raw trace, not the transcript.
      if (!body || isProtocolNoise(body)) return run;
      if (last?.kind === "status") parts[parts.length - 1] = { ...last, body };
      else parts.push({ kind: "status", id: `${event.runId}-s${parts.length}`, body });
      return { ...run, parts, status: "streaming" };
    }

    case "error":
      parts.push({ kind: "error", id: `${event.runId}-e${parts.length}`, body: event.text ?? "Spar could not finish that turn." });
      return { ...run, parts, status: "error" };

    case "done":
      return { ...run, parts, status: "done" };

    default:
      return run;
  }
}

function isProtocolNoise(body: string): boolean {
  return /^(phase-step|protocol-retry|step-|start|finish|tool-|text-|reasoning|response-)/.test(body);
}

const TOOL_VERBS: Record<string, string> = {
  search_learner_model: "Searched the learner model",
  search_attempt_history: "Searched attempt history",
  read_ability: "Read ability document",
  read_attempt: "Read attempt trace",
  read_session: "Read session",
  read_concept_graph: "Read concept graph",
  ask_user_question: "Asked you a question",
  set_session_objective: "Set the session objective",
  set_training_target: "Set the training target",
  create_question: "Created challenge",
  replace_current_question: "Replaced challenge",
  search_challenge_history: "Searched challenge history",
  read_challenge: "Read challenge history",
  upsert_ability: "Updated ability",
  inspect_current_attempt: "Inspected your attempt",
  evaluate_attempt: "Evaluated your attempt",
  propose_ability_update: "Updated ability document",
  commit_session_decision: "Committed next action",
};

/** Present tense while a call is open, past tense once it settles. */
export function toolVerb(tool: string, running: boolean, rejected = false): string {
  if ((tool === "create_question" || tool === "replace_current_question") && rejected) return "Rejected challenge candidate";
  const settled = TOOL_VERBS[tool];
  if (!settled) {
    const spaced = tool.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  if (!running) return settled;
  return settled
    .replace(/^Searched/, "Searching")
    .replace(/^Read\b/, "Reading")
    .replace(/^Asked/, "Asking")
    .replace(/^Set\b/, "Setting")
    .replace(/^Created/, "Creating")
    .replace(/^Inspected/, "Inspecting")
    .replace(/^Evaluated/, "Evaluating")
    .replace(/^Updated/, "Updating")
    .replace(/^Committed/, "Committing");
}

const SAFE_TOOL_LABELS: Record<string, [string, string]> = {
  search_learner_model: ["Search learning history", "Searched learning history"],
  search_attempt_history: ["Review past attempts", "Reviewed past attempts"],
  search_challenge_history: ["Review challenge history", "Reviewed challenge history"],
  read_ability: ["Read ability context", "Read ability context"],
  read_attempt: ["Read attempt evidence", "Read attempt evidence"],
  read_session: ["Read session context", "Read session context"],
  read_challenge: ["Read challenge context", "Read challenge context"],
  read_concept_graph: ["Read concept context", "Read concept context"],
  inspect_current_attempt: ["Inspect current attempt", "Inspected current attempt"],
  evaluate_attempt: ["Evaluate attempt", "Evaluated attempt"],
  set_session_objective: ["Update session objective", "Updated session objective"],
  set_training_target: ["Update training target", "Updated training target"],
  propose_ability_update: ["Prepare ability update", "Prepared ability update"],
  upsert_ability: ["Update ability", "Updated ability"],
  commit_session_decision: ["Choose next step", "Chose next step"],
  create_question: ["Build challenge", "Built challenge"],
  replace_current_question: ["Build replacement challenge", "Built replacement challenge"],
  ask_user_question: ["Prepare a question", "Prepared a question"],
};

/** Transcript-safe labels never expose tool arguments, database IDs, or queries. */
export function safeToolLabel(tool: string, running: boolean, failed = false): string {
  if (failed && tool === "replace_current_question") return "Replacement candidate failed validation";
  if (failed && tool === "create_question") return "Challenge candidate failed validation";
  if (failed) return "Could not complete tool step";
  const labels = SAFE_TOOL_LABELS[tool];
  if (labels) return labels[running ? 0 : 1];
  return running ? "Use a tool" : "Used a tool";
}

export function activityGroupLabel(parts: Array<Extract<RunPart, { kind: "tool" }>>): string {
  const latestByTool = new Map<string, Extract<RunPart, { kind: "tool" }>>();
  for (const part of parts) latestByTool.set(part.tool, part);
  const unique = [...latestByTool.values()];
  const active = unique.find((part) => part.phase === "running");
  if (active) {
    const completed = unique.filter((part) => part !== active).map((part) => gerund(safeToolLabel(part.tool, false)));
    return completed.length ? `${safeToolLabel(active.tool, true)} after ${joinLabels(completed)}` : safeToolLabel(active.tool, true);
  }
  const labels = unique.map((part) => safeToolLabel(part.tool, false, part.phase === "error"));
  if (labels.length <= 1) return labels[0] ?? "Completed work";
  const visible = labels.slice(0, 3).map((label, index) => index === 0 ? label : label.replace(/^./, (value) => value.toLowerCase()));
  if (visible.length === 2) return `${visible[0]} and ${visible[1]}`;
  const summary = `${visible.slice(0, -1).join(", ")}, and ${visible.at(-1)}`;
  return labels.length > 3 ? `${summary} · ${labels.length - 3} more` : summary;
}

function gerund(label: string): string {
  return label
    .replace(/^Read\b/, "reading")
    .replace(/^Searched\b/, "searching")
    .replace(/^Reviewed\b/, "reviewing")
    .replace(/^Inspected\b/, "inspecting")
    .replace(/^Evaluated\b/, "evaluating")
    .replace(/^Updated\b/, "updating")
    .replace(/^Prepared\b/, "preparing")
    .replace(/^Chose\b/, "choosing")
    .replace(/^Built\b/, "building")
    .replace(/^Used\b/, "using");
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "earlier work";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

export function diffTotals(files: AgentActivityFile[]): { added: number; removed: number } {
  return files.reduce(
    (totals, file) => ({ added: totals.added + file.added, removed: totals.removed + file.removed }),
    { added: 0, removed: 0 },
  );
}
