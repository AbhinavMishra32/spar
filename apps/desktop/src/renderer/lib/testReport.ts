/**
 * The runner executes `node --test` with piped stdio, so Node emits TAP 13 with
 * YAML diagnostic blocks. That gives per-case names, durations, and assertion
 * expected/actual values — enough to render real test cases instead of a log.
 *
 * C++ challenges compile and run an arbitrary binary, so nothing is parsed there;
 * `parsed` stays false and callers fall back to the raw output.
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
  if (!output.includes("TAP version")) return EMPTY_REPORT;

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
  if (value.length > 1 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
    return value.slice(1, -1);
  }
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
