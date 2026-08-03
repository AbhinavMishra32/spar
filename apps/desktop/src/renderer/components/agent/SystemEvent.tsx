import { useState } from "react";
import { CheckCircle2, ChevronRight, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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
    <div className="flex min-w-0 items-center gap-2 px-1.5 py-1 text-ui-sm">
      <Icon
        className={cn(
          "size-3 shrink-0",
          tone === "success" ? "text-[var(--success)]" : tone === "destructive" ? "text-destructive" : "text-muted-foreground/70",
        )}
      />
      <span className="shrink-0 font-medium text-muted-foreground">{title}</span>
      {meta && <span className="min-w-0 flex-1 truncate text-muted-foreground/65">{meta}</span>}
    </div>
  );
}

function Collapsible({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <button
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-ui-sm transition-colors hover:bg-accent/60"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Info className="size-3 shrink-0 text-muted-foreground/70" />
        <span className="shrink-0 font-medium text-muted-foreground">System</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground/65">{body}</span>
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground/50 transition-transform", open && "rotate-90")} />
      </button>
      {/* Flush with the trigger, like every other disclosure in the transcript:
          the expanded text is the same event in full, not a child of it. */}
      {open && (
        <p className="min-w-0 break-words px-1.5 py-1 text-ui-sm leading-[1.6] text-muted-foreground/80">
          {body}
        </p>
      )}
    </div>
  );
}
