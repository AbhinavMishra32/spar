import { checkSamples, measureSamples, type CheckResult, type Scorecard } from "./score.js";
import { flakiness, mcnemar, mean, pairedBootstrap, passAtK, percentile, rate, stdev, type Flakiness, type Interval, type PairedComparison, type Rate } from "./stats.js";

/**
 * Many runs, summarised — and then two summaries, compared.
 *
 * The comparison is the point. A single eval number is nearly useless on its
 * own: nobody knows whether 0.72 is good, and the honest answer is that it
 * depends on a corpus nobody else has. What a number like that is good for is
 * being subtracted from the same number measured on a different commit, and
 * everything here is shaped by that.
 *
 * Which means three obligations, and they are the difference between a
 * comparison and a pair of numbers with a minus sign between them:
 *
 * - **Pair the runs.** Both arms run the same scenarios under the same seeds, so
 *   compare them run by run rather than rate to rate.
 * - **Say what would have happened by chance.** A change that fixes two runs and
 *   breaks one has not been shown to fix anything.
 * - **Refuse to gate on a check that moves on its own.** Measured, not assumed:
 *   a check that disagrees with itself across repeats of the same seed is
 *   reported and then excluded, because gating on it produces a red build that
 *   teaches people to ignore red builds.
 */

export type CheckSummary = {
  id: string;
  rate: Rate;
  /** How often at least one of k attempts passes. Reported for the scenarios
   *  that are legitimately retryable — which for Spar means anything the learner
   *  could ask again — and omitted where a single shot is the whole claim. */
  passAt: Record<number, number>;
  skipped: number;
  flake: Flakiness;
};

export type MeasureSummary = { key: string; samples: number; mean: number; stdev: number; p50: number; p95: number };

export type Summary = {
  arm: string;
  runs: number;
  errors: number;
  checks: CheckSummary[];
  measures: MeasureSummary[];
};

export function summarize(arm: string, scorecards: Scorecard[], options: { passAtK?: number[] } = {}): Summary {
  const ks = options.passAtK ?? [1, 2];
  const checkIds = [...new Set(scorecards.flatMap((card) => card.checks.map((check) => check.id)))].sort();
  const measureKeys = [...new Set(scorecards.flatMap((card) => Object.keys(card.measures)))].sort();
  return {
    arm,
    runs: scorecards.length,
    errors: scorecards.filter((card) => card.error).length,
    checks: checkIds.map((id) => {
      const samples = checkSamples(scorecards, id);
      return {
        id,
        rate: rate(samples),
        passAt: Object.fromEntries(ks.filter((k) => k <= samples.length).map((k) => [k, passAtK(samples, k)])),
        skipped: scorecards.filter((card) => card.checks.find((check) => check.id === id)?.outcome === "skip").length,
        /* Grouped by everything that is meant to fix the outcome. What is left
           varying inside a group is the process itself. */
        flake: flakiness(
          scorecards
            .filter((card) => card.checks.find((check) => check.id === id)?.outcome !== "skip")
            .map((card) => ({ key: `${card.run.scenario}#${card.run.seed}`, passed: card.checks.find((check) => check.id === id)?.outcome === "pass" })),
        ),
      };
    }),
    measures: measureKeys.map((key) => {
      const samples = measureSamples(scorecards, key);
      return { key, samples: samples.length, mean: mean(samples), stdev: stdev(samples), p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
    }),
  };
}

/** What two runs of the same scenario and seed are matched on. Arm is excluded
 *  because arm is the thing that differs. */
const pairKey = (card: Scorecard) => `${card.run.scenario}#${card.run.seed}`;

export type CheckComparison = {
  id: string;
  baseline: Rate;
  candidate: Rate;
  delta: number;
  paired: PairedComparison;
  /** True when the check disagreed with itself inside either arm often enough
   *  that a difference between the arms cannot be attributed to the change. */
  unreliable: boolean;
};

export type MeasureComparison = { key: string; baseline: number; candidate: number; difference: number; interval: Interval };

export type Comparison = {
  baseline: Summary;
  candidate: Summary;
  /** Runs matched on scenario and seed. Anything unmatched is named rather than
   *  dropped quietly: a comparison over a different set of scenarios than you
   *  think you are comparing is the most expensive kind of wrong. */
  pairedRuns: number;
  unmatched: string[];
  checks: CheckComparison[];
  measures: MeasureComparison[];
};

export function compare(baseline: Summary, candidate: Summary, runs: { baseline: Scorecard[]; candidate: Scorecard[] }, options: { flakeCeiling?: number } = {}): Comparison {
  const flakeCeiling = options.flakeCeiling ?? 0;
  const left = new Map(runs.baseline.map((card) => [pairKey(card), card]));
  const right = new Map(runs.candidate.map((card) => [pairKey(card), card]));
  const shared = [...left.keys()].filter((key) => right.has(key)).sort();
  const unmatched = [...new Set([...left.keys(), ...right.keys()])].filter((key) => !left.has(key) || !right.has(key)).sort();

  const checkIds = [...new Set([...baseline.checks, ...candidate.checks].map((check) => check.id))].sort();
  const find = (card: Scorecard | undefined, id: string): CheckResult | undefined => card?.checks.find((check) => check.id === id);

  return {
    baseline,
    candidate,
    pairedRuns: shared.length,
    unmatched,
    checks: checkIds.map((id) => {
      const pairs = shared
        .map((key) => ({ baseline: find(left.get(key), id), candidate: find(right.get(key), id) }))
        /* Only pairs where both arms actually graded it. A run that skipped the
           check on one side is not evidence about the other side. */
        .filter((pair) => pair.baseline && pair.candidate && pair.baseline.outcome !== "skip" && pair.candidate.outcome !== "skip")
        .map((pair) => ({ baseline: pair.baseline!.outcome === "pass", candidate: pair.candidate!.outcome === "pass" }));
      const before = baseline.checks.find((check) => check.id === id)?.rate ?? rate([]);
      const after = candidate.checks.find((check) => check.id === id)?.rate ?? rate([]);
      const flake = Math.max(
        baseline.checks.find((check) => check.id === id)?.flake.rate ?? 0,
        candidate.checks.find((check) => check.id === id)?.flake.rate ?? 0,
      );
      return { id, baseline: before, candidate: after, delta: after.rate - before.rate, paired: mcnemar(pairs), unreliable: flake > flakeCeiling };
    }),
    measures: [...new Set([...baseline.measures, ...candidate.measures].map((measure) => measure.key))].sort().map((key) => {
      const pairs = shared
        .map((sharedKey) => ({ baseline: left.get(sharedKey)!.measures[key], candidate: right.get(sharedKey)!.measures[key] }))
        .filter((pair): pair is { baseline: number; candidate: number } => typeof pair.baseline === "number" && typeof pair.candidate === "number");
      const bootstrap = pairedBootstrap(pairs, { seed: 1 });
      return {
        key,
        baseline: mean(pairs.map((pair) => pair.baseline)),
        candidate: mean(pairs.map((pair) => pair.candidate)),
        difference: bootstrap.difference,
        interval: bootstrap.interval,
      };
    }),
  };
}

/**
 * The gate.
 *
 * Deliberately hard to trip on noise and deliberately impossible to satisfy by
 * deleting checks, which are the two ways a regression gate stops working.
 *
 * A check fails the gate when it regressed *and* the regression is unlikely to
 * be chance *and* the check is reliable enough to be gated on at all. A measure
 * fails when its whole confidence interval is the wrong side of its budget —
 * not its mean, because a mean that crept over budget by a millisecond on eight
 * samples is not a latency regression.
 *
 * Unreliable checks are reported under their own heading rather than silently
 * excluded. Something that flips on its own is a real problem; it is just a
 * problem with the eval rather than with the agent, and naming it that way is
 * how it gets fixed instead of tolerated.
 */
export type GatePolicy = {
  /** Below this p-value a paired regression counts as real. */
  alpha?: number;
  /** Ceilings on measures, in the measure's own units. A key with no budget is
   *  reported and never gates. */
  budgets?: Record<string, number>;
  /** Checks that must be graded at all — a scenario silently ceasing to produce
   *  a check is how coverage disappears without anybody deciding to drop it. */
  required?: string[];
};

export type GateVerdict = { passed: boolean; failures: string[]; warnings: string[] };

export function gate(comparison: Comparison, policy: GatePolicy = {}): GateVerdict {
  const { alpha = 0.05, budgets = {}, required = [] } = policy;
  const failures: string[] = [];
  const warnings: string[] = [];

  if (comparison.unmatched.length) {
    warnings.push(`${comparison.unmatched.length} run${comparison.unmatched.length === 1 ? "" : "s"} had no counterpart and were left out of every paired test: ${comparison.unmatched.slice(0, 5).join(", ")}`);
  }

  for (const id of required) {
    const check = comparison.checks.find((item) => item.id === id);
    if (!check || check.candidate.total === 0) failures.push(`${id} was never graded in the candidate arm, so its coverage is gone rather than passing.`);
  }

  for (const check of comparison.checks) {
    if (check.unreliable) {
      warnings.push(`${id(check.id)} disagrees with itself across repeats of the same seed, so it cannot gate anything — ${pct(check.baseline.rate)} → ${pct(check.candidate.rate)} is not attributable to the change.`);
      continue;
    }
    if (check.paired.regressed > check.paired.improved && check.paired.pValue < alpha) {
      failures.push(`${id(check.id)} regressed on ${check.paired.regressed} of ${check.paired.pairs} paired runs (p = ${check.paired.pValue.toFixed(3)}): ${pct(check.baseline.rate)} → ${pct(check.candidate.rate)}.`);
    }
  }

  for (const [key, budget] of Object.entries(budgets)) {
    const measure = comparison.measures.find((item) => item.key === key);
    if (!measure) { warnings.push(`No run measured ${key}, so its budget of ${budget} was not enforced.`); continue; }
    if (measure.candidate > budget && measure.baseline + measure.interval.low > budget) {
      failures.push(`${key} is over budget: ${measure.candidate.toFixed(1)} against ${budget}, and the whole interval for the change is above it.`);
    }
  }

  return { passed: failures.length === 0, failures, warnings };
}

const id = (value: string) => value;
const pct = (value: number) => `${Math.round(value * 100)}%`;
