import type { PracticeVerdict } from "@spar/practice";
import type { SourceRunReport } from "./api.js";
import { STOPPED_AT_FAILURE } from "./testReport.js";

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
       is; writing that as prose was throwing the structure away at the last step.
       A runtime error belongs to the first case that failed — that is the one it
       killed. */
    const firstFailed = report.cases.findIndex((entry) => !entry.passed);
    lines.push(
      "TAP version 13",
      ...report.cases.flatMap((entry, index) => [
        `${entry.passed ? "ok" : "not ok"} ${index + 1} - Case ${index + 1}${entry.input ? ` · ${oneLine(entry.input)}` : ""}`,
        ...(entry.passed
          ? []
          : diagnostics({
            input: entry.input,
            expected: entry.expected,
            actual: entry.actual,
            stdout: entry.stdout ?? "",
            error: index === firstFailed ? report.error ?? "" : "",
          })),
      ]),
      `1..${report.cases.length}`,
      `# tests ${report.cases.length}`,
      `# pass ${report.cases.filter((entry) => entry.passed).length}`,
      `# fail ${report.cases.filter((entry) => !entry.passed).length}`,
      report.outcome === "failed" ? `# status ${report.status}` : "",
    );
  } else if (report.failedCase) {
    lines.push(...stoppedSuite({
      failedCase: report.failedCase,
      passed: report.passedCases,
      total: report.totalCases,
      status: report.status,
      error: report.error ?? "",
      label: "Case",
    }));
  } else {
    /* Nothing ran: the judge refused the request, or the code did not build. There
       are no cases to write, and inventing one would report a verdict nobody
       reached — the panel draws the challenge's own cases as ungraded instead. */
    lines.push(`# ${report.status}`, report.totalCases ? `# cases ${report.passedCases}/${report.totalCases}` : "");
    if (report.error) lines.push("", report.error);
  }

  lines.push(report.runtime ? `# runtime ${report.runtime}` : "", "", report.message);
  return `${lines.filter(Boolean).join("\n")}\n`;
}

/**
 * A submission judged at the source, in the same notation.
 *
 * A submission is run against every hidden case the source holds, in order, and
 * stops at the first it rejects. So the cases before that one passed, that one
 * failed with the values the judge names, and the rest were never reached — the
 * whole suite is drawn, with its unreached tail grey, rather than one dot
 * standing in for thirty-six. An accepted submission passed every one of them.
 */
export function sourceSubmissionOutput(verdict: PracticeVerdict, sourceName: string): string {
  const lines = ["TAP version 13"];
  const error = verdict.runtimeError || verdict.compileError;

  if (verdict.failedCase) {
    lines.push(...stoppedSuite({
      failedCase: verdict.failedCase,
      passed: verdict.passedCases,
      total: verdict.totalCases,
      status: verdict.status,
      error,
      label: "Hidden case",
    }).slice(1));
  } else if (verdict.outcome === "passed") {
    const total = Math.max(1, verdict.totalCases);
    lines.push(
      ...(verdict.totalCases
        ? Array.from({ length: total }, (_unused, index) => `ok ${index + 1} - Hidden case ${index + 1}`)
        : [`ok 1 - every hidden case at ${sourceName}`]),
      `1..${total}`,
      `# tests ${total}`,
      `# pass ${total}`,
      "# fail 0",
    );
  } else {
    /* Rejected without naming a case — a compile error, most often. Nothing was
       judged, so no case is drawn; the error stays readable underneath. */
    lines.push(`# ${verdict.status}`, verdict.totalCases ? `# cases ${verdict.passedCases}/${verdict.totalCases}` : "");
  }

  lines.push(
    verdict.runtime ? `# runtime ${verdict.runtime}${verdict.runtimePercentile !== null ? ` (beats ${verdict.runtimePercentile.toFixed(1)}%)` : ""}` : "",
    verdict.memory ? `# memory ${verdict.memory}${verdict.memoryPercentile !== null ? ` (beats ${verdict.memoryPercentile.toFixed(1)}%)` : ""}` : "",
    !verdict.failedCase && error ? `\n${error}` : "",
  );
  if (verdict.submissionUrl) lines.push("", `# ${verdict.submissionUrl}`);
  return `${lines.filter(Boolean).join("\n")}\n`;
}

/**
 * A fail-fast suite at the source: the cases it passed, the one it stopped on,
 * and how big the whole suite was. `# suite` carries the size past the cases
 * printed, and the stop marker tells the panel the tail was unreached rather
 * than missing.
 */
function stoppedSuite(input: {
  failedCase: { input: string; expected: string; actual: string; stdout: string };
  passed: number;
  total: number;
  status: string;
  error: string;
  /** What a passed case is called: a run's are the problem's own cases, a
   *  submission's are the source's hidden ones. */
  label: string;
}): string[] {
  const at = input.passed + 1;
  const total = Math.max(at, input.total);
  const { failedCase } = input;
  return [
    "TAP version 13",
    ...Array.from({ length: input.passed }, (_unused, index) => `ok ${index + 1} - ${input.label} ${index + 1}`),
    `not ok ${at} - Case ${at}${failedCase.input ? ` · ${oneLine(failedCase.input)}` : ""}`,
    ...diagnostics({ ...failedCase, error: input.error }),
    ...(at < total ? [`# ${STOPPED_AT_FAILURE}`] : []),
    `1..${at}`,
    `# tests ${at}`,
    `# pass ${input.passed}`,
    "# fail 1",
    `# suite ${total}`,
    `# status ${input.status}`,
  ];
}

/** A failing case's diagnostic block. Empty values are left out, so a case that
 *  crashed shows its error rather than a blank Output box. */
function diagnostics(value: { input: string; expected: string; actual: string; stdout: string; error: string }): string[] {
  return [
    "  ---",
    ...(value.input ? [`  input: '${tapScalar(args(value.input))}'`] : []),
    ...(value.expected ? [`  expected: '${tapScalar(value.expected)}'`] : []),
    ...(value.actual ? [`  actual: '${tapScalar(value.actual)}'`] : []),
    ...(value.stdout.trim() ? block("stdout", value.stdout) : []),
    ...(value.error.trim() ? block("stderr", value.error) : []),
    "  ...",
  ];
}

/** A multi-line value as a YAML block scalar, so its line breaks survive. */
function block(key: string, value: string): string[] {
  return [`  ${key}: |-`, ...value.replace(/\r\n/g, "\n").trimEnd().split("\n").map((line) => `    ${line}`)];
}

/** A case's arguments, one per line from the source, as a call's argument list. */
function args(value: string): string {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).join(", ");
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
