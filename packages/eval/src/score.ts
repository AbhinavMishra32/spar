import type { RunHeader, Trace } from "./trace.js";

/**
 * What a verifier concluded about one run.
 *
 * Three outcomes rather than two, and the third is the one that keeps the
 * numbers honest. A check that did not apply — "the next challenge targeted the
 * diagnosed gap", on a run where no challenge was ever set — is not a pass and
 * is not a failure. Folding it into either makes the headline number a function
 * of how far the run got: a run that crashed early would score well on every
 * check it never reached, which is exactly backwards.
 *
 * So `skip` is a first-class outcome, skipped checks are excluded from the
 * denominator, and every report prints the denominator beside the rate. A pass
 * rate with no denominator is a number you cannot argue with, which is not the
 * same as a number that is right.
 */
export type CheckOutcome = "pass" | "fail" | "skip";

export type CheckResult = {
  id: string;
  outcome: CheckOutcome;
  /** One line saying what was actually observed — not what should have been.
   *  This is what somebody reads when the gate fails at 2am, and "expected true,
   *  got false" has never helped anybody. */
  detail: string;
  /** Where in the trace to look. Sequence numbers, so a reader can jump. */
  at?: number[];
};

/**
 * A number a run produced that is not a verdict.
 *
 * Latency, cost, tokens, and the interesting ones — how many attempts Spar
 * needed before it named the misconception, how many compiler rejections it took
 * to publish. These are not pass/fail and forcing them to be loses the shape: a
 * change that moves convergence from four attempts to two is an improvement that
 * a threshold check would report as "pass, pass".
 */
export type Measures = Record<string, number>;

export type Scorecard = {
  run: RunHeader;
  checks: CheckResult[];
  measures: Measures;
  /** Set when the run itself failed rather than scored badly — a crash, a
   *  provider outage. Kept apart from the checks because an errored run is
   *  missing data, not evidence, and averaging it in would be inventing some. */
  error?: string;
};

/**
 * A deterministic verifier: a pure function from a trace to a verdict.
 *
 * Pure and total. It may not call a model, may not touch the network, and may
 * not fail — a verifier that throws takes down the run it was supposed to
 * describe, so the runner catches and records, but a verifier written to throw
 * on unexpected input is a verifier that will eventually score nothing.
 *
 * `applies` is separate from `run` so that "did not apply" is a decision made
 * before the check, rather than a `skip` returned from the middle of one. It
 * reads better and, more usefully, it makes the applicability rule something you
 * can state in one line and argue about.
 */
export type Verifier = {
  id: string;
  /** What this check is for, in a sentence, in the language of the product
   *  rather than of the codebase. It goes into the report. */
  description: string;
  applies?(trace: Trace): boolean;
  run(trace: Trace): Omit<CheckResult, "id">;
};

export function runVerifiers(trace: Trace, verifiers: Verifier[]): CheckResult[] {
  return verifiers.map((verifier) => {
    if (verifier.applies && !verifier.applies(trace)) return { id: verifier.id, outcome: "skip" as const, detail: "Did not apply to this run." };
    try {
      return { id: verifier.id, ...verifier.run(trace) };
    } catch (error) {
      /* A verifier that blew up is a broken verifier, and it must not read as a
         failing agent. Recorded as its own failure so the report can say which
         of the two is wrong. */
      return { id: verifier.id, outcome: "fail" as const, detail: `The verifier itself threw: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
}

/** Passes over things that actually applied. `graded` is carried everywhere
 *  beside `rate` because the two together are the claim and the rate alone is
 *  half of it. */
export function passRate(checks: CheckResult[]): { passed: number; graded: number; rate: number } {
  const graded = checks.filter((check) => check.outcome !== "skip");
  const passed = graded.filter((check) => check.outcome === "pass").length;
  return { passed, graded: graded.length, rate: graded.length ? passed / graded.length : 0 };
}

/** One check across many runs, which is the unit every statistic here works on:
 *  a scenario repeated under different seeds gives a binary sample per run, and
 *  that sample is what a confidence interval and a paired test are computed
 *  from. */
export function checkSamples(scorecards: Scorecard[], checkId: string): boolean[] {
  return scorecards
    .map((card) => card.checks.find((check) => check.id === checkId))
    .filter((check): check is CheckResult => Boolean(check) && check!.outcome !== "skip")
    .map((check) => check.outcome === "pass");
}

export function measureSamples(scorecards: Scorecard[], key: string): number[] {
  return scorecards.map((card) => card.measures[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}
