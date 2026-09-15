/**
 * The statistics an eval needs to be believed.
 *
 * An agent eval reports rates over small samples of a noisy process, which is
 * the exact regime where the obvious arithmetic misleads. Three things go wrong
 * without this file, and all three are common:
 *
 * - **A rate with no interval.** "7 of 10" and "70 of 100" are the same number
 *   and not the same claim. Every rate here carries a Wilson interval, which
 *   unlike the normal approximation stays inside [0, 1] and stays honest at
 *   n = 5 and at p = 1 — the two places an agent eval spends most of its time.
 * - **Unpaired comparison of paired data.** Both arms run the same scenarios
 *   under the same seeds. Comparing their marginal rates throws that away and
 *   needs a far larger sample to see the same effect. The paired test below uses
 *   only the runs that disagreed, which is where the information is.
 * - **Variance read as change.** A rerun of the same commit moves the number.
 *   Unless you have measured how much it moves on its own, you cannot say
 *   whether a difference between two commits means anything, and `flakiness`
 *   exists to measure exactly that.
 */

/** 95% by default. Two-sided. */
export const Z_95 = 1.959964;

export type Interval = { low: number; high: number };

/**
 * The Wilson score interval for a binomial proportion.
 *
 * Chosen over the textbook normal interval because the normal one is wrong in
 * the two cases that matter here: it produces bounds outside [0, 1], and at
 * p = 0 or p = 1 it produces an interval of zero width — so an eval where every
 * run passed would report absolute certainty from five samples. Wilson gives
 * (0.57, 1.0) for 5 of 5, which is the honest reading.
 */
export function wilson(passes: number, total: number, z = Z_95): Interval {
  if (total <= 0) return { low: 0, high: 1 };
  const p = passes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const half = (z / denominator) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export type Rate = { passed: number; total: number; rate: number; interval: Interval };

export function rate(samples: boolean[], z = Z_95): Rate {
  const passed = samples.filter(Boolean).length;
  return { passed, total: samples.length, rate: samples.length ? passed / samples.length : 0, interval: wilson(passed, samples.length, z) };
}

/**
 * pass@k: the probability that at least one of k independent attempts succeeds,
 * estimated without bias from n attempts of which c succeeded.
 *
 * The naive estimator — run k, see if any passed — is unbiased but throws away
 * most of the sample and is itself extremely noisy. The combinatorial form used
 * here is the standard one: 1 − C(n−c, k) / C(n, k), the probability that a
 * random k-subset of the attempts contains no success. It is computed as a
 * running product rather than from factorials, because C(200, 8) overflows a
 * double long before the ratio does anything interesting.
 *
 * It answers a question worth asking of an agent that can be retried: "if the
 * learner clicks regenerate twice, does Spar get there?" — which is a different
 * and more forgiving question than whether it got there the first time, and both
 * belong in the report.
 */
export function passAtK(samples: boolean[], k: number): number {
  const n = samples.length;
  const c = samples.filter(Boolean).length;
  if (k <= 0 || n <= 0) return 0;
  if (k > n) throw new Error(`pass@${k} needs at least ${k} samples, got ${n}`);
  if (n - c < k) return 1;
  let product = 1;
  for (let i = n - c + 1; i <= n; i += 1) product *= 1 - k / i;
  return 1 - product;
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

/** Sample standard deviation — n−1, because these are samples of a process and
 *  not the population of everything the agent could ever do. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1));
}

export function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

/**
 * McNemar's exact test on paired binary outcomes.
 *
 * Both arms ran the same scenarios under the same seeds, so each scenario gives
 * a pair. Runs where the two arms agreed carry no information about which is
 * better — they are the scenarios the change did not touch — and the test
 * correctly ignores them, which is why it can detect a real effect from a
 * handful of runs where comparing two independent rates could not.
 *
 * The exact binomial form is used rather than the chi-square approximation
 * because the discordant count in an eval like this is routinely under ten,
 * which is exactly where the approximation stops being one.
 *
 * `improved` counts pairs the baseline failed and the candidate passed.
 */
export type PairedComparison = { pairs: number; improved: number; regressed: number; unchanged: number; pValue: number };

export function mcnemar(pairs: Array<{ baseline: boolean; candidate: boolean }>): PairedComparison {
  const improved = pairs.filter((pair) => !pair.baseline && pair.candidate).length;
  const regressed = pairs.filter((pair) => pair.baseline && !pair.candidate).length;
  const discordant = improved + regressed;
  return {
    pairs: pairs.length,
    improved,
    regressed,
    unchanged: pairs.length - discordant,
    pValue: discordant === 0 ? 1 : twoSidedBinomial(Math.min(improved, regressed), discordant),
  };
}

/** P(X ≤ k) doubled, capped at 1: the two-sided exact p-value for a fair coin.
 *  Summed directly because `discordant` here is tens, not millions. */
function twoSidedBinomial(k: number, n: number): number {
  let cumulative = 0;
  for (let i = 0; i <= k; i += 1) cumulative += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * cumulative);
}

function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** Lanczos-free: these arguments are small integers, so the sum of logs is both
 *  exact enough and obviously correct, which matters more here than speed. */
function logFactorial(n: number): number {
  let total = 0;
  for (let i = 2; i <= n; i += 1) total += Math.log(i);
  return total;
}

/**
 * A bootstrap interval for the difference between two paired sets of
 * measurements — latency, cost, attempts-to-convergence.
 *
 * Non-parametric on purpose. Agent latency is heavily right-skewed and cost is
 * lumpy, so a t-interval built on those assumes a shape the data does not have.
 * Resampling the *pairs* rather than the two sets independently keeps the
 * pairing, which is the same reason McNemar is used above.
 *
 * Deterministic given a seed, because an eval whose confidence interval moves
 * between two runs of the report is not an eval anybody can cite.
 */
export function pairedBootstrap(
  pairs: Array<{ baseline: number; candidate: number }>,
  options: { iterations?: number; seed?: number; confidence?: number } = {},
): { difference: number; interval: Interval } {
  const { iterations = 2_000, seed = 1, confidence = 0.95 } = options;
  const difference = mean(pairs.map((pair) => pair.candidate - pair.baseline));
  if (pairs.length < 2) return { difference, interval: { low: difference, high: difference } };
  const random = mulberry32(seed);
  const differences: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < pairs.length; index += 1) {
      const pick = pairs[Math.floor(random() * pairs.length)]!;
      total += pick.candidate - pick.baseline;
    }
    differences.push(total / pairs.length);
  }
  const tail = (1 - confidence) / 2;
  return { difference, interval: { low: percentile(differences, tail), high: percentile(differences, 1 - tail) } };
}

/**
 * A small, fast, seeded generator.
 *
 * Every deliberate random choice an eval makes has to come from a seed the run
 * records, or the run cannot be repeated — and an eval result that cannot be
 * repeated is an anecdote. `Math.random` is deliberately not used anywhere in
 * this package.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How much a check moves when nothing has changed.
 *
 * Runs are grouped by everything that is supposed to determine the outcome —
 * scenario, seed, arm — and a group whose members disagree is by definition
 * nondeterministic, because the only thing that varied was the run itself. This
 * is the measurement that makes the rest of the report mean something: a check
 * that flips on its own a fifth of the time cannot be used as a regression gate
 * at any threshold, and saying so is more useful than tightening the threshold
 * until it stops complaining.
 *
 * A group of one is not evidence of determinism and is excluded rather than
 * counted as stable — the usual way this number gets quietly inflated.
 */
export type Flakiness = { groups: number; unstable: number; rate: number; unstableKeys: string[] };

export function flakiness(runs: Array<{ key: string; passed: boolean }>): Flakiness {
  const groups = new Map<string, boolean[]>();
  for (const run of runs) groups.set(run.key, [...(groups.get(run.key) ?? []), run.passed]);
  const repeated = [...groups.entries()].filter(([, outcomes]) => outcomes.length > 1);
  const unstable = repeated.filter(([, outcomes]) => outcomes.some((outcome) => outcome !== outcomes[0]));
  return {
    groups: repeated.length,
    unstable: unstable.length,
    rate: repeated.length ? unstable.length / repeated.length : 0,
    unstableKeys: unstable.map(([key]) => key),
  };
}
