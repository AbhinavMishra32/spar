import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, digest, runVerifiers, summarize, type Cassette, type Scorecard, type Summary, type Trace } from "@spar/eval";
import { runScenarioWithTape } from "./harness.js";
import { SCENARIOS, scenarioById } from "./scenarios.js";
import { sparMeasures, sparVerifiers } from "./verifiers.js";
import type { Scenario } from "./types.js";

/**
 * The suite: every scenario, scored, with the traces kept.
 *
 * Traces are written to disk on every run and not just when something fails.
 * They are the only artefact here that survives a change to the verifiers — a
 * scorecard tells you the run failed, a trace lets you ask why six weeks later
 * against a check that did not exist at the time, and re-scoring an old trace
 * costs nothing while re-running an old commit costs a worktree.
 *
 * On seeds, plainly: **a scripted run has no randomness in it.** The clock is
 * injected, the learner is scripted, the agent is scripted, and the store is
 * fresh. Running the same scenario under eight seeds would produce eight
 * byte-identical traces and a confidence interval of zero width, which is a lie
 * told with real arithmetic. So the runner checks — it fingerprints each run and
 * refuses to report variance it did not observe. Seeds start meaning something
 * the moment a live model is in the loop, and the same statistics are waiting
 * for them.
 */

export type SuiteOptions = {
  /** What this run of the suite is called. `candidate` and `baseline` by
   *  convention, because that is what the comparison pairs on. */
  arm: string;
  seeds?: number[];
  scenarios?: string[];
  /** Where traces go. One file per run, plus the scorecards and the summary. */
  outDir?: string;
  /** Which agent drives the runs — see `RunOptions.mode`. */
  mode?: "scripted" | "live" | "replay";
  /** Where the recorded model calls live, one file per scenario. A directory
   *  rather than a file, so re-recording one scenario cannot disturb the others
   *  and a diff of a cassette is a diff of one learner's run. */
  cassetteDir?: string;
};

export type SuiteResult = {
  arm: string;
  scorecards: Scorecard[];
  summary: Summary;
  traces: Trace[];
  /** Runs whose trace was identical to another run of the same scenario. Named
   *  rather than hidden, because a suite quietly averaging duplicates reports a
   *  sample size it does not have. */
  duplicates: string[];
};

export async function runSuite(options: SuiteOptions): Promise<SuiteResult> {
  const { arm, seeds = [1], outDir } = options;
  const mode = options.mode ?? "scripted";
  const chosen: Scenario[] = options.scenarios?.length ? options.scenarios.map(scenarioById) : SCENARIOS;
  const traces: Trace[] = [];
  const scorecards: Scorecard[] = [];
  const seen = new Map<string, string>();
  const duplicates: string[] = [];

  for (const scenario of chosen) {
    for (const seed of seeds) {
      const tape = options.cassetteDir ? readCassette(options.cassetteDir, scenario.id) : undefined;
      const { trace, cassette } = await runScenarioWithTape({
        scenario, arm, seed, mode,
        ...(tape ? { cassette: tape } : {}),
      });
      /* Written back on every non-scripted run, including a replay: a replay
         writes the same bytes it read, and a run in `auto` that filled a gap
         writes the gap. Skipping the write on a replay would mean a cassette
         could only ever grow by a deliberate re-record. */
      if (cassette && options.cassetteDir && mode !== "scripted") writeCassette(options.cassetteDir, scenario.id, cassette);
      traces.push(trace);
      scorecards.push(score(trace, scenario));
      /* The events themselves, not the run header — the header carries the seed,
         so fingerprinting it would make every run unique by construction and
         never find the duplicates this is looking for. */
      const print = digest(trace.events);
      const previous = seen.get(`${scenario.id}#${print}`);
      if (previous) duplicates.push(`${trace.header.runId} is identical to ${previous}`);
      else seen.set(`${scenario.id}#${print}`, trace.header.runId);
    }
  }

  const summary = summarize(arm, scorecards);
  if (outDir) write(outDir, { arm, scorecards, summary, traces, duplicates });
  return { arm, scorecards, summary, traces, duplicates };
}

/**
 * One trace, graded.
 *
 * The scenario is passed in rather than read back out of the trace, because the
 * expectations are ground truth and ground truth does not come from the thing
 * being measured. A trace that claimed its own scenario's expectations could be
 * made to pass by writing them differently.
 */
export function score(trace: Trace, scenario: Scenario): Scorecard {
  return {
    run: trace.header,
    checks: runVerifiers(trace, sparVerifiers(scenario)),
    measures: sparMeasures(trace),
    ...(runFailure(trace) ? { error: runFailure(trace)! } : {}),
  };
}

/**
 * Why a run produced no verdict, when it produced none.
 *
 * A missing cassette is named ahead of whatever the provider error happened to
 * be, because it is the cause and the provider error is the symptom: a replay
 * with nothing recorded fails at the first request, and reporting that as
 * "Connection error" sends the reader looking at their network.
 */
function runFailure(trace: Trace): string | null {
  const notes = trace.events.flatMap((event) => (event.kind === "note" ? [event.text] : []));
  const misses = notes.filter((text) => text.startsWith("cassette-miss ")).length;
  const tally = notes.find((text) => text.startsWith("cassette replayed "));
  if (misses > 0 && tally?.includes("replayed 0,")) {
    return `Nothing recorded for this scenario: all ${misses} model call${misses === 1 ? "" : "s"} missed. Record it first with --mode live.`;
  }
  const fatal = trace.events.find((event) => event.kind === "error" && event.fatal);
  if (fatal?.kind === "error") return misses > 0 ? `${fatal.message} (${misses} model call${misses === 1 ? "" : "s"} were not in the cassette)` : fatal.message;
  return null;
}

function readCassette(dir: string, scenario: string): Cassette | undefined {
  const file = join(dir, `${scenario}.json`);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as Cassette;
}

function writeCassette(dir: string, scenario: string, cassette: Cassette): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${scenario}.json`), canonicalJson(cassette));
}

function write(outDir: string, result: SuiteResult): void {
  const dir = join(outDir, result.arm);
  mkdirSync(dir, { recursive: true });
  for (const trace of result.traces) writeFileSync(join(dir, `${trace.header.runId}.json`), canonicalJson(trace));
  writeFileSync(join(dir, "scorecards.json"), canonicalJson(result.scorecards));
  writeFileSync(join(dir, "summary.json"), canonicalJson(result.summary));
}
