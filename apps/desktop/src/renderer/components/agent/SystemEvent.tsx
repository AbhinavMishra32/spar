import { useState } from "react";
import { CheckCircle2, ChevronRight, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChallengeOutcomeTag } from "./ChallengeCardMeta";
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
  const result = source
    ? `${source} accepted the submission${duration ? ` in ${duration}` : ""}`
    : /every visible and hidden test passes/i.test(verdict)
      ? "Every visible and hidden case passed"
      : "The challenge passed";

  return (
    <div className="transcript-block relative flex min-w-0 items-center gap-2.5 overflow-hidden px-3 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--color-background-elevated-secondary)] text-muted-foreground ring-[0.5px] ring-[var(--border-surface-strong)]">
        {sourceKind ? <SourceGlyph className="size-4" source={sourceKind} /> : <SparDots pattern="still" size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-thread font-semibold text-foreground">Attempt completed</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-ui-sm text-muted-foreground">
          <span className="min-w-0 truncate">{result}</span>
          {requirements.length > 0 && <><span aria-hidden className="text-muted-foreground/45">·</span><span className="shrink-0">{requirements.length} requirement{requirements.length === 1 ? "" : "s"}</span></>}
          <span aria-hidden className="text-muted-foreground/45">·</span>
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground/70">{id.slice(0, 8)}</span>
        </span>
      </span>
      <ChallengeOutcomeTag outcome="passed" />
    </div>
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
        {meta && <span className="mt-0.5 block truncate text-ui-sm text-muted-foreground">{meta}</span>}
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
          <span className="mt-0.5 block truncate text-ui-sm text-muted-foreground">{detail}</span>
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
