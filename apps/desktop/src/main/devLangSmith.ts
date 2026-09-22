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
  private readonly roots = new Map<string, { dottedOrder: string; start: RunStart & { startedAt: string } }>();
  private readonly postedChildren = new Set<string>();
  private pending = Promise.resolve();

  constructor(private readonly request: typeof fetch = fetch, environment: NodeJS.ProcessEnv = process.env) {
    this.config = config(environment);
  }

  configured() { return Boolean(this.config); }

  start(value: RunStart & { startedAt: string }) {
    if (!this.config) return;
    const dottedOrder = order(value.startedAt, value.runId);
    this.roots.set(value.runId, { dottedOrder, start: value });
    this.send({ post: [rootRun(value, this.config.project, dottedOrder)], patch: [] });
  }

  record(value: TraceEvent) {
    if (!this.config) return;
    const root = this.roots.get(value.runId);
    if (!root) return;
    const childId = stableUuid(`${value.runId}:${value.kind}:${value.callId ?? value.id}`);
    const state = typeof value.payload.state === "string" ? value.payload.state : null;
    const child = childRun(value, root.start, this.config.project, childId, `${root.dottedOrder}.${order(value.occurredAt, childId)}`);
    if (state === "end" && this.postedChildren.has(childId)) {
      this.send({ post: [], patch: [child] });
      return;
    }
    this.postedChildren.add(childId);
    this.send({ post: [child], patch: [] });
  }

  finish(value: RunFinish) {
    if (!this.config) return;
    const root = this.roots.get(value.id);
    if (!root) return;
    this.roots.delete(value.id);
    this.send({ post: [], patch: [{
      ...rootRun(root.start, this.config.project, root.dottedOrder),
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
    start_time: Date.parse(value.startedAt),
    inputs: value.input,
    extra: metadata(value),
    tags: ["spar-development", "development", "product", "live", value.provider],
    serialized: { name: `spar.product.${value.turnKind}` },
  };
}

function childRun(value: TraceEvent, start: RunStart, project: string, id: string, dottedOrder: string) {
  const state = typeof value.payload.state === "string" ? value.payload.state : null;
  const error = value.level === "ERROR" || value.payload.ok === false ? String(value.payload.error ?? value.payload.detail ?? "Operation failed") : undefined;
  return {
    id,
    name: value.name,
    run_type: value.kind === "generation" ? "llm" : value.kind === "tool" ? "tool" : "chain",
    project_name: project,
    session_name: project,
    trace_id: value.runId,
    parent_run_id: value.runId,
    dotted_order: dottedOrder,
    start_time: Date.parse(value.occurredAt),
    ...(state === "start" ? {} : { end_time: Date.parse(value.occurredAt) }),
    inputs: value.payload.input ?? {},
    outputs: value.payload.output ?? value.payload,
    error,
    extra: {
      ...metadata(start),
      metadata: { ...metadata(start).metadata, sequence: value.sequence, phase: value.phase, callId: value.callId, state },
    },
    tags: ["spar-development", "development", "product", "live", start.provider, value.kind],
    serialized: { name: value.name },
  };
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

function order(occurredAt: string, id: string) {
  const iso = new Date(occurredAt).toISOString();
  const timestamp = `${iso.slice(0, 19).replace(/[-:]/g, "")}${iso.slice(20, 23)}000Z`;
  return `${timestamp}${id.replaceAll("-", "")}`;
}

function stableUuid(seed: string) {
  const value = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`;
}
