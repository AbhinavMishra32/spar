import type { PracticeVerdict } from "@spar/practice";
import type { SourceRunReport } from "./api.js";

/**
 * A judged run at the source, written as the notation the result panel reads.
 *
 * The panel has exactly one reader — TAP — and everything it can draw as cases
 * comes through it. So a verdict from someone else's judge has to be written in
 * it too, and the header line is load-bearing: without `TAP version 13` the
 * reader stops at the first byte and a run that had an input, an expected value
 * and an actual value for every case is displayed as a log.
 *
 * Kept out of the component and beside its own test for that reason. This being
 * one line wrong is not visible in review — the panel simply falls back — so it
 * is pinned by asserting the panel's own parser can read what this writes.
 */
export function sourceRunOutput(report: SourceRunReport, sourceName: string): string {
  const lines: string[] = [];

  if (report.cases.length) {
    /* Every case the judge answered. It returns the input, the expected value and
       what the learner's code produced for each one, which is everything a case
       is; writing that as prose was throwing the structure away at the last step. */
    lines.push(
      "TAP version 13",
      ...report.cases.flatMap((entry, index) => [
        `${entry.passed ? "ok" : "not ok"} ${index + 1} - Case ${index + 1}${entry.input ? ` · ${oneLine(entry.input)}` : ""}`,
        ...(entry.passed
          ? []
          : ["  ---", `  expected: '${tapScalar(entry.expected)}'`, `  actual: '${tapScalar(entry.actual)}'`, "  ..."]),
      ]),
      `1..${report.cases.length}`,
      `# tests ${report.cases.length}`,
      `# pass ${report.cases.filter((entry) => entry.passed).length}`,
      `# fail ${report.cases.filter((entry) => !entry.passed).length}`,
    );
  } else if (report.failedCase) {
    /* No per-case answers, but the judge named the case it rejected. That is one
       case and it is written as one, rather than as the three loose lines it used
       to be — which parsed as nothing and rendered as a log. */
    const total = report.totalCases || 1;
    lines.push(
      "TAP version 13",
      `not ok 1 - the first case ${sourceName} rejected${report.failedCase.input ? ` · ${oneLine(report.failedCase.input)}` : ""}`,
      "  ---",
      `  error: 'expected ${tapScalar(report.failedCase.expected)}, got ${tapScalar(report.failedCase.actual)}'`,
      `  expected: '${tapScalar(report.failedCase.expected)}'`,
      `  actual: '${tapScalar(report.failedCase.actual)}'`,
      ...(report.failedCase.stdout ? [`  stdout: '${tapScalar(report.failedCase.stdout)}'`] : []),
      "  ...",
      "1..1",
      `# tests ${total}`,
      `# pass ${report.passedCases}`,
      `# fail ${Math.max(1, total - report.passedCases)}`,
    );
  } else {
    /* Nothing ran: the judge refused the request, or the code did not build. There
       are no cases to write, and inventing one would report a verdict nobody
       reached — the panel draws the challenge's own cases as ungraded instead. */
    lines.push(`# ${report.status}`, report.totalCases ? `# cases ${report.passedCases}/${report.totalCases}` : "");
  }

  lines.push(report.runtime ? `# runtime ${report.runtime}` : "", "", report.message);
  return `${lines.filter(Boolean).join("\n")}\n`;
}

/**
 * A submission judged at the source, in the same notation.
 *
 * A submission is run against every hidden case the source holds and it names
 * exactly one of them — the first it rejected — so that is the only case there is
 * to draw, and the counts carry the rest. When it accepted the solution there is
 * no case to name at all, and the single passing point stands for the whole
 * hidden suite.
 */
export function sourceSubmissionOutput(verdict: PracticeVerdict, sourceName: string): string {
  const lines = ["TAP version 13"];
  const cases = verdict.totalCases || (verdict.failedCase ? 1 : 0);
  const passed = verdict.totalCases ? verdict.passedCases : verdict.outcome === "passed" ? cases : 0;

  if (verdict.failedCase) {
    lines.push(
      `not ok 1 - the first case ${sourceName} rejected${verdict.failedCase.input ? ` · ${oneLine(verdict.failedCase.input)}` : ""}`,
      "  ---",
      `  error: 'expected ${tapScalar(verdict.failedCase.expected)}, got ${tapScalar(verdict.failedCase.actual)}'`,
      `  expected: '${tapScalar(verdict.failedCase.expected)}'`,
      `  actual: '${tapScalar(verdict.failedCase.actual)}'`,
      ...(verdict.failedCase.stdout ? [`  stdout: '${tapScalar(verdict.failedCase.stdout)}'`] : []),
      "  ...",
      "1..1",
    );
  } else if (verdict.outcome === "passed") {
    lines.push(`ok 1 - every hidden case at ${sourceName}`, "1..1");
  }

  lines.push(
    `# tests ${cases || 1}`,
    `# pass ${passed}`,
    `# fail ${Math.max(0, (cases || 1) - passed)}`,
    verdict.runtime ? `# runtime ${verdict.runtime}${verdict.runtimePercentile !== null ? ` (beats ${verdict.runtimePercentile.toFixed(1)}%)` : ""}` : "",
    verdict.memory ? `# memory ${verdict.memory}${verdict.memoryPercentile !== null ? ` (beats ${verdict.memoryPercentile.toFixed(1)}%)` : ""}` : "",
    verdict.compileError ? `\n${verdict.compileError}` : "",
    verdict.runtimeError ? `\n${verdict.runtimeError}` : "",
  );
  if (verdict.submissionUrl) lines.push("", `# ${verdict.submissionUrl}`);
  return `${lines.filter(Boolean).join("\n")}\n`;
}

/** A case's arguments on one line, short enough to name the case by. The source
 *  sends them newline-separated, one per parameter. */
function oneLine(value: string): string {
  const flat = value.replace(/\s*\n\s*/g, ", ").trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

/** A judge value as a single-quoted TAP scalar: the quote doubled, newlines
 *  flattened so one case's diagnostics stay one block. */
function tapScalar(value: string): string {
  return value.replace(/'/g, "''").replace(/\s*\n\s*/g, " ").trim();
}
