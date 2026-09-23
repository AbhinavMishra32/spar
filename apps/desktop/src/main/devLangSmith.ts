import { createHash } from "node:crypto";

type RunStart = {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  turnKind: string;
  input: Record<string, unknown>;
  appVersion: string;
};

type TraceEvent = {
  id: string;
  runId: string;
  sequence: number;
  kind: string;
  name: string;
  phase?: number;
  callId?: string;
  level: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

type RunFinish = {
  id: string;
  status: string;
  output: unknown;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
  estimatedCostMicros?: number | undefined;
  eventCount: number;
  latencyMs: number;
  error: string | null;
  completedAt: string;
};

export type AgentTraceSink = {
  start(value: RunStart & { startedAt: string }): void;
  record(value: TraceEvent): void;
  finish(value: RunFinish): void;
};

type Config = { endpoint: string; apiKey: string; project: string };
type ChildState = { id: string; parentId: string; dottedOrder: string; startedAt: string; executionOrder: number; childExecutionOrder: number };
type RootState = { dottedOrder: string; start: RunStart & { startedAt: string }; children: Map<string, ChildState>; childrenById: Map<string, ChildState>; nextExecutionOrder: number };

/**
 * Development traces go straight from Electron's main process to LangSmith.
 *
 * Product sync remains durable and authenticated, but it is deliberately not
 * on this path: a stale Spar login or an old learner-state row must not hide a
 * trace while somebody is debugging the agent. The LangSmith key never enters
 * the renderer or the agent utility process.
 */
export class DevLangSmithTraceSink implements AgentTraceSink {
  private readonly config: Config | null;
  private readonly roots = new Map<string, RootState>();
  private pending = Promise.resolve();

  constructor(private readonly request: typeof fetch = fetch, environment: NodeJS.ProcessEnv = process.env) {
    this.config = config(environment);
  }

  configured() { return Boolean(this.config); }

  start(value: RunStart & { startedAt: string }) {
    if (!this.config) return;
    const dottedOrder = order(value.startedAt, value.runId, 1);
    this.roots.set(value.runId, { dottedOrder, start: value, children: new Map(), childrenById: new Map(), nextExecutionOrder: 1 });
    this.send({ post: [rootRun(value, this.config.project, dottedOrder)], patch: [] });
  }

  record(value: TraceEvent) {
    if (!this.config) return;
    const root = this.roots.get(value.runId);
    if (!root) return;
    const callId = value.callId ?? value.id;
    let child = root.children.get(callId);
    const state = typeof value.payload.state === "string" ? value.payload.state : null;
    const alreadyStarted = Boolean(child);
    if (!child) {
      const parentCallId = typeof value.payload.parentCallId === "string" ? value.payload.parentCallId : null;
      const parent = parentCallId ? root.children.get(parentCallId) : undefined;
      const id = stableUuid(`${value.runId}:${value.kind}:${callId}`);
      const executionOrder = ++root.nextExecutionOrder;
      child = { id, parentId: parent?.id ?? value.runId, dottedOrder: `${parent?.dottedOrder ?? root.dottedOrder}.${order(value.occurredAt, id, executionOrder)}`, startedAt: value.occurredAt, executionOrder, childExecutionOrder: executionOrder };
      root.children.set(callId, child);
      root.childrenById.set(id, child);
      for (let ancestor = parent; ancestor; ancestor = root.childrenById.get(ancestor.parentId)) ancestor.childExecutionOrder = Math.max(ancestor.childExecutionOrder, executionOrder);
    }
    const run = childRun(value, root.start, this.config.project, child);
    if (state === "end" && alreadyStarted) {
      this.send({ post: [], patch: [run] });
      return;
    }
    this.send({ post: [run], patch: [] });
  }

  finish(value: RunFinish) {
    if (!this.config) return;
    const root = this.roots.get(value.id);
    if (!root) return;
    this.roots.delete(value.id);
    this.send({ post: [], patch: [{
      ...rootRun(root.start, this.config.project, root.dottedOrder),
      child_execution_order: root.nextExecutionOrder,
      end_time: Date.parse(value.completedAt),
      outputs: value.output,
      error: value.error ?? undefined,
      extra: {
        ...metadata(root.start),
        metadata: {
          ...metadata(root.start).metadata,
          status: value.status,
          eventCount: value.eventCount,
          latencyMs: value.latencyMs,
          promptTokens: value.promptTokens,
          completionTokens: value.completionTokens,
          cachedInputTokens: value.cachedInputTokens,
          estimatedCostUsd: value.estimatedCostMicros === undefined ? undefined : value.estimatedCostMicros / 1_000_000,
        },
      },
    }] });
  }

  private send(body: { post: unknown[]; patch: unknown[] }) {
    const current = this.config;
    if (!current) return;
    this.pending = this.pending.then(async () => {
      const response = await this.request(`${current.endpoint.replace(/\/$/, "")}/runs/batch`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": current.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 1_000);
        throw new Error(`LangSmith development trace export failed (${response.status})${detail ? `: ${detail}` : ""}`);
      }
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "LangSmith development trace export failed");
    });
  }
}

function config(environment: NodeJS.ProcessEnv): Config | null {
  if (environment.NODE_ENV !== "development" || environment.LANGSMITH_TRACING === "false") return null;
  const endpoint = environment.LANGSMITH_ENDPOINT?.trim();
  const apiKey = environment.LANGSMITH_API_KEY?.trim();
  const project = environment.LANGSMITH_PROJECT?.trim();
  return endpoint && apiKey && project ? { endpoint, apiKey, project } : null;
}

function rootRun(value: RunStart & { startedAt: string }, project: string, dottedOrder: string) {
  return {
    id: value.runId,
    name: `spar.product.${value.turnKind}`,
    run_type: "chain",
    project_name: project,
    session_name: project,
    trace_id: value.runId,
    dotted_order: dottedOrder,
    execution_order: 1,
    child_execution_order: 1,
    start_time: Date.parse(value.startedAt),
    inputs: value.input,
    extra: metadata(value),
    tags: ["spar-development", "development", "product", "live", value.provider],
    serialized: { name: `spar.product.${value.turnKind}` },
  };
}

function childRun(value: TraceEvent, start: RunStart, project: string, child: ChildState) {
  const state = typeof value.payload.state === "string" ? value.payload.state : null;
  const error = value.level === "ERROR" || value.payload.ok === false ? String(value.payload.error ?? value.payload.detail ?? "Operation failed") : undefined;
  return {
    id: child.id,
    name: value.name,
    run_type: value.kind === "generation" ? "llm" : value.kind === "tool" ? "tool" : "chain",
    project_name: project,
    session_name: project,
    trace_id: value.runId,
    parent_run_id: child.parentId,
    dotted_order: child.dottedOrder,
    execution_order: child.executionOrder,
    child_execution_order: child.childExecutionOrder,
    start_time: Date.parse(child.startedAt),
    ...(state === "start" ? {} : { end_time: Date.parse(value.occurredAt) }),
    ...(state === "end" ? {} : { inputs: value.payload.input ?? {} }),
    ...(state === "start" ? {} : { outputs: withUsageMetadata(value.payload.output ?? value.payload, value.kind === "generation" ? value.payload.usage : undefined) }),
    error,
    extra: {
      ...metadata(start),
      metadata: { ...metadata(start).metadata, sequence: value.sequence, phase: value.phase, callId: value.callId, state, ...(value.kind === "generation" ? { ls_provider: start.provider, ls_model_name: start.model } : {}) },
    },
    tags: ["spar-development", "development", "product", "live", start.provider, value.kind],
    serialized: { name: value.name },
  };
}

/* LangSmith's own shape for an llm run's tokens and cost, so its usage and cost
   columns fill in instead of the numbers sitting unread in the output blob. */
function withUsageMetadata(output: unknown, usage: unknown) {
  if (!usage || typeof usage !== "object") return output;
  const value = usage as Record<string, unknown>;
  const count = (key: string) => typeof value[key] === "number" ? value[key] as number : 0;
  const cacheRead = count("cachedInputTokens");
  const cacheWrite = count("cacheWriteTokens");
  const input = count("inputTokens") + cacheRead + cacheWrite;
  const usageMetadata = {
    input_tokens: input,
    output_tokens: count("outputTokens"),
    total_tokens: input + count("outputTokens"),
    input_token_details: { cache_read: cacheRead, cache_creation: cacheWrite },
    ...(typeof value.costUsd === "number" ? { total_cost: value.costUsd } : {}),
  };
  const base = output && typeof output === "object" && !Array.isArray(output) ? output as Record<string, unknown> : { output };
  return { ...base, usage_metadata: usageMetadata };
}

function metadata(value: RunStart) {
  return {
    metadata: {
      environment: "development",
      sessionId: value.sessionId,
      sparRunId: value.runId,
      sparOrigin: "product",
      sparMode: "live",
      provider: value.provider,
      model: value.model,
      release: value.appVersion,
      runtime: "pi",
      transport: "desktop-direct",
    },
  };
}

function order(occurredAt: string, id: string, executionOrder: number) {
  const iso = new Date(occurredAt).toISOString();
  const microseconds = String(Math.min(executionOrder, 999)).padStart(3, "0");
  const timestamp = `${iso.slice(0, 19).replace(/[-:]/g, "")}${iso.slice(20, 23)}${microseconds}Z`;
  // LangSmith's RunTree appends the canonical UUID. Its tree reader uses the
  // final 36 characters of each segment to recover the corresponding run ID.
  return `${timestamp}${id}`;
}

function stableUuid(seed: string) {
  const value = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`;
}
