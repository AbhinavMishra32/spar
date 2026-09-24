import { randomUUID } from "node:crypto";
import { TraceWriter, digest, installCassette, type Cassette, type CassetteDeck, type CassetteMode, type RunHeader, type Trace } from "@spar/eval";
import { LocalStore } from "../main/store.js";
import type { QuestionDesign } from "@spar/domain";
import { capabilities, snapshot } from "./ledger.js";
import { scriptedAgent } from "./agent.js";
import { agentToolSchemas } from "../workers/agentTools.js";
import { liveAgent, replayProvider } from "./live.js";
import type { Scenario, ScenarioAgent } from "./types.js";

/**
 * One scenario, run against a real Spar.
 *
 * A real store on a real schema — `:memory:`, but the same migrations, the same
 * triggers, the same reconciliation. Nothing here is mocked, because the things
 * this eval is about are the host's own decisions and a mock of the host would
 * simply agree with whatever it was written to agree with.
 *
 * What *is* scripted is the two ends. The learner is scripted, so the ground
 * truth about what they got wrong is known rather than inferred. And on the
 * runs this file produces the agent is scripted too, which needs saying plainly
 * because it decides what these numbers mean:
 *
 * **A scripted-agent run measures the host, not the model.** The agent's policy
 * is fixed and identical in both arms of a comparison, so any difference in the
 * result is a difference in what Spar's host made possible. That is exactly the
 * right instrument for "did this change to the ledger help" and exactly the
 * wrong one for "is the agent any good" — the live-model runs answer that, cost
 * money, and are reported separately and never averaged in.
 *
 * The scripted agent is written to be *competent*, not omniscient: it reads
 * before it writes, it uses only what the host hands back, and it never reaches
 * into the store for something a tool did not tell it. That last rule is what
 * makes the comparison mean anything. An agent that peeked would find the
 * pattern it wrote three attempts ago in either arm, and the run would show no
 * difference where the real difference is that one arm could not see it.
 */

export type RunOptions = {
  scenario: Scenario;
  arm: string;
  seed: number;
  /** Which agent drives the run.
   *
   *  `scripted` holds the pedagogy fixed and measures the host. `live` and
   *  `replay` run Spar's real worker: `live` against the provider, recording as
   *  it goes, and `replay` against what was recorded. They answer different
   *  questions and their numbers are reported separately, never averaged. */
  mode?: "scripted" | "live" | "replay";
  cassette?: Cassette;
  cassetteMode?: CassetteMode;
  /** Injected so a run is reproducible to the millisecond and two runs of the
   *  same seed produce byte-identical traces. Real time would put a different
   *  `atMs` on every event and make every diff noise. */
  now?: () => number;
};

/** Attempts land a day apart, so recency weighting, decay and the rating's own
 *  idea of elapsed time all have something to work with — and so that a run in
 *  January and the same run in June produce the same ledger. */
const DAY_MS = 86_400_000;
const EPOCH = Date.parse("2026-01-05T09:00:00.000Z");

export type RunOutcome = { trace: Trace; cassette?: Cassette };

export async function runScenario(options: RunOptions): Promise<Trace> {
  return (await runScenarioWithTape(options)).trace;
}

export async function runScenarioWithTape(options: RunOptions): Promise<RunOutcome> {
  const { scenario, arm, seed } = options;
  const mode = options.mode ?? "scripted";
  let clock = EPOCH;
  let modelStep = 0;
  /* Before the store exists, because the store stamps rows on construction. */
  const release = freezeClock(() => clock);
  const store = new LocalStore(":memory:");
  const at = () => new Date(clock).toISOString();
  const writer = new TraceWriter(header(scenario, arm, seed, mode), options.now ?? (() => clock - EPOCH));
  /* Only for a run that talks to a provider. A scripted run makes no request at
     all, and swapping `fetch` under one would be a global replaced for nothing. */
  const deck: CassetteDeck | null = mode === "scripted" ? null : installCassette({
    ...(options.cassette ? { cassette: options.cassette } : {}),
    mode: options.cassetteMode ?? (mode === "replay" ? "replay" : "auto"),
    /* Every model call, in the trace, from the one place that sees all of them.
       The latency on a replayed call is the latency that was originally
       observed — `replayed` is carried beside it so a cost-and-speed report can
       say which runs it is entitled to draw conclusions from. */
    onCall: (call) => {
      modelStep += 1;
      writer.emit({ kind: "model_request", step: modelStep, requestHash: call.key, toolChoice: String(toolChoiceOf(call.requestBody)), promptChars: call.requestBody.length });
      writer.emit({
        kind: "model_response", step: modelStep, requestHash: call.key, responseHash: digest(call.responseBody),
        calls: [], latencyMs: Math.round(call.latencyMs), replayed: call.replayed,
        ...(usageOf(call.responseBody) ? { usage: usageOf(call.responseBody)! } : {}),
      });
    },
    /* The real clock, deliberately. A recorded call's duration is how long the
       provider took, and the run's frozen clock would record every one of them
       as instantaneous. */
    now: () => RealNow(),
  });
  let agent: ScenarioAgent | null = null;

  try {
    store.saveProfile({
      name: scenario.profile.name,
      experience: scenario.profile.experience,
      focus: [scenario.profile.focus],
      weakness: scenario.profile.weakness,
      language: scenario.profile.language as never,
      completedAt: at(),
    });
    writer.emit({ kind: "note", text: `capabilities ${JSON.stringify(capabilities(store))}` });
    writer.emit({ kind: "note", text: `contract ${JSON.stringify(contractProbe())}` });

    const { sessionId } = store.createSession(scenario.goal);
    writer.emit({ kind: "turn_started", turnKind: "session-start", session: "session#1" });
    store.setObjective(sessionId, `Working on ${scenario.ability.title.toLowerCase()}.`);

    /* Before anything has happened, so "the rating moved" is measured from where
       this learner actually started rather than from where the first attempt
       left them. */
    writer.emit({ kind: "ledger", label: "start", snapshot: snapshot(store) });

    agent = mode === "scripted"
      ? scriptedAgent({ store, sessionId, scenario, writer })
      : await liveAgent({ store, sessionId, scenario, writer, provider: replayProvider() });
    await agent.openTarget();

    for (const [index, attempt] of scenario.attempts.entries()) {
      const attemptNumber = index + 1;
      clock += DAY_MS;

      /* The challenge is written straight to the store rather than compiled.
         The compiler is exercised by its own suite and takes seconds per
         candidate in seven languages; what these scenarios are about is what the
         ledger concludes from a sequence of attempts, and paying a full
         compilation per attempt would buy nothing and cost minutes. */
      const question = store.createQuestion(sessionId, design(scenario, attemptNumber), { valid: true, checks: [] }, { concepts: scenario.ability.concepts });
      const events = recordAttempt(store, question.attemptId, attempt, clock);
      writer.emit({
        kind: "attempt", attempt: `attempt#${attemptNumber}`, outcome: attempt.outcome,
        hints: attempt.hints, submissions: 1, misconception: scenario.misconception.slug,
      });

      writer.emit({ kind: "turn_started", turnKind: "attempt-complete", session: "session#1" });
      await agent.afterAttempt({ attemptNumber, attemptId: question.attemptId, attempt, eventIds: events });
      writer.emit({ kind: "ledger", label: `after-attempt-${attemptNumber}`, snapshot: snapshot(store) });
    }

    /* Six weeks on with nothing touched, so a build that decays stale abilities
       gets the chance to and a build that does not is shown not to. Runs after
       the last snapshot so it can never be mistaken for a conclusion drawn from
       an attempt. */
    clock += 60 * DAY_MS;
    const decayed = typeof (store as unknown as Record<string, unknown>).decayAbilities === "function" ? store.decayAbilities(new Date(clock)) : [];
    writer.emit({ kind: "note", text: `idle-60-days decayed ${decayed.length}` });
    writer.emit({ kind: "ledger", label: "after-idle", snapshot: snapshot(store) });
  } catch (error) {
    writer.emit({ kind: "error", message: error instanceof Error ? error.message : String(error), fatal: true });
  } finally {
    agent?.close?.();
    store.close();
    release();
    deck?.restore();
  }

  if (deck) {
    writer.emit({ kind: "note", text: `cassette replayed ${deck.hits}, recorded ${deck.recorded}, missed ${deck.misses.length}` });
    /* Named individually, because a miss is the most informative thing a
       counterfactual replay produces: it is a turn where the new code asked the
       model something the old code never did. */
    for (const miss of deck.misses) writer.emit({ kind: "note", text: `cassette-miss ${miss.key} ${miss.url}` });
  }
  return { trace: writer.trace(), ...(deck ? { cassette: deck.cassette() } : {}) };
}

/**
 * Token counts, read off the provider's own reply.
 *
 * Deliberately tolerant and deliberately silent when it fails. Every provider
 * family spells usage differently and a streamed body carries it in whichever
 * event happens to hold it; a reader that threw on an unfamiliar shape would
 * take down a run over a number that is only ever reported, never gated on. No
 * usage is reported as no usage, which is the truth.
 */
function usageOf(body: string): { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null {
  const match = /"(?:usage|token_usage)"\s*:\s*(\{[^{}]*\})/g;
  let best: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null = null;
  for (const found of body.matchAll(match)) {
    try {
      const parsed = JSON.parse(found[1]!) as Record<string, number>;
      const input = parsed.input_tokens ?? parsed.prompt_tokens ?? parsed.input ?? 0;
      const output = parsed.output_tokens ?? parsed.completion_tokens ?? parsed.output ?? 0;
      const cached = parsed.cache_read_input_tokens ?? parsed.cached_tokens ?? 0;
      /* The last usage block in a stream is the cumulative one. */
      if (input || output) best = { inputTokens: input, outputTokens: output, cachedInputTokens: cached };
    } catch { /* not a usage block after all */ }
  }
  return best;
}

/** What the request demanded of the model about tools, for the trace. A phase
 *  that forced a specific call and a phase that left it open are the two halves
 *  of Spar's controller, and a trace that could not tell them apart would make
 *  a diff of two runs unreadable. */
function toolChoiceOf(body: string): unknown {
  try { return (JSON.parse(body) as { tool_choice?: unknown }).tool_choice ?? ""; } catch { return ""; }
}

/** The wall clock, captured before the run freezes the global one. */
const RealNow = (() => { const real = Date.now.bind(Date); return () => real(); })();

/**
 * What this build's tool contract will and will not accept.
 *
 * Recorded as a fact about the build rather than checked inside a verifier,
 * because a verifier is a pure function of the trace and may not go and ask the
 * code what it thinks. It is the one thing in the whole eval that a run cannot
 * demonstrate by behaving: a contract that lets an interpretation-free update
 * through is only visible when somebody tries to send one, and the scripted
 * agent never would — it is written to be competent. So the harness tries it
 * once, in the one place where trying it is not cheating.
 */
function contractProbe(): { evidenceRequired: boolean } {
  const schema = agentToolSchemas().propose_ability_update;
  if (!schema) return { evidenceRequired: false };
  /* Real uuids, because the fields are typed as uuids and a probe rejected for
     the shape of its ids would say nothing about interpretation at all. */
  const abilityId = randomUUID();
  const eventId = randomUUID();
  const base = { actionTitle: "Probe", abilityId, markdown: "# Probe\n\nA probe of what this build's contract will accept.", evidenceEventIds: [eventId], summary: "A probe of the contract, not a claim about anybody." };
  const accepts = (input: Record<string, unknown>) => {
    try { schema.parse(input); return true; } catch { return false; }
  };
  /* Two probes, not one. A build that refuses the bare call for some unrelated
     reason — a field that used to be required and is not any more — would look
     from one probe exactly like a build that insists on interpretation. So the
     rule only counts as present when the call with an interpretation is accepted
     and the same call without one is not. */
  const withEvidence = accepts({ ...base, evidence: [{ eventId, statement: "Probe reading of the attempt.", polarity: "supporting", independence: "independent", strength: 0.5 }] });
  return { evidenceRequired: withEvidence && !accepts(base) };
}

/**
 * The clock, held still for the length of a run.
 *
 * Not a nicety. The ledger's own reading of the evidence weights it by age —
 * half-life forty-five days — and the store computes that age against the real
 * clock, not against anything the caller passes in. So a scenario whose attempts
 * are stamped in January reads as three-quarters decayed when the suite is run
 * in September, and the same commit scores differently in the spring than in the
 * autumn. That is not an eval; it is a calendar.
 *
 * Every other option was worse. Stamping the fixtures at "now" makes the trace
 * different on every run and unable to be diffed. Threading a clock through
 * every store method that reads one changes production code to suit a test. So
 * the harness owns time for the duration of the run and hands it back in a
 * `finally`, which is the one place in this codebase where replacing a global is
 * the honest thing to do: the run *is* a simulation of a span of time, and the
 * store is supposed to believe it.
 */
function freezeClock(read: () => number): () => void {
  const RealDate = globalThis.Date;
  class FrozenDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(read());
      else super(...(args as [number]));
    }
    static override now(): number {
      return read();
    }
  }
  globalThis.Date = FrozenDate as unknown as DateConstructor;
  return () => { globalThis.Date = RealDate; };
}

function header(scenario: Scenario, arm: string, seed: number, mode: "scripted" | "live" | "replay"): RunHeader {
  return {
    schemaVersion: 1,
    runId: `${scenario.id}-${arm}-${seed}`,
    scenario: scenario.id,
    seed,
    arm,
    mode,
    model: mode === "scripted" ? "" : replayProvider().model,
    startedAt: new Date(EPOCH).toISOString(),
    config: { agent: mode === "scripted" ? "scripted-competent" : "spar-worker" },
  };
}

/**
 * The learner's attempt, as durable events.
 *
 * Written as the real thing rather than summarised, because the durable event is
 * the unit everything downstream keys on: evidence links to an event id, the
 * replay folds events into per-case verdicts, and the rating counts hint
 * requests. A scenario that recorded only an outcome would leave the agent with
 * nothing to link its interpretation to, which is the exact shape of the failure
 * these scenarios are meant to catch.
 *
 * Returns the ids of the events an interpretation may be attached to, newest
 * last — the agent picks from these and may not invent one.
 */
function recordAttempt(store: LocalStore, attemptId: string, attempt: { outcome: string; hints: number; regressed: boolean }, clock: number): string[] {
  const linkable: string[] = [];
  let sequence = 0;
  const append = (type: string, payload: Record<string, unknown>, offsetMs: number, linkable_ = false) => {
    const id = randomUUID();
    sequence += 1;
    store.appendEvent({ id, attemptId, sequence, type: type as never, occurredAt: new Date(clock + offsetMs).toISOString(), payload, source: "learner", schemaVersion: 1 });
    if (linkable_) linkable.push(id);
    return id;
  };

  append("attempt_started", {}, 0);
  for (let hint = 0; hint < attempt.hints; hint += 1) append("hint_requested", { index: hint }, 60_000 * (hint + 1));
  /* Two runs, and the second one is the point. A case that passed and then
     failed again is the signature of an invariant restored once rather than
     repeatedly, and the replay calls a regression the most diagnostic thing in
     a trace — so a scenario claiming inconsistency has to actually produce one
     rather than assert it in prose. */
  append("test_run", { passed: 2, failed: 2, cases: ["shrink-once", "shrink-twice"] }, 300_000, true);
  if (attempt.regressed) append("test_run", { passed: 1, failed: 3, regressed: ["shrink-twice"], cases: ["shrink-once", "shrink-twice"] }, 600_000, true);
  append("submission_created", {}, 900_000, true);
  append("attempt_completed", { outcome: attempt.outcome }, 960_000, true);

  if (attempt.outcome === "passed") store.completeAttempt(attemptId, "passed");
  else store.abandonAttempt(attemptId, "Gave up on this one", "learner", "abandoned");
  return linkable;
}

/** A challenge shaped like the ones Spar writes, with nothing in it that any
 *  verifier reads. It exists so the attempt has something to hang off. */
function design(scenario: Scenario, ordinal: number): QuestionDesign {
  const title = `${scenario.ability.title} ${ordinal}`;
  return {
    title,
    language: scenario.profile.language as never,
    kind: "function",
    statement: `Restore the stated invariant after every change, however many steps that takes. (${digest(title)})`,
    starterFiles: { "src/index.js": "export function solve(){ throw new Error(\"implement\") }" },
    referenceFiles: { "src/index.js": "export function solve(){ return true }" },
    visibleTests: { "tests/visible.test.js": "// visible" },
    hiddenTests: { "tests/hidden.test.js": "// hidden" },
    knownIncorrectFiles: [{ "src/index.js": "export function solve(){ return false }" }],
    runCommand: "node --test",
    accidentalDifficulty: [],
    expectedFailureSignatures: [scenario.misconception.statement],
  };
}
