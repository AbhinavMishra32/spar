import { useState } from "react";
import { CheckCircle2, ChevronRight, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { UNDER_LABEL } from "./ActivityRow";

/**
 * Some persisted "system" messages are orchestration prompts addressed to the
 * agent, not prose for the learner — the submission handoff is several hundred
 * characters of instructions ending in a raw attempt UUID. Rendering those as
 * paragraphs dumps internal machinery into the conversation, so the ones we can
 * recognise become a one-line event and the rest collapse behind a summary.
 */

const SUBMISSION = /submitted attempt\s+([0-9a-f-]{36})\.\s*Deterministic .*?outcome\s+(passed|failed)\s+with exit code\s+(\d+)/i;
const RESUME = /^Resume this persisted planning session/i;
const NEW_GOAL = /^Start a new adaptive session for this learner goal:\s*(.*)$/i;

export function SystemEvent({ body }: { body: string }) {
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
    /* The transcript's own gutter, so a system line starts where every other
       row's label starts instead of a few pixels short of it. */
    <div className="-mx-1 flex min-w-0 items-center gap-1.5 pb-2 text-thread">
      <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
        <Icon
          className={cn(
            "size-3.5",
            tone === "success" ? "text-[var(--success)]" : tone === "destructive" ? "text-destructive" : "text-muted-foreground/85",
          )}
        />
      </span>
      <span className="shrink-0 font-medium text-muted-foreground">{title}</span>
      {meta && <span className="min-w-0 flex-1 truncate text-muted-foreground">{meta}</span>}
    </div>
  );
}

function Collapsible({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <button
        className="-mx-1 flex w-full min-w-0 items-center gap-1.5 pb-2 text-left text-thread text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
          <Info className="size-4 text-muted-foreground/85" />
        </span>
        <span className="shrink-0 font-medium text-muted-foreground">System</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{body}</span>
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {/* Flush with the trigger, like every other disclosure in the transcript:
          the expanded text is the same event in full, not a child of it. */}
      {open && (
        <p className="min-w-0 break-words pb-2 text-thread leading-[1.6] text-muted-foreground/80" style={{ paddingLeft: UNDER_LABEL }}>
          {body}
        </p>
      )}
    </div>
  );
}
