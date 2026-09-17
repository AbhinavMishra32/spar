import { cn } from "@/lib/utils";
import { CodePeek } from "../common/CodePeek";
import { SourceGlyph } from "../common/SourceGlyph";
import { SparDots } from "../common/SparDots";
import type { SubmissionCase, SubmissionRecord, SubmissionRow } from "../../../shared/submissions";

/**
 * What a submission looks like wherever one is shown.
 *
 * A submission is now a thing the learner can be pointed at — from a sentence in
 * the transcript, from the list on a challenge's own page — so it needs one
 * appearance, not one per surface. Everything here is built from the same two
 * parts: the line that says what became of it, and the grid of cases it was
 * graded on.
 *
 * The grid is the point. A verdict is one word and a case count is two numbers,
 * and neither of them shows the thing a learner actually wants to see, which is
 * the shape of the failure — one red dot at the end is an edge case, a red block
 * in the middle is a misread of the problem, and all-but-two red is a solution
 * that never ran. One dot per case says that at a glance, in the space a
 * sentence would take.
 */

/** Past this many cases the grid stops being a shape and becomes a texture, and
 *  a hover card cannot hold it either way. The tail is kept: the cases a runner
 *  reaches last are the ones a fail-fast run died on. */
const MAX_DOTS = 60;

export function CaseDots({ cases, max = MAX_DOTS, passed, total, className }: {
  cases: SubmissionCase[];
  /** Fewer dots than the default, where the row drawing them is narrow. */
  max?: number;
  /** Used when there are no named cases — a remote judge grades against hidden
   *  cases it will not name, and "34 of 41" is still a shape worth drawing. */
  passed: number;
  total: number;
  className?: string;
}) {
  const ceiling = Math.max(1, Math.min(max, MAX_DOTS));
  /* Unnamed cases draw as a proportion, not as a prefix. Thirty-four of
     forty-one in twelve dots is ten green and two red — taking the first twelve
     of the forty-one instead would draw twelve green and say the submission
     passed. */
  const marks: Array<SubmissionCase["status"]> = cases.length
    ? cases.map((item) => item.status)
    : total > ceiling
      ? Array.from({ length: ceiling }, (_, index) => (index < Math.round((passed / total) * ceiling) ? "passed" : "failed"))
      : Array.from({ length: total }, (_, index) => (index < passed ? "passed" : "failed"));
  if (marks.length === 0) return null;
  const shown = marks.length > ceiling ? marks.slice(-ceiling) : marks;

  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-[3px]", className)}>
      {marks.length > shown.length && <span aria-hidden className="mr-0.5 text-thread-tool text-muted-foreground/45">…</span>}
      {shown.map((status, index) => (
        <span
          aria-hidden
          className={cn(
            "size-[5px] shrink-0 rounded-full transition-colors",
            status === "passed" ? "bg-[var(--success)]"
              : status === "failed" ? "bg-destructive"
              : "bg-muted-foreground/30",
          )}
          key={index}
          title={cases[marks.length > shown.length ? marks.length - shown.length + index : index]?.name}
        />
      ))}
    </span>
  );
}

/** The mark in front of a submission: who graded it. Spar's own dots, or the
 *  judge's, because "LeetCode said no" and "your hidden cases said no" are two
 *  different pieces of news. */
export function SubmissionGlyph({ judge, outcome, size = 15 }: {
  judge: SubmissionRow["judge"];
  outcome: SubmissionRow["outcome"];
  size?: number;
}) {
  if (judge !== "spar") return <SourceGlyph className="size-4 shrink-0 opacity-80" source={judge} />;
  return (
    <SparDots
      className={cn("shrink-0", outcome === "passed" ? "text-[var(--success)]" : outcome === "failed" ? "text-destructive/80" : "text-muted-foreground/60")}
      pattern="still"
      size={size}
    />
  );
}

export function outcomeWord(submission: Pick<SubmissionRow, "outcome" | "status">): string {
  if (submission.status) return submission.status;
  return submission.outcome === "passed" ? "Accepted" : submission.outcome === "failed" ? "Rejected" : "Not graded";
}

const OUTCOME_TONE: Record<SubmissionRow["outcome"], string> = {
  passed: "text-[var(--success)]",
  failed: "text-destructive",
  pending: "text-muted-foreground",
};

/** The line every surface shows: which submission, what became of it, how much
 *  of it passed. */
export function SubmissionLine({ submission, className }: { submission: SubmissionRow; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <SubmissionGlyph judge={submission.judge} outcome={submission.outcome} />
      <span className="shrink-0 text-thread font-medium text-foreground">Submission {submission.ordinal}</span>
      <span aria-hidden className="shrink-0 text-muted-foreground/40">·</span>
      <span className={cn("min-w-0 truncate text-thread-tool font-medium", OUTCOME_TONE[submission.outcome])}>{outcomeWord(submission)}</span>
      {submission.totalCases > 0 && (
        <span className="ml-auto shrink-0 text-thread-tool tabular-nums text-muted-foreground">
          <span className={submission.passedCases === submission.totalCases ? "text-[var(--success)]" : "text-foreground/80"}>{submission.passedCases}</span>
          <span className="text-muted-foreground/55">/{submission.totalCases}</span>
        </span>
      )}
    </span>
  );
}

/** Where a failing case actually went wrong. One case, because a hover card that
 *  lists eight is a document, and the first failure is the one that explains the
 *  rest more often than not. */
export function FailingCase({ failure }: { failure: SubmissionCase }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] bg-destructive/[0.07] px-2 py-1.5">
      <div className="min-w-0 truncate text-thread-tool font-medium text-destructive">{failure.name}</div>
      {failure.input && (
        <div className="mt-0.5 min-w-0 truncate font-mono text-[0.625rem] text-muted-foreground">
          <span className="text-muted-foreground/60">on </span>{failure.input}
        </div>
      )}
      {(failure.expected || failure.actual) && (
        <div className="mt-0.5 min-w-0 truncate font-mono text-[0.625rem] text-muted-foreground">
          <span className="text-muted-foreground/60">expected </span>{failure.expected ?? "—"}
          <span className="text-muted-foreground/60"> · got </span>{failure.actual ?? "—"}
        </div>
      )}
      {!failure.input && !failure.expected && !failure.actual && failure.message && (
        <div className="mt-0.5 min-w-0 truncate font-mono text-[0.625rem] text-muted-foreground">{failure.message}</div>
      )}
    </div>
  );
}

/** Lines of the submitted solution the hover card shows. Enough to recognise the
 *  approach — the loop, the data structure, the name they reached for — and not
 *  so many that the card becomes a file viewer. */
const PEEK_LINES = 10;

function excerpt(code: string): { text: string; remaining: number } {
  const lines = code.replace(/\t/g, "  ").split("\n");
  /* Leading blank lines and a shebang are not the solution. */
  let start = 0;
  while (start < lines.length && !(lines[start] ?? "").trim()) start += 1;
  const kept = lines.slice(start, start + PEEK_LINES);
  return { text: kept.join("\n"), remaining: Math.max(0, lines.length - start - kept.length) };
}

/**
 * What a submission reference opens under the pointer.
 *
 * The sentence in the transcript makes a claim about a moment — "your second
 * submission overwrote the running total" — and this is the evidence for it,
 * without leaving the sentence. Verdict, the case grid, the first thing that
 * failed, and the code that was actually sent, in that order: what happened,
 * where, and what they wrote.
 */
export function SubmissionPeek({ submission }: { submission: SubmissionRecord }) {
  const failure = submission.cases.find((item) => item.status === "failed");
  const peek = submission.code ? excerpt(submission.code.text) : null;

  return (
    <div className="flex w-[22rem] max-w-full min-w-0 flex-col gap-2">
      <SubmissionLine submission={submission} />

      <div className="min-w-0 truncate text-thread-tool text-muted-foreground/75">
        {submission.challengeTitle}
        {submission.runtime && <> · <span className="tabular-nums">{submission.runtime}</span></>}
        {!submission.runtime && submission.durationMs !== null && <> · <span className="tabular-nums">{Math.round(submission.durationMs)} ms</span></>}
      </div>

      {(submission.cases.length > 0 || submission.totalCases > 0) && (
        <CaseDots cases={submission.cases} passed={submission.passedCases} total={submission.totalCases} />
      )}

      {failure && <FailingCase failure={failure} />}

      {peek && submission.code && (
        <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--code-background)] ring-[0.5px] ring-[var(--border-surface-strong)]">
          <div className="flex min-w-0 items-center justify-between gap-2 px-2 pt-1.5 font-mono text-[0.625rem] text-muted-foreground/70">
            <span className="min-w-0 truncate">{submission.code.path}</span>
            {peek.remaining > 0 && <span className="shrink-0">+{peek.remaining}</span>}
          </div>
          <CodePeek className="px-2 pb-1.5 pt-1" code={peek.text} />
        </div>
      )}

      {!peek && (
        /* Submissions recorded before the code was snapshotted. Said plainly,
           because an empty panel reads as a submission with no code in it. */
        <div className="text-thread-tool text-muted-foreground/70">
          This submission was recorded before Spar kept a copy of what was sent.
        </div>
      )}
    </div>
  );
}
