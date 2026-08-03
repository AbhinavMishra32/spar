/**
 * The attempt's own log, plus the two things a chronological log cannot show.
 *
 * The verdict on a submission says almost nothing about the learner: two people
 * reach 6/7 by completely different routes, and the one who fixed a case in
 * ninety seconds and the one who broke two others getting there are not the same
 * learner. Everything that distinguishes them is already recorded — every edit,
 * every run, every case's status in every run, and when each of those happened.
 *
 * So this module does not summarise and does not interpret. `foldAttempt` turns
 * the events into printable log lines, keeping all of them, and derives exactly
 * two things that cannot be read off a log in order: each case's verdict across
 * every run, which is a transpose, and each run's newly-passing/newly-failing
 * set, which is a diff. `formatSolveLog` writes those out for the agent, which
 * chooses which sections and which event types it wants; the attempt panel draws
 * the same object. Conclusions belong to whoever is reading, not to this file.
 */

export type ReplayEvent = {
  id: string;
  sequence: number;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  source: string;
};

export type CaseVerdict = "passed" | "failed" | "skipped" | "todo" | "absent";

export type RunScope = "visible" | "visible-and-hidden";

/** One recorded run of the tests, in the order it happened. */
export type ReplayRun = {
  eventId: string;
  ordinal: number;
  scope: RunScope;
  /** A submission is the graded run — the hidden suite is included. */
  submission: boolean;
  at: number;
  offsetMs: number;
  passed: boolean;
  passedCases: number;
  failedCases: number;
  totalCases: number;
  durationMs?: number;
  /** Cases this run fixed and broke, against the run before it. */
  fixed: string[];
  broke: string[];
  /** Kept only where a run produced no cases at all — C++, or a crash. */
  rawSummary?: string;
};

/** One test case, followed across every run of the attempt. */
export type ReplayCase = {
  name: string;
  /** First seen in a submission and never in a visible run: the learner could
   *  not read this one, they could only be told about it. */
  hidden: boolean;
  verdicts: CaseVerdict[];
  failures: number;
  passes: number;
  /** Offset of the run that first passed this case, after it had failed. */
  fixedAtMs?: number;
  /** Passed, then failed again later. The most diagnostic thing in the trace. */
  regressed: boolean;
  neverPassed: boolean;
  passedFirstTry: boolean;
  finalVerdict: CaseVerdict;
  lastFailure?: { expected?: string; actual?: string; message?: string; atMs: number };
};

export type ReplayEdit = {
  path: string;
  saves: number;
  firstMs: number;
  lastMs: number;
  bytes?: number;
  /** Sequence of the first save, so an edit sorts against runs by record order. */
  order: number;
};

export type ReplayMoment = {
  eventId: string;
  offsetMs: number;
  kind: "opened" | "edit" | "run" | "submission" | "verdict" | "asked" | "said" | "ended";
  text: string;
  /** Recorded order, which is what breaks ties: a submission, its grade, and the
   *  attempt closing all land on the same second and only sequence says which
   *  came first. */
  order: number;
};

export type ReplayStats = {
  events: number;
  runs: number;
  submissions: number;
  saves: number;
  elapsedMs: number;
  /** From the attempt opening to the first time anything was run. */
  timeToFirstRunMs?: number;
  /** Distinct case names seen across every run, visible and hidden. */
  casesTracked: number;
  neverPassed: number;
  regressions: number;
  longestGapMs: number;
  outcome: "passed" | "failed" | "abandoned" | "in-progress";
  /** True when the learner submitted without ever running the visible cases. */
  submittedBlind: boolean;
};

/** One recorded event, ready to print as a log line. `detail` is its payload
 *  spelled out; `caseLines` is one line per test case the event carried. */
export type LogEntry = {
  sequence: number;
  offsetMs: number;
  type: string;
  source: string;
  detail: string;
  caseLines: string[];
};

export type AttemptReplay = {
  challenge: { title: string; language: string; statement?: string };
  startedAt: number;
  endedAt: number;
  open: boolean;
  /** The log itself, in recorded order. Nothing is dropped in the fold. */
  events: LogEntry[];
  runs: ReplayRun[];
  cases: ReplayCase[];
  edits: ReplayEdit[];
  moments: ReplayMoment[];
  stats: ReplayStats;
};

export type CaseFilter = "all" | "failed-ever" | "still-failing" | "fixed";
export type ReplaySection = "log" | "cases" | "runs" | "timings";

export type ReplayFilters = {
  sections: ReplaySection[];
  /** Event types to keep in the log. Empty means every type. */
  events: string[];
  cases: CaseFilter;
  /** `since-last-submission` answers "what did they do about it?" on its own. */
  scope: "all" | "since-last-submission";
  /** `brief` drops each failing case's expected/actual pair from the log. */
  caseDetail: "brief" | "full";
  maxLines: number;
};

export const DEFAULT_SECTIONS: ReplaySection[] = ["log", "cases", "runs"];

export function foldAttempt(
  events: ReplayEvent[],
  context: { title?: string; language?: string; statement?: string; now?: number } = {},
): AttemptReplay {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const now = context.now ?? Date.now();
  const startedAt = ordered.length ? time(ordered[0]!) : now;
  const completion = ordered.find((event) => event.type === "attempt_completed");
  const endedAt = ordered.length ? time(ordered.at(-1)!) : now;
  const at = (event: ReplayEvent) => time(event) - startedAt;

  /* Each run's own case verdicts, kept beside the run rather than on it: the
     per-case history is transposed out of these, and a map per run is not
     something a caller of this fold should have to look at. */
  const observed: Array<{ verdicts: Map<string, CaseVerdict>; details: Map<string, CaseDetail> }> = [];
  const runs: ReplayRun[] = [];
  const caseOrder: string[] = [];
  const seenCases = new Map<string, { hidden: boolean }>();
  const moments: ReplayMoment[] = [];
  const log: LogEntry[] = [];
  const edits: ReplayEdit[] = [];
  let openEdit: ReplayEdit | null = null;
  let saves = 0;
  let longestGapMs = 0;
  let previous: number | null = null;

  for (const event of ordered) {
    const offsetMs = at(event);
    if (previous !== null) longestGapMs = Math.max(longestGapMs, offsetMs - previous);
    previous = offsetMs;

    /* Logged first, and for every event, before any branch decides what else
       this one contributes. Nothing gets to be absent from the log. */
    log.push({
      sequence: event.sequence,
      offsetMs,
      type: event.type,
      source: event.source,
      detail: describePayload(event),
      caseLines: caseList(event.payload.cases).map(caseLine),
    });

    if (event.type === "attempt_started") {
      moments.push({ eventId: event.id, offsetMs, order: event.sequence, kind: "opened", text: "attempt opened" });
      continue;
    }

    if (event.type === "file_changed") {
      saves += 1;
      const path = text(event.payload.path) ?? "a file";
      const bytes = numeric(event.payload.bytes);
      /* Consecutive saves of one file are one stretch of work on it, not six
         events. A run closes the stretch even when the next save is the same
         file: edit-edit-run-edit is the rhythm worth seeing, and merging across
         the run would flatten it into one long edit. */
      if (openEdit && openEdit.path === path) {
        openEdit.saves += 1;
        openEdit.lastMs = offsetMs;
        if (bytes !== undefined) openEdit.bytes = bytes;
        continue;
      }
      openEdit = { path, saves: 1, firstMs: offsetMs, lastMs: offsetMs, order: event.sequence, ...(bytes === undefined ? {} : { bytes }) };
      edits.push(openEdit);
      continue;
    }

    if (event.type === "test_run") {
      openEdit = null;
      const scope: RunScope = event.payload.scope === "visible-and-hidden" ? "visible-and-hidden" : "visible";
      const records = caseList(event.payload.cases);
      for (const record of records) {
        if (!seenCases.has(record.name)) {
          seenCases.set(record.name, { hidden: scope === "visible-and-hidden" });
          caseOrder.push(record.name);
        } else if (scope === "visible") {
          seenCases.get(record.name)!.hidden = false;
        }
      }
      const run: ReplayRun = {
        eventId: event.id,
        ordinal: runs.length + 1,
        scope,
        submission: scope === "visible-and-hidden",
        at: time(event),
        offsetMs,
        passed: event.payload.passed === true,
        passedCases: numeric(event.payload.passedCases) ?? records.filter((item) => item.status === "passed").length,
        failedCases: numeric(event.payload.failedCases) ?? records.filter((item) => item.status === "failed").length,
        totalCases: records.length,
        ...(numeric(event.payload.durationMs) === undefined ? {} : { durationMs: numeric(event.payload.durationMs)! }),
        fixed: [],
        broke: [],
        ...(records.length ? {} : { rawSummary: firstLine(text(event.payload.summary) ?? "") }),
      };
      // Deltas are read against the previous run that actually saw each case: a
      // visible run cannot say whether a hidden case regressed, so comparing
      // against it would report every hidden case as fixed on each submission.
      for (const record of records) {
        const before = lastVerdict(observed, record.name);
        if (before === "failed" && record.status === "passed") run.fixed.push(record.name);
        if (before === "passed" && record.status === "failed") run.broke.push(record.name);
      }
      observed.push({
        verdicts: new Map(records.map((record) => [record.name, record.status] as const)),
        details: new Map(records.flatMap((record) => {
          const detail: CaseDetail = {
            ...(record.expected === undefined ? {} : { expected: record.expected }),
            ...(record.actual === undefined ? {} : { actual: record.actual }),
            ...(record.message === undefined ? {} : { message: record.message }),
          };
          return Object.keys(detail).length ? [[record.name, detail] as const] : [];
        })),
      });
      runs.push(run);
      moments.push({
        eventId: event.id,
        offsetMs,
        order: event.sequence,
        kind: run.submission ? "submission" : "run",
        text: records.length
          ? `${run.submission ? "submitted" : "ran visible tests"} — ${run.passedCases}/${records.length} passed`
          : `${run.submission ? "submitted" : "ran visible tests"} — ${run.passed ? "passed" : "failed"}, no cases reported`,
      });
      continue;
    }

    if (event.type === "submission_evaluated") {
      moments.push({ eventId: event.id, offsetMs, order: event.sequence, kind: "verdict", text: `graded ${text(event.payload.outcome) ?? "unknown"}` });
      continue;
    }

    if (event.type === "attempt_completed") {
      const reason = text(event.payload.reason);
      moments.push({
        eventId: event.id,
        offsetMs,
        order: event.sequence,
        kind: "ended",
        text: `attempt ${text(event.payload.outcome) ?? "closed"}${reason ? ` — "${reason}"` : ""}`,
      });
      continue;
    }

    if (event.type === "hint_requested") {
      moments.push({ eventId: event.id, offsetMs, order: event.sequence, kind: "asked", text: "asked for a hint" });
      continue;
    }

    if (event.type === "learner_remark") {
      moments.push({ eventId: event.id, offsetMs, order: event.sequence, kind: "said", text: `said "${firstLine(text(event.payload.body) ?? "")}"` });
      continue;
    }

    if (event.type === "command_executed" || event.type === "file_opened" || event.type === "submission_created") continue;
    moments.push({ eventId: event.id, offsetMs, order: event.sequence, kind: "said", text: event.type.replace(/_/g, " ") });
  }

  for (const edit of edits) {
    moments.push({
      eventId: `edit-${edit.path}-${edit.firstMs}`,
      offsetMs: edit.firstMs,
      order: edit.order,
      kind: "edit",
      text: edit.saves > 1
        ? `edited ${edit.path} — ${edit.saves} saves over ${duration(edit.lastMs - edit.firstMs)}`
        : `edited ${edit.path}`,
    });
  }
  moments.sort((left, right) => left.offsetMs - right.offsetMs || left.order - right.order);

  const cases = caseOrder.map((name) => foldCase(name, seenCases.get(name)?.hidden ?? false, runs, observed));
  const firstRun = runs[0];
  const outcome = completion
    ? (text(completion.payload.outcome) as ReplayStats["outcome"] | undefined) ?? "failed"
    : "in-progress";

  const stats: ReplayStats = {
    events: ordered.length,
    runs: runs.length,
    submissions: runs.filter((run) => run.submission).length,
    saves,
    elapsedMs: (completion ? endedAt : now) - startedAt,
    ...(firstRun ? { timeToFirstRunMs: firstRun.offsetMs } : {}),
    casesTracked: cases.length,
    neverPassed: cases.filter((item) => item.neverPassed).length,
    regressions: cases.filter((item) => item.regressed).length,
    longestGapMs,
    outcome: outcome === "passed" || outcome === "failed" || outcome === "abandoned" || outcome === "in-progress" ? outcome : "failed",
    submittedBlind: Boolean(firstRun?.submission),
  };

  return {
    challenge: {
      title: context.title ?? "this challenge",
      language: context.language ?? "unknown",
      ...(context.statement ? { statement: context.statement } : {}),
    },
    startedAt,
    endedAt: completion ? endedAt : now,
    open: !completion,
    events: log,
    runs,
    cases,
    edits,
    moments,
    stats,
  };
}

/**
 * One event's payload, spelled out rather than JSON-dumped. Known shapes are
 * named; anything unrecognised falls back to its own key=value pairs, so a new
 * event type is legible in the log the day it is added instead of invisible.
 */
function describePayload(event: ReplayEvent): string {
  const payload = event.payload;
  if (event.type === "file_changed") {
    return `${text(payload.path) ?? "a file"}${numeric(payload.bytes) === undefined ? "" : ` bytes=${numeric(payload.bytes)}`}`;
  }
  if (event.type === "command_executed") return `${text(payload.command) ?? "run"} ${text(payload.language) ?? ""}`.trim();
  if (event.type === "test_run") {
    const cases = caseList(payload.cases);
    const parts = [
      `scope=${text(payload.scope) ?? "visible"}`,
      numeric(payload.exitCode) === undefined ? "" : `exit=${numeric(payload.exitCode)}`,
      cases.length ? `${numeric(payload.passedCases) ?? cases.filter((item) => item.status === "passed").length}/${cases.length} passed` : "no cases reported",
      numeric(payload.durationMs) === undefined ? "" : `${Math.round(numeric(payload.durationMs)!)}ms`,
    ].filter(Boolean);
    const summary = firstLine(text(payload.summary) ?? "");
    return `${parts.join(" ")}${!cases.length && summary ? ` output="${summary}"` : ""}`;
  }
  if (event.type === "learner_remark") return `"${firstLine(text(payload.body) ?? "")}"`;
  if (event.type === "attempt_completed" || event.type === "submission_evaluated") {
    const reason = text(payload.reason);
    const rest = pairs(payload, ["outcome", "reason"]);
    return `outcome=${text(payload.outcome) ?? "unknown"}${reason ? ` reason="${firstLine(reason)}"` : ""}${rest ? ` ${rest}` : ""}`;
  }
  return pairs(payload, []);
}

/** Whatever the payload carries that nothing above named, so a payload key added
 *  later shows up in the log the day it is added instead of vanishing. */
function pairs(payload: Record<string, unknown>, named: string[]): string {
  return Object.entries(payload)
    .filter(([key]) => key !== "cases" && key !== "summary" && !named.includes(key))
    .map(([key, value]) => `${key}=${scalar(value)}`)
    .join(" ");
}

/** One test case inside a run, as its own log line under that run. */
function caseLine(record: { name: string; status: CaseVerdict; expected?: string; actual?: string; message?: string }): string {
  const mark = record.status === "passed" ? "PASS" : record.status === "failed" ? "FAIL" : record.status.toUpperCase();
  const failure = record.expected !== undefined || record.actual !== undefined
    ? `  expected ${record.expected ?? "?"}, got ${record.actual ?? "?"}`
    : record.message
      ? `  error ${record.message}`
      : "";
  return `${mark.padEnd(5)} ${record.name}${failure}`;
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value.length > 120 ? `"${value.slice(0, 120)}…"` : value;
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value && typeof value === "object") return "{…}";
  return String(value);
}

type CaseDetail = { expected?: string; actual?: string; message?: string };
type Observed = { verdicts: Map<string, CaseVerdict>; details: Map<string, CaseDetail> };

/** The last thing any run said about one case, ignoring runs that never ran it. */
function lastVerdict(observed: Observed[], name: string): CaseVerdict | undefined {
  for (let index = observed.length - 1; index >= 0; index -= 1) {
    const verdict = observed[index]!.verdicts.get(name);
    if (verdict) return verdict;
  }
  return undefined;
}

/** One case, transposed out of the runs: the row across a column per run. */
function foldCase(name: string, hidden: boolean, runs: ReplayRun[], observed: Observed[]): ReplayCase {
  const verdicts: CaseVerdict[] = [];
  let failures = 0;
  let passes = 0;
  let regressed = false;
  let hasPassed = false;
  let hadFailed = false;
  let fixedAtMs: number | undefined;
  let lastFailure: ReplayCase["lastFailure"];

  for (const [index, run] of runs.entries()) {
    const record = observed[index]?.verdicts.get(name);
    const detail = observed[index]?.details.get(name);
    if (!record) {
      verdicts.push("absent");
      continue;
    }
    verdicts.push(record);
    if (record === "failed") {
      failures += 1;
      hadFailed = true;
      if (hasPassed) regressed = true;
      lastFailure = { ...(detail ?? {}), atMs: run.offsetMs };
    }
    if (record === "passed") {
      passes += 1;
      if (hadFailed && fixedAtMs === undefined) fixedAtMs = run.offsetMs;
      hasPassed = true;
    }
  }

  const seen = verdicts.filter((verdict) => verdict !== "absent");
  return {
    name,
    hidden,
    verdicts,
    failures,
    passes,
    ...(fixedAtMs === undefined ? {} : { fixedAtMs }),
    regressed,
    neverPassed: passes === 0,
    passedFirstTry: seen[0] === "passed",
    finalVerdict: seen.at(-1) ?? "absent",
    ...(lastFailure ? { lastFailure } : {}),
  };
}

/* ---- The log the agent reads -------------------------------------------- */

/**
 * The attempt's own log, written out in full.
 *
 * Not a summary and not an interpretation: one line per recorded event, in
 * order, with its offset, its sequence, who recorded it, and its payload spelled
 * out — plus a line per test case inside every run, which is the part that used
 * to be thrown away. What the agent concludes from it is the agent's business.
 *
 * The derived sections are there because two of them cannot be read off a
 * chronological log at all: a case's verdict across every run is a transpose,
 * and a run's fixed/broke delta is a diff against the last run that saw the same
 * case. They are counts and comparisons, never judgements. Everything is opt-in
 * by section, so a turn asks for as much of the attempt as it actually needs.
 */
export function formatSolveLog(replay: AttemptReplay, filters: Partial<ReplayFilters> = {}): string {
  const sections = filters.sections?.length ? filters.sections : DEFAULT_SECTIONS;
  const caseDetail = filters.caseDetail ?? "full";
  const scope = filters.scope ?? "all";
  const maxLines = filters.maxLines ?? 400;
  const cut = scope === "since-last-submission" ? lastSubmissionOffset(replay) : 0;
  const types = filters.events?.length ? new Set(filters.events) : null;

  const lines: string[] = [];
  const { stats, challenge } = replay;
  lines.push(`SOLVE LOG — ${challenge.title} (${challenge.language})`);
  lines.push(`opened ${new Date(replay.startedAt).toISOString()} · ${outcomeWord(replay)} · ${stats.events} events · ${stats.runs} runs · ${stats.submissions} submissions · ${stats.saves} saves · ${stats.casesTracked} distinct test cases`);
  lines.push(`Offsets are +mm:ss from the moment the attempt opened. Nothing here is inferred; it is what was recorded.`);
  if (cut > 0) lines.push(`Filtered to events after the last submission at ${offset(cut)}.`);
  if (types) lines.push(`Filtered to event types: ${[...types].join(", ")}.`);

  const runs = replay.runs.filter((run) => run.offsetMs >= cut);
  const cases = filterCases(replay.cases, filters.cases ?? "all");

  if (sections.includes("log")) {
    const entries = replay.events.filter((event) => event.offsetMs >= cut && (!types || types.has(event.type)));
    lines.push("", `LOG (${entries.length} event${entries.length === 1 ? "" : "s"})`);
    const written: string[] = [];
    for (const event of entries) {
      written.push(`  ${offset(event.offsetMs).padEnd(8)} #${String(event.sequence).padEnd(3)} ${event.source.padEnd(7)} ${event.type.padEnd(20)} ${event.detail}`);
      // Indented to the detail column of the line above, so a run's cases read
      // as belonging to that run rather than as events of their own.
      for (const line of event.caseLines) {
        written.push(`  ${" ".repeat(43)}${caseDetail === "brief" ? line.replace(/ {2,}(expected|error) .*$/, "") : line}`);
      }
    }
    if (written.length > maxLines) {
      lines.push(`  (${written.length - maxLines} earlier line${written.length - maxLines === 1 ? "" : "s"} omitted by maxLines; raise it or filter by events/scope to see them)`);
      lines.push(...written.slice(-maxLines));
    } else lines.push(...written);
  }

  if (sections.includes("cases")) {
    lines.push("", "CASE HISTORY (transposed out of the runs above)");
    lines.push(`  One row per case, one column per run in order. ${LEGEND}`);
    if (!cases.length) lines.push("  (no cases recorded, or none match this filter — a C++ challenge reports no cases at all)");
    const width = Math.min(46, Math.max(0, ...cases.map((item) => item.name.length + 2)));
    for (const item of cases) {
      const strip = item.verdicts.filter((_, index) => (replay.runs[index]?.offsetMs ?? 0) >= cut).map(symbol).join(" ");
      lines.push(`  ${`"${item.name}"`.padEnd(width)} ${strip.padEnd(12)}  ${caseCounts(item)}`);
    }
  }

  if (sections.includes("runs")) {
    lines.push("", "RUN DELTAS (each run against the last run that saw the same case)");
    if (!runs.length) lines.push("  (no runs in this scope)");
    for (const run of runs) {
      const extras: string[] = [];
      if (run.fixed.length) extras.push(`newly passing: ${quoteList(run.fixed)}`);
      if (run.broke.length) extras.push(`newly failing: ${quoteList(run.broke)}`);
      lines.push(`  ${offset(run.offsetMs).padEnd(8)} ${(run.submission ? "submission" : "visible").padEnd(12)} ${run.totalCases ? `${run.passedCases}/${run.totalCases}` : run.passed ? "passed" : "failed"}${extras.length ? `   ${extras.join("   ")}` : ""}`);
    }
  }

  if (sections.includes("timings")) {
    lines.push("", "TIMINGS");
    lines.push(`  total on this attempt: ${duration(stats.elapsedMs)}${replay.open ? " and still open" : ""}`);
    if (stats.timeToFirstRunMs !== undefined) lines.push(`  attempt opened to first run: ${duration(stats.timeToFirstRunMs)}`);
    lines.push(`  longest gap between two recorded events: ${duration(stats.longestGapMs)}`);
    for (const run of runs) lines.push(`  run at ${offset(run.offsetMs)}: ${run.durationMs === undefined ? "duration not recorded" : `${Math.round(run.durationMs)}ms`}`);
    for (const edit of replay.edits.filter((edit) => edit.lastMs >= cut)) {
      lines.push(`  ${offset(edit.firstMs)} → ${offset(edit.lastMs)}: ${edit.path}, ${edit.saves} save${edit.saves === 1 ? "" : "s"}${edit.bytes === undefined ? "" : `, ${edit.bytes} bytes at the end`}`);
    }
  }

  return lines.join("\n");
}

const LEGEND = "P passed, F failed, S skipped, - not run in that run (a hidden case only runs on a submission).";

function caseCounts(item: ReplayCase): string {
  const facts = [
    item.hidden ? "hidden" : "visible",
    `${item.passes} pass${item.passes === 1 ? "" : "es"}`,
    `${item.failures} failure${item.failures === 1 ? "" : "s"}`,
  ];
  if (item.fixedAtMs !== undefined) facts.push(`first passed after failing at ${offset(item.fixedAtMs)}`);
  if (item.regressed) facts.push(`failed again at ${offset(item.lastFailure?.atMs ?? 0)}`);
  return facts.join(", ");
}

function filterCases(cases: ReplayCase[], filter: CaseFilter): ReplayCase[] {
  if (filter === "failed-ever") return cases.filter((item) => item.failures > 0);
  if (filter === "still-failing") return cases.filter((item) => item.finalVerdict === "failed");
  if (filter === "fixed") return cases.filter((item) => item.fixedAtMs !== undefined);
  return cases;
}

function outcomeWord(replay: AttemptReplay): string {
  if (replay.stats.outcome === "in-progress") return "still open";
  if (replay.stats.outcome === "abandoned") return "abandoned by the learner";
  return `graded ${replay.stats.outcome}`;
}

function lastSubmissionOffset(replay: AttemptReplay): number {
  return [...replay.runs].reverse().find((run) => run.submission)?.offsetMs ?? 0;
}

function symbol(verdict: CaseVerdict): string {
  if (verdict === "passed") return "P";
  if (verdict === "failed") return "F";
  if (verdict === "absent") return "-";
  return "S";
}

function quoteList(names: string[]): string {
  return names.map((name) => `"${name}"`).join(", ");
}

/* ---- Shared formatting, used by the report and by the panel -------------- */

export function offset(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1_000));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `+${hours}:${pad(minutes)}:${pad(seconds)}` : `+${pad(minutes)}:${pad(seconds)}`;
}

export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1_000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function time(event: ReplayEvent): number {
  const value = Date.parse(event.occurredAt);
  return Number.isFinite(value) ? value : 0;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstLine(value: string): string {
  const line = value.split("\n").map((entry) => entry.trim()).find(Boolean) ?? "";
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

function caseList(value: unknown): Array<{ name: string; status: CaseVerdict; expected?: string; actual?: string; message?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const name = text(record.name);
    if (!name) return [];
    const status = record.status;
    return [{
      name,
      status: status === "passed" || status === "failed" || status === "skipped" || status === "todo" ? status : "failed",
      ...(text(record.expected) === undefined ? {} : { expected: text(record.expected)! }),
      ...(text(record.actual) === undefined ? {} : { actual: text(record.actual)! }),
      ...(text(record.message) === undefined ? {} : { message: text(record.message)! }),
    }];
  });
}
