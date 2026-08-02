import type { SessionSummary } from "@spar/domain";
import { cn } from "@/lib/utils";
import { relativeTime, shortTime } from "@/lib/format";
import { challengeBands } from "@/lib/progress";
import { Meter } from "@/components/ui/meter";
import { StatusDot } from "../shell/Sidebar";

const STATUS_COPY: Record<SessionSummary["status"], string> = {
  planning: "Planning",
  active: "In progress",
  paused: "Paused",
  completed: "Completed",
};

/**
 * A session as one row rather than one card.
 *
 * The card said the same thing five ways — a status word beside its own dot, a
 * goal above the focus the agent derived from it, a progress strip beside the
 * fraction it encodes — and six of them tiled into a wall of boxes. A row keeps
 * the four things you actually resume on: which session, what it is chewing on,
 * how far it has got, and how stale it is. Everything the card said out loud
 * moves into the tooltip, where it costs nothing until it is wanted.
 *
 * No rules between rows and no border around them. The left edge and the weight
 * step between the two lines already group each pair; a divider would be a third
 * device doing the same job.
 */
export function SessionRow({ session, onOpen }: { session: SessionSummary; onOpen(): void }) {
  const total = session.questionTitles.length;
  const done = session.questionTitles.filter((question) => question.status === "completed").length;
  // The focus is what you would be picking back up; the goal is only the best
  // available stand-in before the agent has settled on one.
  const focus = session.currentFocus.join(" · ") || session.originalGoal;

  return (
    <button
      className={cn(
        // Padding wider than the text it holds, cancelled by the list's negative
        // margin: the row's words stay on the page's left edge while its hover
        // fill reaches past them. A highlight flush with the text reads as a
        // selected label rather than as a row.
        "flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2 text-left",
        "outline-none transition-colors duration-100",
        "hover:bg-[var(--color-background-elevated-secondary)]",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
      )}
      onClick={onOpen}
      title={[
        session.title,
        STATUS_COPY[session.status],
        total ? `${done}/${total} challenges evaluated` : "No challenges yet",
        `updated ${relativeTime(session.updatedAt)}`,
      ].join(" · ")}
      type="button"
    >
      <StatusDot status={session.status} />

      {/* Spans, not paragraphs: a button may only hold phrasing content, and a
          <p> in here is invalid markup that assistive tech reads unpredictably. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-content font-medium leading-5 tracking-[-0.01em]">{session.title}</span>
        <span className="mt-0.5 block truncate text-ui leading-[1.35] text-muted-foreground">{focus}</span>
      </span>

      {/* The slot is reserved whether or not it has a bar to hold, so a session
          still in planning does not knock the timestamps out of their column. */}
      <span className="w-14 shrink-0">
        {total > 0 && (
          <Meter animate={false} bands={challengeBands(session.questionTitles)} className="w-full" height="0.1875rem" />
        )}
      </span>

      {/* Wide enough for the longest thing shortTime can return — a "Dec 24" —
          so the column holds its right edge instead of nudging the bar beside it. */}
      <span className="w-10 shrink-0 text-right text-ui tabular-nums text-muted-foreground/70">
        {shortTime(session.updatedAt)}
      </span>
    </button>
  );
}
