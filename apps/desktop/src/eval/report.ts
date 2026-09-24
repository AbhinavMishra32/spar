import type { Comparison, GateVerdict, Scorecard, Summary } from "@spar/eval";

/**
 * The report, written for somebody who has to decide something.
 *
 * Two rules, both learned from reports nobody reads. Every rate is printed with
 * the count it came from, because "82%" over eleven runs and "82%" over four
 * hundred are different claims and only one of them is worth acting on. And
 * every failing check prints what was actually observed rather than what was
 * expected — the expectation is in the check's own name, and a reader at the end
 * of a red build needs the other half.
 */

export function renderSummary(summary: Summary, options: { duplicates?: string[] } = {}): string {
  const lines: string[] = [];
  lines.push(bold(`${summary.arm} — ${summary.runs} run${summary.runs === 1 ? "" : "s"}${summary.errors ? `, ${summary.errors} errored` : ""}`));
  lines.push("");

  for (const check of summary.checks) {
    const mark = check.rate.total === 0 ? "–" : check.rate.passed === check.rate.total ? "✓" : check.rate.passed === 0 ? "✗" : "~";
    lines.push(`  ${mark} ${pad(check.id, 34)} ${check.rate.passed}/${check.rate.total}${check.skipped ? ` (${check.skipped} n/a)` : ""}  ${interval(check.rate.interval)}`);
    if (check.flake.rate > 0) lines.push(`      unstable: it disagreed with itself on ${check.flake.unstable} of ${check.flake.groups} repeated seeds`);
  }

  lines.push("");
  for (const measure of summary.measures) {
    lines.push(`    ${pad(measure.key, 34)} mean ${round(measure.mean)}  p50 ${round(measure.p50)}  p95 ${round(measure.p95)}${measure.stdev > 0 ? `  sd ${round(measure.stdev)}` : ""}`);
  }

  if (options.duplicates?.length) {
    lines.push("");
    lines.push(`  ${options.duplicates.length} run${options.duplicates.length === 1 ? " was" : "s were"} byte-identical to another, so the sample is smaller than the run count:`);
    for (const duplicate of options.duplicates.slice(0, 5)) lines.push(`    ${duplicate}`);
  }
  return lines.join("\n");
}

/** Every check a run graded, in full. What you read when one scenario is the
 *  question rather than the suite. */
export function renderScorecard(card: Scorecard): string {
  const lines = [bold(card.run.runId)];
  if (card.error) lines.push(`  the run itself failed: ${card.error}`);
  for (const check of card.checks) {
    lines.push(`  ${check.outcome === "pass" ? "✓" : check.outcome === "fail" ? "✗" : "–"} ${pad(check.id, 34)} ${check.detail}`);
  }
  lines.push(`    ${Object.entries(card.measures).map(([key, value]) => `${key} ${round(value)}`).join("  ")}`);
  return lines.join("\n");
}

/**
 * Two arms, side by side.
 *
 * The delta column is the least interesting thing here and it is printed last on
 * purpose. What decides whether a change worked is the paired column: how many
 * individual runs it fixed, how many it broke, and whether that split is one you
 * would see by chance.
 */
export function renderComparison(comparison: Comparison): string {
  const lines: string[] = [];
  lines.push(bold(`${comparison.baseline.arm} → ${comparison.candidate.arm}, over ${comparison.pairedRuns} paired run${comparison.pairedRuns === 1 ? "" : "s"}`));
  if (comparison.unmatched.length) lines.push(`  ${comparison.unmatched.length} run${comparison.unmatched.length === 1 ? "" : "s"} had no counterpart and were excluded: ${comparison.unmatched.join(", ")}`);
  lines.push("");

  for (const check of comparison.checks) {
    const arrow = check.delta > 0 ? "↑" : check.delta < 0 ? "↓" : " ";
    lines.push(`  ${arrow} ${pad(check.id, 34)} ${check.baseline.passed}/${check.baseline.total} → ${check.candidate.passed}/${check.candidate.total}`);
    if (check.paired.pairs > 0 && (check.paired.improved || check.paired.regressed)) {
      lines.push(`      fixed ${check.paired.improved}, broke ${check.paired.regressed}, of ${check.paired.pairs} paired — p = ${check.paired.pValue.toFixed(3)}`);
    }
    if (check.unreliable) lines.push(`      the check is unstable, so this difference is not attributable to the change`);
  }

  lines.push("");
  for (const measure of comparison.measures) {
    lines.push(`    ${pad(measure.key, 34)} ${round(measure.baseline)} → ${round(measure.candidate)}  (${measure.difference >= 0 ? "+" : ""}${round(measure.difference)}, 95% ${round(measure.interval.low)}…${round(measure.interval.high)})`);
  }
  return lines.join("\n");
}

export function renderGate(verdict: GateVerdict): string {
  const lines = [bold(verdict.passed ? "Gate passed." : "Gate failed.")];
  for (const failure of verdict.failures) lines.push(`  ✗ ${failure}`);
  for (const warning of verdict.warnings) lines.push(`  ! ${warning}`);
  return lines.join("\n");
}

const bold = (value: string) => (process.stdout.isTTY ? `[1m${value}[0m` : value);
const pad = (value: string, width: number) => (value.length >= width ? value : value + " ".repeat(width - value.length));
const round = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const interval = (value: { low: number; high: number }) => `[${Math.round(value.low * 100)}–${Math.round(value.high * 100)}%]`;
