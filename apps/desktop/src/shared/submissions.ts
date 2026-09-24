/**
 * A submission, as a thing rather than as three events.
 *
 * Submitting already wrote a durable record: `submission_created`, the
 * `test_run` that graded it, and the `submission_evaluated` that settled the
 * verdict. But nothing in the app could point at one. The learner's own history
 * showed them as three rows of a flat timeline, the agent could only describe
 * them in prose it had re-derived from a log, and "the submission where you
 * fixed the empty-array case" was a sentence nobody could click.
 *
 * So the three events fold into one object with an identity — the id of the
 * `submission_created` event that opened it, which is already a UUID, already
 * unique, and already synced. Nothing new is stored to make a submission
 * addressable; what is new is that the code the learner sent is snapshotted onto
 * the opening event, because the workspace is mutable and by the time anyone
 * asks "what did I submit" the file has moved on.
 *
 * Folded rather than tabled deliberately. The event ledger is the system of
 * record and it syncs; a submissions table beside it would be a second copy of
 * the same facts, free to disagree with the first and needing a migration to
 * exist at all. Every submission ever made is already in the ledger, so this
 * reads history back as far as the events go — including attempts made before
 * this module was written, which have everything but the code snapshot.
 */

import type { TestCaseRecord } from "./testReport.js";

/** Who graded it. `spar` is the local runner against the hidden cases. */
export type SubmissionJudge = "spar" | "leetcode" | "codeforces";

export type SubmissionOutcome = "passed" | "failed" | "pending";

export type SubmissionCase = {
  name: string;
  status: "passed" | "failed" | "skipped" | "todo";
  durationMs?: number;
  input?: string;
  expected?: string;
  actual?: string;
  message?: string;
};

/** What a row, a chip or a hover card needs. Never the code — that is the one
 *  field big enough to be worth a second call, and a list of ten submissions
 *  would carry ten solutions nobody asked to read. */
export type SubmissionSummary = {
  id: string;
  attemptId: string;
  questionId: string;
  /** 1-based, across every attempt at this challenge in submission order. This
   *  is the number a sentence uses: "your third submission". */
  ordinal: number;
  outcome: SubmissionOutcome;
  judge: SubmissionJudge;
  /** The judge's own word for it — "Accepted", "Wrong Answer", "exit 1". Kept
   *  verbatim because a remote judge's vocabulary is the learner's evidence. */
  status: string;
  passedCases: number;
  failedCases: number;
  totalCases: number;
  /** How long the graded run took, where the grader said. */
  durationMs: number | null;
  /** A remote judge's own numbers, which are not the same claim as ours. */
  runtime: string | null;
  memory: string | null;
  url: string | null;
  submittedAt: string;
};

export type SubmissionDetail = SubmissionSummary & {
  /** What was sent. Null for a submission recorded before snapshots existed, or
   *  for one whose file could not be read at the moment it was sent. */
  code: { path: string; text: string; truncated: boolean } | null;
  cases: SubmissionCase[];
  /** Raw runner output, kept only where there were no cases to keep. */
  output: string;
};

/** The shape the fold reads. Deliberately structural rather than the domain's
 *  `AttemptEvent`: the store hands back rows, the renderer hands back parsed
 *  events, and neither should have to be converted to ask this question. */
export type SubmissionSourceEvent = {
  id: string;
  attemptId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

/** Ceiling on a snapshotted solution. Large enough for any challenge Spar sets
 *  or any judge accepts, small enough that an attempt with twenty submissions
 *  is still a reasonable row to sync. */
export const SUBMISSION_CODE_LIMIT = 24_000;

export function snapshotCode(path: string, text: string): { path: string; text: string; truncated: boolean } {
  return text.length > SUBMISSION_CODE_LIMIT
    ? { path, text: text.slice(0, SUBMISSION_CODE_LIMIT), truncated: true }
    : { path, text, truncated: false };
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function judge(value: unknown): SubmissionJudge {
  const named = text(value)?.toLowerCase();
  return named === "leetcode" ? "leetcode" : named === "codeforces" ? "codeforces" : "spar";
}

function cases(value: unknown): SubmissionCase[] {
  if (!Array.isArray(value)) return [];
  const found: SubmissionCase[] = [];
  for (const entry of value as TestCaseRecord[]) {
    const name = text(entry?.name);
    if (!name) continue;
    const status = entry.status === "failed" || entry.status === "skipped" || entry.status === "todo" ? entry.status : "passed";
    found.push({
      name,
      status,
      ...(num(entry.durationMs) === undefined ? {} : { durationMs: num(entry.durationMs)! }),
      ...(text(entry.input) === undefined ? {} : { input: text(entry.input)! }),
      ...(text(entry.expected) === undefined ? {} : { expected: text(entry.expected)! }),
      ...(text(entry.actual) === undefined ? {} : { actual: text(entry.actual)! }),
      ...(text(entry.message) === undefined ? {} : { message: text(entry.message)! }),
    });
  }
  return found;
}

/**
 * Every submission in a run of events, oldest first.
 *
 * A submission opens at `submission_created` and closes at the next
 * `submission_evaluated`; the `test_run` between them is the grading, and it is
 * the only one of the three that carries case results. Pairing by position
 * rather than by an id in the payload is what lets this read attempts recorded
 * before any of this existed — the three events have always been written in that
 * order, by one handler, within milliseconds of each other.
 *
 * A submission left open — created, never evaluated — still comes back, as
 * `pending`. That is a crash or a judge that never answered, and a submission
 * the learner remembers making should not vanish because the app died before the
 * verdict landed.
 *
 * Pass every attempt's events at a challenge and the ordinals number the whole
 * challenge; pass one attempt's and they number that attempt.
 */
export function foldSubmissions(events: SubmissionSourceEvent[]): SubmissionDetail[] {
  const ordered = [...events].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt) || left.sequence - right.sequence);

  const found: SubmissionDetail[] = [];
  let open: SubmissionDetail | null = null;

  const close = () => { if (open) found.push(open); open = null; };

  for (const event of ordered) {
    if (event.type === "submission_created") {
      close();
      const snapshot = event.payload.code;
      const code = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
        ? (() => {
            const record = snapshot as Record<string, unknown>;
            const path = text(record.path);
            const body = typeof record.text === "string" ? record.text : undefined;
            return path !== undefined && body !== undefined ? { path, text: body, truncated: record.truncated === true } : null;
          })()
        : null;
      open = {
        id: event.id,
        attemptId: event.attemptId,
        questionId: text(event.payload.questionId) ?? "",
        ordinal: found.length + 1,
        outcome: "pending",
        judge: judge(event.payload.judge),
        status: "",
        passedCases: 0,
        failedCases: 0,
        totalCases: 0,
        durationMs: null,
        runtime: null,
        memory: null,
        url: text(event.payload.url) ?? null,
        submittedAt: event.occurredAt,
        code,
        cases: [],
        output: "",
      };
      continue;
    }

    if (!open) continue;

    if (event.type === "test_run") {
      const records = cases(event.payload.cases);
      open.cases = records;
      open.judge = judge(event.payload.judge) === "spar" ? open.judge : judge(event.payload.judge);
      /* The judge's counts win where it gave them: a remote judge grades against
         hidden cases it never names, so `passedCases: 34, totalCases: 41` is the
         whole truth about that run and there are no records to count instead. */
      open.passedCases = num(event.payload.passedCases) ?? records.filter((item) => item.status === "passed").length;
      open.failedCases = num(event.payload.failedCases) ?? records.filter((item) => item.status === "failed").length;
      open.totalCases = num(event.payload.totalCases) ?? records.length;
      open.durationMs = num(event.payload.durationMs) ?? num(event.payload.runMs) ?? null;
      open.runtime = text(event.payload.runtime) ?? null;
      open.memory = text(event.payload.memory) ?? null;
      open.output = text(event.payload.summary) ?? "";
      if (!open.status) open.status = text(event.payload.status) ?? "";
      continue;
    }

    if (event.type === "submission_evaluated") {
      const outcome = text(event.payload.outcome);
      open.outcome = outcome === "passed" ? "passed" : outcome === "failed" ? "failed" : "pending";
      open.status = text(event.payload.status)
        ?? open.status
        ?? "";
      if (!open.status) {
        const exit = num(event.payload.exitCode);
        open.status = open.outcome === "passed" ? "Accepted" : exit === undefined ? "Rejected" : `exit ${exit}`;
      }
      open.url = text(event.payload.url) ?? open.url;
      open.judge = judge(event.payload.judge) === "spar" ? open.judge : judge(event.payload.judge);
      close();
      continue;
    }
  }
  close();

  /* Ordinals are assigned as they open, but a pending submission closing out of
     order would leave a gap. Renumber once at the end so the list a learner
     reads is always 1..n with nothing missing. */
  return found.map((submission, index) => ({ ...submission, ordinal: index + 1 }));
}

/** Where a submission sits, which the events themselves cannot say. Joined on by
 *  the store, because "your third submission" needs a challenge's name to be a
 *  sentence and the ledger only knows ids. */
export type SubmissionContext = {
  challengeId: string;
  challengeTitle: string;
  /** The challenge's number in its session, which is how every other surface
   *  refers to it. */
  challengeOrdinal: number;
  language: string;
  sessionId: string;
  sessionTitle: string;
  /** Which attempt at the challenge this was sent from, 1-based. More than one
   *  only where the challenge was reopened after a rejected review. */
  attemptOrdinal: number;
};

export type SubmissionRow = SubmissionSummary & SubmissionContext;
export type SubmissionRecord = SubmissionDetail & SubmissionContext;

/** The list without the parts that make it heavy. */
export function submissionSummary(detail: SubmissionDetail): SubmissionSummary {
  const { code: _code, cases: _cases, output: _output, ...summary } = detail;
  return summary;
}

/** How a submission reads in one line, for a tool result or an aria label. */
export function describeSubmission(submission: SubmissionSummary): string {
  const counts = submission.totalCases > 0 ? ` ${submission.passedCases}/${submission.totalCases} cases` : "";
  const name = submission.judge === "spar" ? "Spar" : submission.judge === "leetcode" ? "LeetCode" : "Codeforces";
  return `#${submission.ordinal} ${submission.outcome}${counts} — ${name}${submission.status ? ` said ${submission.status}` : ""}`;
}
