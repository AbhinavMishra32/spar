import { randomUUID } from "node:crypto";
import type { LocalStore } from "./store.js";

export type AgentRunStart = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  turnKind: string;
  input: Record<string, unknown>;
  appVersion: string;
};

type RunState = AgentRunStart & { sequence: number; startedAt: string };

/**
 * The durable bridge between the agent utility process and cloud telemetry.
 *
 * Sequence numbers are assigned before an event enters SQLite's sync outbox.
 * The backend can therefore accept every write idempotently, and a process or
 * network failure can only delay a trace — it cannot reorder or partially
 * overwrite it. Provider keys never enter these payloads.
 */
export class AgentTelemetry {
  private readonly runs = new Map<string, RunState>();

  constructor(private readonly store: LocalStore) {}

  start(value: AgentRunStart) {
    const state = { ...value, sequence: 0, startedAt: new Date().toISOString() };
    this.runs.set(value.runId, state);
    this.store.queueAgentTelemetry("agent-run-start", {
      id: value.runId,
      sessionId: value.sessionId,
      origin: "product",
      mode: "live",
      status: "running",
      turnKind: value.turnKind,
      provider: value.provider,
      model: value.model,
      schemaVersion: 1,
      appVersion: value.appVersion,
      input: value.input,
      metadata: { runtime: "pi", transport: "spar-outbox" },
      startedAt: state.startedAt,
    });
  }

  record(runId: string, event: Record<string, unknown>) {
    const state = this.runs.get(runId);
    if (!state) return;
    const source = event.type === "telemetry" ? event
      : event.type === "status" ? { type:"telemetry",kind:"agent",name:String(event.detail??"status"),detail:event.detail,context:event.context }
      : event.type === "error" ? { type:"telemetry",kind:"event",name:"provider-error",level:"ERROR",error:event.text }
      : null;
    /* Text and reasoning deltas are intentionally not rows: the completed Pi
       message on the generation span contains them losslessly, while recording
       one SQLite/outbox row per token is the kind of amplification that can
       itself make a long run unstable. */
    if(!source)return;
    const sequence = state.sequence;
    state.sequence += 1;
    const { type: _type, kind, name, phase, callId, level, occurredAt, ...rest } = source;
    const payload = { ...(typeof phase === "string" ? { state: phase } : {}), ...rest };
    this.store.queueAgentTelemetry("agent-trace-event", {
      id: randomUUID(),
      runId,
      sequence,
      kind: String(kind ?? "event"),
      name: String(name ?? kind ?? "event"),
      ...(typeof phase === "number" ? { phase } : {}),
      ...(typeof callId === "string" ? { callId } : {}),
      level: typeof level === "string" ? level : "DEFAULT",
      payload,
      occurredAt: typeof occurredAt === "string" ? occurredAt : new Date().toISOString(),
    });
  }

  finish(runId: string, value: Record<string, unknown>, error?: unknown) {
    const state = this.runs.get(runId);
    if (!state) return;
    this.runs.delete(runId);
    const usage = value.usage && typeof value.usage === "object" ? value.usage as Record<string, unknown> : {};
    const completedAt = new Date().toISOString();
    this.store.queueAgentTelemetry("agent-run-finish", {
      id: runId,
      status: error ? "error" : value.finishReason === "stopped" ? "cancelled" : "completed",
      output: {
        text: typeof value.text === "string" ? value.text : "",
        finishReason: typeof value.finishReason === "string" ? value.finishReason : error ? "error" : "stop",
        phaseSteps: typeof value.phaseSteps === "number" ? value.phaseSteps : undefined,
      },
      promptTokens: numberOrUndefined(usage.inputTokens),
      completionTokens: numberOrUndefined(usage.outputTokens),
      cachedInputTokens: numberOrUndefined(usage.cachedInputTokens),
      eventCount: state.sequence,
      latencyMs: Math.max(0, Date.parse(completedAt) - Date.parse(state.startedAt)),
      error: error instanceof Error ? error.message : error === undefined ? null : String(error),
      completedAt,
    });
  }
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
}
