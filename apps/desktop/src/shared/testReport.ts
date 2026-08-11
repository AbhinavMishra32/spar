/**
 * The runner executes `node --test` with piped stdio, so Node emits TAP 13 with
 * YAML diagnostic blocks. That gives per-case names, durations, and assertion
 * expected/actual values — enough to render real test cases instead of a log.
 *
 * Synthetic harnesses in every supported language now emit TAP or Spar's small
 * `ok - name` protocol. Older arbitrary binaries may still be silent; there
 * `parsed` stays false and callers can join the exit status to declarations in
 * the persisted visible test source.
 *
 * Shared rather than renderer-local because the same parse has to happen twice:
 * once to draw the result panel, and once where a run is recorded, so the
 * attempt keeps which cases failed rather than only that something did.
 */

export type CaseStatus = "passed" | "failed" | "skipped" | "todo";

export type TestFailure = {
  message?: string;
  expected?: string;
  actual?: string;
  operator?: string;
  location?: string;
};

export type TestCaseResult = {
  id: string;
  ordinal: number;
  name: string;
  status: CaseStatus;
  durationMs?: number;
  failure?: TestFailure;
};

export type TestReport = {
  parsed: boolean;
  cases: TestCaseResult[];
  passed: number;
  failed: number;
  skipped: number;
  durationMs?: number;
};

export const EMPTY_REPORT: TestReport = { parsed: false, cases: [], passed: 0, failed: 0, skipped: 0 };

const POINT = /^(not ok|ok)\s+(\d+)\s*-?\s*(.*)$/;
const SUMMARY = /^#\s+(tests|pass|fail|skipped|todo|duration_ms)\s+([\d.]+)$/;

export function parseTestOutput(output: string): TestReport {
  if (!output.includes("TAP version")) return parseCheckLines(output);

  const lines = output.replace(/\r\n/g, "\n").split("\n");
  const cases: TestCaseResult[] = [];
  let durationMs: number | undefined;
  const totals: Record<string, number> = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    const summary = SUMMARY.exec(line.trim());
    if (summary) {
      const value = Number(summary[2]);
      if (Number.isFinite(value)) {
        if (summary[1] === "duration_ms") durationMs = value;
        else totals[summary[1]!] = value;
      }
      continue;
    }

    const point = POINT.exec(line.trim());
    if (!point) continue;

    const ordinal = Number(point[2]);
    let name = (point[3] ?? "").trim();
    let status: CaseStatus = point[1] === "ok" ? "passed" : "failed";

    // TAP marks skips and todos as passing points with a trailing directive.
    const directive = /#\s*(SKIP|TODO)\b\s*(.*)$/i.exec(name);
    if (directive) {
      status = directive[1]!.toUpperCase() === "SKIP" ? "skipped" : "todo";
      name = name.slice(0, directive.index).trim();
    }

    const block = readDiagnostics(lines, index + 1);
    index = block.nextIndex - 1;

    const failure: TestFailure = {};
    const message = block.fields.error;
    if (message) failure.message = message;
    const expected = block.fields.expected;
    if (expected) failure.expected = expected;
    const actual = block.fields.actual;
    if (actual) failure.actual = actual;
    const operator = block.fields.operator;
    if (operator) failure.operator = operator;
    const location = block.fields.location;
    if (location) failure.location = shortLocation(location);

    const duration = Number(block.fields.duration_ms);

    cases.push({
      id: `case-${ordinal}-${name}`,
      ordinal,
      name: name || `Case ${ordinal}`,
      status,
      ...(Number.isFinite(duration) ? { durationMs: duration } : {}),
      ...(status === "failed" && Object.keys(failure).length ? { failure } : {}),
    });
  }

  if (!cases.length) return EMPTY_REPORT;

  return {
    parsed: true,
    cases,
    passed: totals.pass ?? cases.filter((item) => item.status === "passed").length,
    failed: totals.fail ?? cases.filter((item) => item.status === "failed").length,
    skipped: totals.skipped ?? cases.filter((item) => item.status === "skipped").length,
    ...(durationMs === undefined ? {} : { durationMs }),
  };
}

/**
 * The same cases, out of a suite that reports them without TAP.
 *
 * Spar's own C++ harness printed `ok - name` with the expected and actual values
 * indented underneath before it emitted TAP, and every workspace generated in
 * that period still has that file in it — the test is on the learner's disk, so
 * it does not change when the generator does. Reading the older notation is what
 * makes those challenges show cases instead of a log, and it costs one regex.
 *
 * Deliberately narrow: a point is a line that *starts* with `ok`/`not ok`, so
 * prose that merely mentions them is not mistaken for a verdict.
 */
const CHECK = /^(not ok|ok)\s*(?:\d+\s*)?[-–]\s*(.+)$/;
const CHECK_FIELD = /^\s+(expected|actual|error|message)\s*:\s*(.*)$/i;

function parseCheckLines(output: string): TestReport {
  const lines = output.replace(/\r\n/g, "\n").split("\n");
  const cases: TestCaseResult[] = [];

  for (const line of lines) {
    const point = CHECK.exec(line);
    if (point) {
      cases.push({
        id: `check-${cases.length + 1}-${(point[2] ?? "").trim()}`,
        ordinal: cases.length + 1,
        name: (point[2] ?? "").trim() || `Case ${cases.length + 1}`,
        status: point[1] === "ok" ? "passed" : "failed",
      });
      continue;
    }
    // A field belongs to the point above it, which is the only case it can describe.
    const field = CHECK_FIELD.exec(line);
    const current = cases[cases.length - 1];
    if (!field || !current || current.status !== "failed") continue;
    const failure = current.failure ?? {};
    const key = (field[1] ?? "").toLowerCase();
    const value = (field[2] ?? "").trim();
    if (key === "expected") failure.expected = value;
    else if (key === "actual") failure.actual = value;
    else failure.message = value;
    current.failure = failure;
  }

  if (!cases.length) return EMPTY_REPORT;
  return {
    parsed: true,
    cases,
    passed: cases.filter((item) => item.status === "passed").length,
    failed: cases.filter((item) => item.status === "failed").length,
    skipped: 0,
  };
}

/**
 * One case as an attempt event carries it. Values are clipped: what a later turn
 * needs is which case failed and roughly how, and an assertion that dumped a
 * whole array would otherwise sit in the event store forever.
 */
export type TestCaseRecord = {
  name: string;
  status: CaseStatus;
  durationMs?: number;
  expected?: string;
  actual?: string;
  message?: string;
};

const VALUE_LIMIT = 220;

/**
 * The durable per-case record of a run. Every recorded run carries this, so the
 * history of a single case across an attempt — failed, failed, passed, failed
 * again — can be reconstructed without keeping any raw output at all.
 */
export function caseRecords(report: TestReport): TestCaseRecord[] {
  return report.cases.map((item) => ({
    name: item.name,
    status: item.status,
    ...(item.durationMs === undefined ? {} : { durationMs: Math.round(item.durationMs * 100) / 100 }),
    ...(item.failure?.expected === undefined ? {} : { expected: clip(item.failure.expected) }),
    ...(item.failure?.actual === undefined ? {} : { actual: clip(item.failure.actual) }),
    ...(headline(item.failure?.message) ? { message: clip(headline(item.failure?.message)!) } : {}),
  }));
}

/**
 * What a run leaves behind in the attempt it belongs to. Cases are the durable
 * part: they are what lets a later turn say which case the learner fixed and
 * which one they broke doing it. Raw output is kept only where there are no
 * cases to keep — a legacy silent binary, or a run that died before the runner started —
 * because there it is the only evidence of what happened.
 *
 * Shared so the visible run recorded by the renderer and the submission recorded
 * by the main process cannot describe the same event in two different shapes.
 */
export type RunEvidence = {
  cases: TestCaseRecord[];
  /** Raw output, and only when there were no cases to keep instead. */
  summary: string;
  passedCases?: number;
  failedCases?: number;
  skippedCases?: number;
  runMs?: number;
};

const MAX_EVENT_SUMMARY = 4_000;
export function runEvidence(output: string): RunEvidence {
  const report = parseTestOutput(output);
  if (!report.parsed) return { cases: [], summary: output.trim().slice(0, MAX_EVENT_SUMMARY) };
  return {
    cases: caseRecords(report),
    passedCases: report.passed,
    failedCases: report.failed,
    ...(report.skipped ? { skippedCases: report.skipped } : {}),
    ...(report.durationMs === undefined ? {} : { runMs: Math.round(report.durationMs) }),
    summary: "",
  };
}

function clip(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > VALUE_LIMIT ? `${flat.slice(0, VALUE_LIMIT)}…` : flat;
}

/** Reads the `---` … `...` YAML block that follows a TAP point, if present. */
function readDiagnostics(lines: string[], start: number): { fields: Record<string, string>; nextIndex: number } {
  const fields: Record<string, string> = {};
  if ((lines[start] ?? "").trim() !== "---") return { fields, nextIndex: start };

  let index = start + 1;
  while (index < lines.length && (lines[index] ?? "").trim() !== "...") {
    const line = lines[index] ?? "";
    const entry = /^(\s*)([A-Za-z_][\w]*):\s?(.*)$/.exec(line);
    if (!entry) {
      index += 1;
      continue;
    }
    const [, indent = "", key = "", rest = ""] = entry;

    // Block scalars (`|-`) and nested maps both continue on more-indented lines.
    if (rest === "|-" || rest === "|" || rest === "") {
      const body: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const next = lines[cursor] ?? "";
        if (next.trim() === "..." ) break;
        const nextIndent = next.length - next.trimStart().length;
        if (next.trim() && nextIndent <= indent.length) break;
        body.push(next.slice(indent.length + 2));
        cursor += 1;
      }
      fields[key] = rest === "" ? collapseMap(body) : body.join("\n").trimEnd();
      index = cursor;
      continue;
    }

    fields[key] = unquote(rest.trim());
    index += 1;
  }

  return { fields, nextIndex: Math.min(index + 1, lines.length) };
}

/**
 * Node serialises non-scalar expected/actual values as nested maps. Consecutive
 * numeric keys came from an array, so they are rebuilt as one; anything else is
 * shown as an object literal.
 */
function collapseMap(body: string[]): string {
  const entries = body
    .map((line) => /^\s*(?:'([^']*)'|"([^"]*)"|([\w-]+)):\s?(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => [match[1] ?? match[2] ?? match[3] ?? "", unquote((match[4] ?? "").trim())] as const);

  if (!entries.length) return body.join("\n").trim();

  const isArray = entries.every(([key], position) => key === String(position));
  if (isArray) return `[ ${entries.map(([, value]) => value).join(", ")} ]`;
  return `{ ${entries.map(([key, value]) => `${key}: ${value}`).join(", ")} }`;
}

function unquote(value: string): string {
  /* A single-quoted YAML scalar carries its own quotes doubled — that is how both
     Node and Spar's own writers escape them — so undoing that is part of reading
     it. Without this an output containing an apostrophe was shown back to the
     learner with the apostrophe duplicated, as a difference their code did not
     produce. */
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  return value;
}

/** Absolute workspace paths are noise; only the file and line help the learner. */
function shortLocation(value: string): string {
  const parts = value.split("/");
  return parts.length > 2 ? parts.slice(-2).join("/") : value;
}

/**
 * Node's assertion message repeats the expected/actual pair as a diff. When both
 * are shown as their own fields, only the first explanatory line adds anything.
 */
export function headline(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const first = message.split("\n").find((line) => line.trim());
  return first?.trim();
}
