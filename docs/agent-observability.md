# Agent observability

Spar records one root trace for every product turn and eval scenario. The trace
contains Pi provider spans, every phase prompt and response, host tool inputs and
outputs, validation failures, retries, fallback decisions, token/cache usage,
latency, and the final outcome. Eval traces also carry their scenario, seed,
arm, mode, commit, deterministic checks, and measures.

The system has two planes:

1. Spar's authenticated API is the durable ownership plane. The Electron app
   writes ordered events into its SQLite sync outbox before sending them. The API
   stores run summaries in `agent_runs`, append-only detail in
   `agent_trace_events`, and eval results in `agent_eval_scores`.
2. OpenTelemetry is the analysis plane. When a run closes, the API assembles one
   immutable OTLP hierarchy and exports it to a premade UI. No observability
   vendor or collector credential is packaged in the desktop app.

## Langfuse (recommended)

Langfuse is the default because it provides the full trace, generation/tool
views, cost and latency analytics, datasets, experiments, evaluators, and
annotation workflows in one self-hostable UI. Deploy Langfuse using its official
Docker Compose, Kubernetes, AWS, Azure, or GCP guide, create a project, then put
the project credentials on the Spar API:

```dotenv
LANGFUSE_BASE_URL=https://langfuse.internal.example.com
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

The exporter uses the current OpenTelemetry ingestion endpoint and v4 ingestion
header. Product runs appear under `production` (or the API's environment); eval
runs appear under `experiment` and are grouped by suite, arm, scenario, and seed.

## LangSmith

Spar also supports LangSmith's native `/runs/batch` ingestion contract. Set the
following on the API server; LangSmith becomes the exporter selected ahead of
Langfuse and generic OTLP:

```dotenv
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=pr-memorable-acceptance-75
LANGSMITH_OTEL_ENABLED=true
```

The API converts the same root/child hierarchy into LangSmith chain, LLM, and
tool runs with parent IDs, project, session, release, model, input/output,
errors, and eval metadata. The key never reaches Electron or the worker.

## Phoenix or an OTEL collector

Point the API at any OTLP/HTTP JSON traces endpoint instead:

```dotenv
TELEMETRY_OTLP_TRACES_URL=https://collector.example.com/v1/traces
TELEMETRY_OTLP_HEADERS={"Authorization":"Bearer server-only-token"}
```

These variables override the Langfuse shortcut. A collector can also fan the
same spans out to more than one backend.

Pi can also be traced in LangSmith, but that is a different exporter path:
LangSmith's tracing client or OpenTelemetry integration must instrument and send
the Pi/Spar spans using LangSmith's supported ingestion contract. Spar currently
ships the complete Pi trace through its durable OTLP path to Langfuse, Phoenix,
or a collector; it does not pretend that an arbitrary OTLP endpoint is a native
LangSmith ingestion endpoint.

## Eval uploads

The eval runner uploads only when both variables are present:

```dotenv
SPAR_TELEMETRY_ORIGIN=https://api.tryspar.dev
SPAR_TELEMETRY_TOKEN=dedicated-eval-account-bearer-token
```

Then use the existing commands. Uploading does not replace local artifacts or
change the gate result:

```bash
pnpm --filter @spar/desktop eval run --mode live
pnpm --filter @spar/desktop eval compare --against v0.6.9 --gate
```

## Data handling

Operator telemetry intentionally includes full prompts, model messages, tool
arguments/results, hidden validator diagnostics, and controller state. Fields
whose names conventionally contain credentials (`apiKey`, `authorization`,
tokens, passwords, secrets, or cookies) are recursively redacted inside the
agent utility process before data leaves it. Individual structured values above
750,000 characters are marked and clipped so a single malformed provider or
tool payload cannot recreate the memory-pressure failure telemetry is meant to
diagnose.

Session ownership is checked on every product run. Eval runs require an
authenticated bearer token but no learner session. Ingestion is idempotent on
run ID and `(run ID, sequence)`, and traces are exported only after completion.
