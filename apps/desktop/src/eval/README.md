# Spar's eval

```bash
pnpm --filter @spar/desktop eval run
pnpm --filter @spar/desktop eval compare --against v0.6.1 --gate
pnpm --filter @spar/desktop eval diff --against v0.6.1 --scenario window-invariant-restoration

# The real agent, against a real model, recorded as it goes:
SPAR_EVAL_API_KEY=… SPAR_EVAL_MODEL=claude-opus-5 \
  pnpm --filter @spar/desktop eval run --mode live
# and then, for nothing, for ever:
pnpm --filter @spar/desktop eval run --mode replay
```

When `SPAR_TELEMETRY_ORIGIN` and `SPAR_TELEMETRY_TOKEN` are set, `run` and the
candidate side of `compare` upload every trace and deterministic score to Spar's
backend. The premade observability UI groups them as one experiment while the
JSON/JSONL artifacts here remain the reproducible source used by gates and
diffs. The token is a normal bearer session for a dedicated eval account; model
and observability provider secrets remain server-side.

## What it measures

Spar's claim is not that it answers well. It is that it works out what a learner
specifically gets wrong, holds on to that across attempts, and lets it decide
what they see next. So the unit of evaluation is not a response — it is a
**run of attempts and the ledger it produced**.

A scenario is a learner with a stated misconception and a sequence of attempts
written to be consistent with it. The ground truth is *constructed*, not
labelled: nobody annotates what the learner's problem is afterwards, the fixture
declares it first and the attempts follow. That is what lets these be scored with
no judge at all, and it is why a change to the ledger can be defended rather than
asserted.

## The two halves

`packages/eval` is a framework with no idea what Spar is: traces, checks,
statistics, diffing, gating. `apps/desktop/src/eval` is everything Spar-specific,
and it lives beside the host because scenarios that drive the real store, the
real migrations and the real tool contract cannot honestly live anywhere else.
The split is load-bearing — if the framework could reach into the app it would,
and within a month the statistics would have Spar's vocabulary in them.

## What is scripted and what is not

The store is real: `:memory:`, same schema, same triggers, same reconciliation.
The learner is scripted, so the ground truth is known. And on these runs the
agent is scripted too, which decides what the numbers mean:

> **A scripted-agent run measures the host, not the model.**

The agent's policy is identical in both arms of a comparison, so any difference
in the outcome is a difference in what Spar's host made possible. That is the
right instrument for "did this ledger change help" and the wrong one for "is the
agent any good" — live-model runs answer that, cost money, and are never averaged
in with these.

The scripted agent obeys one rule that everything depends on: **it may only act
on what a tool handed back.** It never reads the store. An agent that peeked
would find its own earlier hypothesis in both arms and the run would show no
difference, where the real difference is that one arm could not see it.

## Live runs, and the tape

`--mode live` runs Spar's **real agent worker** — the shipping phase controller,
the shipping prompts, the shipping tool contract — against a real model, with
every tool call going to the real store. Nothing is stubbed. The worker talks to
the outside world through `process.parentPort` and through `fetch`, and the
harness supplies both: it plays the part the main process plays, and it records
every HTTP call to a cassette.

Recording at `fetch` rather than at the provider adapter is deliberate. It is the
only seam where what is captured is what the provider *actually received and
returned*, so a replay exercises every line of Spar's own code — including the
per-family translation of a forced tool choice, which is exactly the layer a
provider-level stub would stop testing. It also costs the product nothing: no
test mode, no injection point, no environment variable read by shipping code.

A cassette entry is keyed on the model, the URL and a digest of the request body
— which is to say, on the question the model was asked. That makes
**counterfactual replay** meaningful: change the host, replay, and every turn
where the new code asked the same thing answers for free while every turn where
it asked something different is reported as a **miss**. The misses are the
finding. They are precisely the turns the change affected. A fuzzy key that
matched "near enough" would hand back an answer to a question nobody asked and
call it a passing run.

Cassettes carry prompts and completions. They never carry an `Authorization`
header, an api key or a cookie.

## The comparison

`compare --against <ref>` checks out that commit in a worktree, copies *today's*
scenarios and verifiers on top of it, and runs the same suite there. The
scenarios travel because they did not exist at the baseline; the host does not,
because the host is what is being measured.

Which is why the harness probes rather than assumes. Against a commit whose store
has no `decayAbilities` and cannot read its own patterns back, the affected
checks skip and the missing capabilities are recorded in the trace. "The baseline
could not see its own patterns" is the finding; "the baseline crashed" would have
thrown it away.

Runs are paired on `scenario#seed` and every difference is put through McNemar's
exact test, so a change that fixed two runs and broke one is not reported as
progress. Measures get a paired bootstrap interval. The gate fails on a
regression only when it is paired, significant, and on a check that does not
disagree with itself across repeats — an unstable check is reported under its own
heading and gates nothing, because a red build nobody believes is worse than no
build.

## Honest about seeds

A scripted run has no randomness in it. Eight seeds would produce eight identical
traces and a zero-width confidence interval, which is a lie told with real
arithmetic. The runner fingerprints each run and names duplicates rather than
averaging them. Seeds start meaning something the moment a live model is in the
loop; the statistics are already there waiting.

## Time

The harness holds the clock still for the length of a run. This is not a nicety:
the ledger weights evidence by age against the real clock, so a scenario stamped
in January reads as three-quarters decayed when the suite runs in September, and
the same commit would score differently in spring than in autumn. A run is a
simulation of a span of time and the store is supposed to believe it.

## Files

| | |
|---|---|
| `scenarios.ts` | the learners, their misconceptions, and what each run ought to have led Spar to conclude |
| `harness.ts` | one scenario against a real store; durable events, snapshots after each attempt, a sixty-day idle at the end |
| `agent.ts` | the scripted competent agent, validated against the real tool contract on every call |
| `verifiers.ts` | the deterministic checks and the measures, driven by each scenario's own `expect` block |
| `run.ts` | the suite, scored, traces kept |
| `baseline.ts` | the worktree machinery for running the same suite against an older Spar |
| `worker.ts` | hosts Spar's real agent worker in-process, playing the main process |
| `live.ts` | the live agent: real turns, built from the same `agentTurnPayload` the app uses |
| `cli.ts` | `run`, `compare`, `diff` |

## What pi already gives us, and what it does not

Spar runs on `@earendil-works/pi-agent-core`. It ships a vendor-neutral telemetry
contract for provider requests, with model, API, streaming and token detail;
Spar now adapts that contract into its durable OTLP trace alongside controller
phases, host tools, retries and eval scores. Pi also ships a
`harness/session/testing` entry point, which is storage conformance and storage
benchmarks for pi's own session repository. Neither is an eval: there is no
notion of a scenario, a verifier, a pass rate, a paired test or a regression
gate, because those are claims about *your* product and pi has no way to know
what yours is. The token counts here and in observability come from the
provider's own reply rather than from a second estimator.
