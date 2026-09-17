import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CaseDots, FailingCase, SubmissionLine } from "../agent/SubmissionCard";
import { CodePeek } from "../common/CodePeek";
import type { SparApi } from "../../../shared/api";
import type { SubmissionRecord, SubmissionRow } from "../../../shared/submissions";

/**
 * Everything the learner sent at this challenge, on the challenge's own page.
 *
 * The page already had a timeline, and a timeline is the wrong shape for this:
 * a submission arrived as three of its rows — "submitted", "ran 7 cases",
 * "graded failed" — scattered among the saves, so the one question a learner
 * comes back to a solved challenge to ask ("what did I actually try?") had to be
 * reassembled by eye from a log. Here each submission is one row that keeps its
 * own verdict, its own case grid and its own code.
 *
 * Folded by default and read on demand. A list of ten open panels is a file
 * viewer, and the row itself — the verdict and the dots — already answers most
 * of what is being asked; the code is the follow-up question.
 */
export function ChallengeSubmissions({ api, challengeId, focusId }: {
  api: SparApi | undefined;
  challengeId: string;
  /** Opened and scrolled to on arrival, when the page was reached by following a
   *  reference to one particular submission. */
  focusId?: string | null | undefined;
}) {
  const [rows, setRows] = useState<SubmissionRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(focusId ?? null);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    void api.listChallengeSubmissions(challengeId)
      .then((found) => { if (alive) setRows(found); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [api, challengeId]);

  useEffect(() => { setOpen(focusId ?? null); }, [focusId]);

  if (!rows || rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <Submission
          api={api}
          key={row.id}
          onToggle={() => setOpen((current) => (current === row.id ? null : row.id))}
          open={open === row.id}
          row={row}
          scrollIntoView={row.id === focusId}
        />
      ))}
    </div>
  );
}

function Submission({ api, onToggle, open, row, scrollIntoView }: {
  api: SparApi | undefined;
  onToggle(): void;
  open: boolean;
  row: SubmissionRow;
  scrollIntoView: boolean;
}) {
  const [detail, setDetail] = useState<SubmissionRecord | null | undefined>(undefined);
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || detail !== undefined || !api) return;
    let alive = true;
    void api.readSubmission(row.id)
      .then((found) => { if (alive) setDetail(found); })
      .catch(() => { if (alive) setDetail(null); });
    return () => { alive = false; };
  }, [api, detail, open, row.id]);

  /* Once, on arrival. A reference followed from the transcript lands on a page
     whose submission may be well below the fold, and a page that opens
     somewhere other than the thing that was clicked reads as the wrong page. */
  useEffect(() => {
    if (!scrollIntoView) return;
    const frame = requestAnimationFrame(() => node.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [scrollIntoView]);

  const failure = detail?.cases.find((item) => item.status === "failed");

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border bg-card transition-colors",
        scrollIntoView ? "border-[var(--reference)]/45" : "border-border",
      )}
      ref={node}
    >
      <button
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left outline-none transition-colors hover:bg-accent/30 focus-visible:ring-1 focus-visible:ring-ring"
        onClick={onToggle}
        type="button"
      >
        <SubmissionLine className="flex-1" submission={row} />
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground/60 transition-transform", open && "rotate-90")} />
      </button>

      {/* The grid stays out on the row, folded or not. It is the part that is
          read by sweeping down the list — six rows of dots say how the solve
          went without a single one being opened. */}
      {(row.totalCases > 0) && (
        <div className="px-3 pb-2">
          <CaseDots cases={[]} passed={row.passedCases} total={row.totalCases} />
        </div>
      )}

      {open && (
        <div className="flex flex-col gap-2 border-t border-border/70 px-3 py-2.5">
          {detail === undefined && <p className="text-ui-sm text-muted-foreground">Reading this submission…</p>}
          {detail === null && <p className="text-ui-sm text-muted-foreground">This submission is no longer recorded.</p>}
          {detail && (
            <>
              {detail.cases.length > 0 && <CaseDots cases={detail.cases} passed={detail.passedCases} total={detail.totalCases} />}
              {failure && <FailingCase failure={failure} />}
              {detail.code
                ? (
                  <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--code-background)] ring-[0.5px] ring-[var(--border-surface-strong)]">
                    <div className="px-2.5 pt-2 font-mono text-[0.625rem] text-muted-foreground/70">{detail.code.path}</div>
                    <CodePeek className="max-h-72 overflow-auto px-2.5 pb-2 pt-1 text-[0.6875rem]" code={detail.code.text} />
                  </div>
                )
                : <p className="text-ui-sm text-muted-foreground">This submission was recorded before Spar kept a copy of what was sent.</p>}
              {detail.url && (
                <p className="text-ui-sm text-muted-foreground">
                  Judged by {detail.judge === "leetcode" ? "LeetCode" : "Codeforces"}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
