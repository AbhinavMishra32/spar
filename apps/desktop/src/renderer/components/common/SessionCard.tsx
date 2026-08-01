import { ArrowRight, Clock3, Target } from "lucide-react";
import type { SessionSummary } from "@spar/domain";
import { cn } from "@/lib/utils";
import { formatDuration, relativeTime } from "@/lib/format";
import { StatusDot } from "../shell/Sidebar";

const STATUS_COPY: Record<SessionSummary["status"], string> = {
  planning: "Planning",
  active: "In progress",
  paused: "Paused",
  completed: "Completed",
};

export function SessionCard({ session, onOpen }: { session: SessionSummary; onOpen(): void }) {
  const done = session.questionTitles.filter((question) => question.status === "completed").length;
  const total = session.questionTitles.length;

  return (
    <button
      className="group/card flex w-full flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5 text-left shadow-[var(--app-shadow-card)] transition-all hover:border-[var(--border-strong)] hover:bg-[var(--color-background-elevated-secondary)]"
      onClick={onOpen}
      type="button"
    >
      <div className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
        <StatusDot status={session.status} />
        <span className="font-medium text-foreground/70">{STATUS_COPY[session.status]}</span>
        <span className="ml-auto tabular-nums">{relativeTime(session.updatedAt)}</span>
      </div>

      <div className="min-w-0">
        <p className="truncate text-content font-semibold tracking-tight">{session.title}</p>
        <p className="mt-0.5 line-clamp-2 text-ui leading-[1.55] text-muted-foreground">{session.originalGoal}</p>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-[var(--color-background-elevated-secondary)] px-2 py-1.5">
        <Target className="mt-px size-3 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-ui-sm leading-[1.5] text-muted-foreground">
          {session.currentFocus.join(" · ") || "Agent is investigating prior evidence"}
        </p>
      </div>

      {total > 0 && (
        <div className="flex items-center gap-1.5" title={`${done} of ${total} challenges completed`}>
          {session.questionTitles.map((question) => (
            <span
              key={question.id}
              className={cn(
                "h-1 flex-1 rounded-full",
                question.status === "completed"
                  ? "bg-foreground/70"
                  : question.status === "active" || question.status === "playable"
                    ? "bg-foreground/28"
                    : "bg-foreground/10",
              )}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border/70 pt-2 text-ui-sm text-muted-foreground">
        <Clock3 className="size-3" />
        <span className="tabular-nums">{formatDuration(session.totalSeconds)}</span>
        {total > 0 && <span className="tabular-nums">· {done}/{total} challenges</span>}
        <span className="ml-auto inline-flex items-center gap-1 font-medium text-foreground/80">
          {session.status === "completed" ? "Review" : "Resume"}
          <ArrowRight className="size-3 transition-transform group-hover/card:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}
