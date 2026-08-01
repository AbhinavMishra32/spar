import type { AgentStreamEvent } from "../../../shared/api";

export type ToolPhase = "running" | "done" | "error";

export type RunPart =
  | { kind: "text"; id: string; body: string }
  | { kind: "tool"; id: string; tool: string; detail: string; phase: ToolPhase }
  | { kind: "status"; id: string; body: string }
  | { kind: "error"; id: string; body: string };

export type AgentRun = {
  runId: string;
  parts: RunPart[];
  status: "streaming" | "done" | "error";
  startedAt: number;
};

export const IDLE_RUN: AgentRun | null = null;

/**
 * Folds the raw utility-process stream into the shape the transcript renders.
 * Consecutive text deltas append to the trailing text part so streaming reads as
 * one growing message rather than a wall of fragments.
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
      const detail = event.detail ?? "";
      const phase: ToolPhase = detail.startsWith("error") ? "error" : detail.startsWith("done") ? "done" : "running";
      // A tool reports twice — once when invoked and once when it settles. Update
      // the open row in place so the transcript does not duplicate the call.
      const openIndex = parts.findIndex((part) => part.kind === "tool" && part.tool === tool && part.phase === "running");
      if (openIndex >= 0 && phase !== "running") {
        parts[openIndex] = { ...(parts[openIndex] as Extract<RunPart, { kind: "tool" }>), detail, phase };
        return { ...run, parts };
      }
      parts.push({ kind: "tool", id: `${event.runId}-x${parts.length}`, tool, detail, phase });
      return { ...run, parts, status: "streaming" };
    }

    case "status": {
      const body = event.detail ?? event.text ?? "";
      if (!body) return run;
      if (last?.kind === "status") parts[parts.length - 1] = { ...last, body };
      else parts.push({ kind: "status", id: `${event.runId}-s${parts.length}`, body });
      return { ...run, parts, status: "streaming" };
    }

    case "error":
      parts.push({ kind: "error", id: `${event.runId}-e${parts.length}`, body: event.text ?? "The Training Agent failed." });
      return { ...run, parts, status: "error" };

    case "done":
      return { ...run, parts, status: "done" };

    default:
      return run;
  }
}

/** Human label for a tool id emitted by the training agent. */
export function toolLabel(tool: string): string {
  const spaced = tool.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
