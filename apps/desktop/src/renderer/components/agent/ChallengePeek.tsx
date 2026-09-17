import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { LanguageGlyph } from "../common/LanguageGlyph";
import { CaseDots, SubmissionGlyph, outcomeWord } from "./SubmissionCard";
import { CodePeek } from "../common/CodePeek";
import type { MentionChallenge } from "./Mentions";
import type { SubmissionRecord, SubmissionRow } from "../../../shared/submissions";

const DIFFICULTY: Record<MentionChallenge["difficulty"], string> = {
  foundation: "Foundation", developing: "Developing", proficient: "Proficient", advanced: "Advanced",
};

const OUTCOME: Record<string, string> = {
  passed: "Solved", failed: "Not solved", abandoned: "Given up", replaced: "Replaced",
};

const PEEK_LINES = 7;

/**
 * What a challenge's name opens under the pointer.
 *
 * A problem in this app is mostly its history: how long it took, how far the
 * cases got, and the run of attempts that got there. So that is what this shows
 * — the standing of the challenge on one line, then every submission at it in
 * this session as a row you can read across, then the code from the last one.
 * Nothing here is a control; it is the answer to "which one is that, and how did
 * it go", which is the question a name in a sentence raises.
 */
export function ChallengePeek({
  challenge,
  listSubmissions,
  readSubmission,
}: {
  challenge: MentionChallenge;
  listSubmissions(challengeId: string): Promise<SubmissionRow[]>;
  readSubmission?: ((submissionId: string) => Promise<SubmissionRecord | null>) | undefined;
}) {
  const [submissions, setSubmissions] = useState<SubmissionRow[] | null>(null);
  const [latest, setLatest] = useState<SubmissionRecord | null>(null);

  useEffect(() => {
    let alive = true;
    void listSubmissions(challenge.id)
      .then((found) => { if (alive) setSubmissions(found); })
      .catch(() => { if (alive) setSubmissions([]); });
    return () => { alive = false; };
  }, [challenge.id, listSubmissions]);

  /* The newest one's code, because "what does their solution look like" is the
     next question after "how did it go" and the answer is one more read. */
  useEffect(() => {
    const newest = submissions?.[submissions.length - 1];
    if (!newest || !readSubmission) return;
    let alive = true;
    void readSubmission(newest.id).then((found) => { if (alive) setLatest(found); }).catch(() => undefined);
    return () => { alive = false; };
  }, [readSubmission, submissions]);

  const seconds = Math.floor((challenge.elapsedMs ?? 0) / 1000);
  const total = challenge.totalCases ?? 0;
  const facts = [
    seconds > 0 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : null,
    total > 0 && challenge.passedCases != null ? `${challenge.passedCases}/${total} cases` : null,
    challenge.testRunCount ? `${challenge.testRunCount} run${challenge.testRunCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  const peek = latest?.code ? excerpt(latest.code.text) : null;

  return (
    <div className="flex w-[23rem] min-w-0 max-w-full flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <LanguageGlyph className="size-4 shrink-0" language={challenge.language} />
        <span className="min-w-0 flex-1 truncate text-thread font-semibold text-foreground">{challenge.title}</span>
        <span className="shrink-0 tabular-nums text-thread-tool text-muted-foreground/60">#{challenge.ordinal}</span>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-thread-tool text-muted-foreground/75">
        <span className={cn(challenge.outcome === "passed" && "text-[var(--success)]")}>
          {challenge.outcome ? OUTCOME[challenge.outcome] : "In progress"}
        </span>
        <span aria-hidden className="text-muted-foreground/40">·</span>
        <span>{DIFFICULTY[challenge.difficulty]}</span>
        {facts.map((fact) => (
          <span className="flex items-center gap-1.5" key={fact}>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            <span className="tabular-nums">{fact}</span>
          </span>
        ))}
      </div>

      {challenge.concepts && challenge.concepts.length > 0 && (
        <div className="min-w-0 truncate text-thread-tool text-muted-foreground/60">{challenge.concepts.join(" · ")}</div>
      )}

      {/* The attempts, newest last, so reading down the list is reading forward
          in time — the same direction the dots fill in. */}
      {submissions === null
        ? <p className="text-thread-tool text-muted-foreground/60">Reading submissions…</p>
        : submissions.length === 0
          ? <p className="text-thread-tool text-muted-foreground/60">Nothing submitted at this one yet.</p>
          : (
            <div className="flex min-w-0 flex-col gap-1 border-t-[0.5px] border-[var(--border-surface-strong)] pt-2">
              {submissions.slice(-4).map((submission) => (
                <div className="flex min-w-0 items-center gap-2" key={submission.id}>
                  <SubmissionGlyph judge={submission.judge} outcome={submission.outcome} size={12} />
                  <span className="shrink-0 text-thread-tool text-muted-foreground">#{submission.ordinal}</span>
                  {submission.totalCases > 0 && (
                    <CaseDots cases={[]} className="shrink-0 flex-nowrap" max={14} passed={submission.passedCases} total={submission.totalCases} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-thread-tool text-muted-foreground/70">{outcomeWord(submission)}</span>
                  {submission.totalCases > 0 && (
                    <span className="shrink-0 tabular-nums text-thread-tool text-muted-foreground/60">
                      {submission.passedCases}/{submission.totalCases}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

      {peek && latest?.code && (
        <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--code-background)] ring-[0.5px] ring-[var(--border-surface-strong)]">
          <div className="flex min-w-0 items-center justify-between gap-2 px-2 pt-1.5 font-mono text-[0.625rem] text-muted-foreground/70">
            <span className="min-w-0 truncate">{latest.code.path}</span>
            {peek.remaining > 0 && <span className="shrink-0">+{peek.remaining}</span>}
          </div>
          <CodePeek className="px-2 pb-1.5 pt-1" code={peek.text} />
        </div>
      )}
    </div>
  );
}

function excerpt(code: string): { text: string; remaining: number } {
  const lines = code.replace(/\t/g, "  ").split("\n");
  let start = 0;
  while (start < lines.length && !(lines[start] ?? "").trim()) start += 1;
  const kept = lines.slice(start, start + PEEK_LINES);
  return { text: kept.join("\n"), remaining: Math.max(0, lines.length - start - kept.length) };
}
