import { useState } from "react";
import { CheckCircle2, ChevronRight, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceGlyph } from "../common/SourceGlyph";
import { SparDots } from "../common/SparDots";

/**
 * Some persisted "system" messages are orchestration prompts addressed to the
 * agent, not prose for the learner — the submission handoff is several hundred
 * characters of instructions ending in a raw attempt UUID. Rendering those as
 * paragraphs dumps internal machinery into the conversation, so the ones we can
 * recognise become a one-line event and the rest collapse behind a summary.
 */

const SUBMISSION = /submitted attempt\s+([0-9a-f-]{36})\.\s*Deterministic .*?outcome\s+(passed|failed)\s+with exit code\s+(\d+)/i;
const SOLVED_ATTEMPT = /^The learner solved attempt\s+([0-9a-f-]{36})\s+—\s+([\s\S]+)$/i;
const RESUME = /^Resume this persisted planning session/i;
const NEW_GOAL = /^Start a new adaptive session for this learner goal:\s*(.*)$/i;

export function SystemEvent({ body }: { body: string }) {
  const solved = SOLVED_ATTEMPT.exec(body);
  if (solved) return <SolvedAttempt body={body} id={solved[1]!} verdict={solved[2]!} />;

  const submission = SUBMISSION.exec(body);
  if (submission) {
    const passed = submission[2]?.toLowerCase() === "passed";
    return (
      <Row
        icon={passed ? CheckCircle2 : XCircle}
        tone={passed ? "success" : "destructive"}
        title={passed ? "Submission accepted" : "Submission rejected"}
        meta={`exit ${submission[3]} · attempt ${submission[1]?.slice(0, 8)}`}
      />
    );
  }

  if (RESUME.test(body)) return <Row icon={Info} title="Resumed this planning session" />;

  const goal = NEW_GOAL.exec(body);
  if (goal) return <Row icon={Info} title="Session started" meta={goal[1]} />;

  return <Collapsible body={body} />;
}

/**
 * The moment a challenge was solved, drawn as a mark in the transcript rather
 * than as an object in it.
 *
 * It used to be a `transcript-block` — a tile, a title, a meta line and an
 * outcome tag — which is the exact shape of a challenge card. That made the
 * thread's one irreversible milestone read as one more thing to open, sitting in
 * a stack of cards that are all openable, and the eye had no way to tell the
 * event apart from the objects around it.
 *
 * So: a rule across the column with the verdict set into it, the way a chapter
 * break is set into a page. Nothing to click, no panel, no shadow — it is a line
 * in the timeline that happens to carry words. The mark in the middle is Spar's
 * own, or the judge's when a judge is the one who accepted it, because who
 * accepted the submission is the only part of this a learner ever queries.
 *
 * The attempt id moves to the title attribute. It is a UUID prefix for support,
 * not something to spend a third of a narrow row on.
 */
function SolvedAttempt({ body, id, verdict }: { body: string; id: string; verdict: string }) {
  const requirementText = body.match(/This challenge required:\s*([\s\S]*?)\.\s*Read their code/i)?.[1] ?? "";
  const requirements = Array.from(requirementText.matchAll(/"([^"]+)"/g), (match) => match[1]!).filter(Boolean);
  const source = verdict.match(/^(.+?) accepted their submission/i)?.[1];
  const sourceKind = source?.toLowerCase() === "leetcode"
    ? "leetcode"
    : source?.toLowerCase() === "codeforces"
      ? "codeforces"
      : null;
  const duration = verdict.match(/\(Accepted,\s*([^)]+)\)/i)?.[1];
  /* Lower case where the sentence allows it: this reads as one line after
     "Solved", not as a headline under it. */
  const result = source
    ? `${source} accepted the submission${duration ? ` in ${duration}` : ""}`
    : /every visible and hidden test passes/i.test(verdict)
      ? "every visible and hidden case passed"
      : "the challenge passed";

  return (
    <div
      aria-label={`Solved — ${result}`}
      className="flex min-w-0 items-center gap-2.5 py-1"
      title={`Attempt ${id}`}
    >
      <Rule side="left" />
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="grid size-4 shrink-0 place-items-center">
          {sourceKind
            ? <SourceGlyph className="size-4 opacity-80" source={sourceKind} />
            : <SparDots className="text-[var(--success)]" pattern="still" size={15} />}
        </span>
        <span className="shrink-0 text-thread font-semibold tracking-[-0.01em] text-[var(--success)]">Solved</span>
        <span aria-hidden className="shrink-0 text-muted-foreground/40">·</span>
        <span className="min-w-0 truncate text-thread-tool text-muted-foreground">{result}</span>
        {requirements.length > 0 && (
          <>
            <span aria-hidden className="shrink-0 text-muted-foreground/40">·</span>
            <span className="shrink-0 text-thread-tool text-muted-foreground/75">
              {requirements.length} requirement{requirements.length === 1 ? "" : "s"}
            </span>
          </>
        )}
      </span>
      <Rule side="right" />
    </div>
  );
}

/** The hairline either side of the verdict, fading out towards the pane so the
 *  rule reads as a mark set into the column rather than as a divider that cuts
 *  the thread in two. */
function Rule({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-px min-w-3 flex-1",
        side === "left"
          ? "bg-[linear-gradient(to_right,transparent,color-mix(in_oklab,var(--success)_40%,var(--border-surface-strong)))]"
          : "bg-[linear-gradient(to_left,transparent,color-mix(in_oklab,var(--success)_40%,var(--border-surface-strong)))]",
      )}
    />
  );
}

function Row({
  icon: Icon,
  title,
  meta,
  tone = "muted",
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  meta?: string | undefined;
  tone?: "muted" | "success" | "destructive";
}) {
  return (
    <div className="-mx-1 flex min-w-0 items-center gap-2 px-1 py-1.5 text-thread">
      <span aria-hidden className="grid size-6 shrink-0 place-items-center">
        <Icon
          className={cn(
            "size-3.5",
            tone === "success" ? "text-[var(--success)]" : tone === "destructive" ? "text-destructive" : "text-muted-foreground/85",
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground/85">{title}</span>
        {meta && <span className="mt-0.5 block truncate text-thread-tool text-muted-foreground">{meta}</span>}
      </span>
    </div>
  );
}

function Collapsible({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const clean = body.trim();
  const sentence = clean.match(/^(.+?[.!?])(?:\s+|$)/s)?.[1];
  const hasUsefulTitle = Boolean(sentence && sentence.length <= 140);
  const title = hasUsefulTitle ? sentence!.replace(/[.!?]$/, "") : "System update";
  const detail = hasUsefulTitle ? clean.slice(sentence!.length).trim() : clean;
  if (!detail) return <Row icon={Info} title={title} />;

  return (
    <div className="min-w-0">
      <button
        aria-expanded={open}
        className="-mx-1 flex w-[calc(100%+0.5rem)] min-w-0 cursor-default items-center gap-2 px-1 py-1.5 text-left text-thread text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span aria-hidden className="grid size-6 shrink-0 place-items-center">
          <Info className="size-3.5 text-muted-foreground/85" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground/85">{title}</span>
          <span className="mt-0.5 block truncate text-thread-tool text-muted-foreground">{detail}</span>
        </span>
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <p className="ml-7 mt-1 min-w-0 whitespace-pre-wrap break-words border-l border-border/70 py-1 pl-3 text-thread leading-[1.6] text-muted-foreground/85">
          {detail}
        </p>
      )}
    </div>
  );
}
