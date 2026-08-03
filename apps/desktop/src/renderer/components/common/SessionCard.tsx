import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, Clock3, Sparkles, Target } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ThinkingOrb } from "thinking-orbs";
import type { ChallengeCodePreview, SessionSummary } from "@spar/domain";
import { cn } from "@/lib/utils";
import { formatDuration, relativeTime } from "@/lib/format";
import { runActivity, type AgentRun, type RunActivity } from "../agent/agentRun";
import { CodePlate } from "./CodePeek";
import { StatusDot } from "../shell/Sidebar";

const STATUS_COPY: Record<SessionSummary["status"], string> = {
  planning: "Planning",
  active: "In progress",
  paused: "Paused",
  completed: "Completed",
};

/**
 * A session as a card, laid out the way a challenge card is: what the session is
 * on the left, and the code it is currently sitting on plated against the right
 * edge. The plate is the session's newest challenge, which is the file the
 * learner would land in on opening it — so the card previews where they are
 * rather than where they started.
 *
 * `preview` is optional and is meant to be: a session that is still planning has
 * no compiled challenge and therefore no code, and a plate of placeholder lines
 * would be inventing work that does not exist yet. Those cards are simply the
 * left column, full width.
 *
 * `run` is the agent turn currently streaming for this session, if there is one.
 * A turn outlives the workspace it was started from — planning takes tens of
 * seconds and the learner is free to walk back out to the dashboard — so while
 * one is in flight the card stops describing the session and starts reporting
 * the work: what the agent is doing right now, what it just finished, and how
 * long it has been at it. Everything that would be stale during a turn (the
 * stored status, the committed focus) gives up its place to that.
 */
export function SessionCard({
  session,
  preview,
  run,
  onOpen,
}: {
  session: SessionSummary;
  preview?: ChallengeCodePreview | undefined;
  run?: AgentRun | null;
  onOpen(): void;
}) {
  const done = session.questionTitles.filter((question) => question.status === "completed").length;
  const total = session.questionTitles.length;
  const activity = runActivity(run);
  const live = activity?.state === "working";

  return (
    <button
      className={cn(
        "group relative w-full overflow-hidden rounded-xl border border-border bg-card p-3 text-left",
        /* Hover firms the edge and nothing else. Lifting the card off the page —
           a translate plus a deeper shadow — made a list of them twitch as the
           pointer crossed, and inside a scrolling drum the raised card fought the
           blur at the edges. The border is enough to say it is reachable. */
        "shadow-[var(--app-shadow-card)] transition-colors duration-150",
        "hover:border-[var(--border-strong)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        live && "border-[var(--border-strong)]",
      )}
      onClick={onOpen}
      type="button"
    >
      {/* A hairline travelling the top edge, and nothing else moving on the card
          itself. It is the one piece of chrome that can say "still going" from
          across the page without competing with the line of text that says what
          is going on — and because it rides the border it costs the layout
          nothing, so a card does not resize when a turn starts. */}
      {live && (
        <motion.span
          animate={{ x: ["-60%", "160%"] }}
          className="pointer-events-none absolute inset-x-0 top-0 h-px w-[40%] bg-gradient-to-r from-transparent via-[var(--foreground)]/45 to-transparent motion-reduce:hidden"
          transition={{ duration: 1.8, ease: "linear", repeat: Infinity }}
        />
      )}

      <div className="flex min-h-[7.5rem] items-stretch gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-content font-semibold tracking-[-0.01em]">{session.title}</span>
            {activity ? (
              <RunChip activity={activity} />
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-background-elevated-secondary)] px-1.5 py-0.5 text-ui-sm font-medium text-muted-foreground">
                <StatusDot status={session.status} />
                {STATUS_COPY[session.status]}
              </span>
            )}
            <span className="ml-auto shrink-0 text-ui-sm tabular-nums text-muted-foreground/60">
              {relativeTime(session.updatedAt)}
            </span>
          </div>

          {/* The goal drops to a single line while a turn runs. The activity line
              below is the part that is changing, and it earns its room from the
              one thing on the card that cannot have changed since last time. */}
          <p className={cn("text-ui leading-[1.55] text-muted-foreground", activity ? "line-clamp-1" : "line-clamp-2")}>
            {session.originalGoal}
          </p>

          {activity ? (
            <ActivityLine activity={activity} />
          ) : (
            <p className="flex min-w-0 items-start gap-1.5 text-ui-sm text-muted-foreground">
              <Target className="mt-[0.15em] size-3 shrink-0 text-muted-foreground/60" />
              <span className="min-w-0 flex-1 truncate">
                {session.currentFocus.join(" · ") || "Agent is investigating prior evidence"}
              </span>
            </p>
          )}

          {/* No tick row. A session of two challenges drew two fat segments that
              read as a broken progress bar rather than as a count, and the count
              is already on the line below — said in words, and correct at any
              number of challenges. */}
          <div className="mt-auto flex items-center gap-2 pt-1.5 text-ui-sm text-muted-foreground">
            <Clock3 className="size-3" />
            {/* While a turn runs, the clock reports the turn rather than the
                session: the session's own total is minutes old and does not move,
                and a stopped clock beside a live line is the card contradicting
                itself. */}
            <span className="tabular-nums">{activity ? <Elapsed since={activity.startedAt} /> : formatDuration(session.totalSeconds)}</span>
            {activity ? (
              activity.steps > 0 && (
                <span className="tabular-nums">
                  · {activity.steps} step{activity.steps === 1 ? "" : "s"}
                </span>
              )
            ) : (
              total > 0 && (
                <span className="tabular-nums">
                  · {done}/{total} challenge{total === 1 ? "" : "s"}
                </span>
              )
            )}
            {/* A compiled challenge is the thing the turn exists to produce, so it
                is said the moment it lands rather than at the end of the run. */}
            {activity?.published && (
              <span className="inline-flex items-center gap-1 text-[var(--success)]">
                <Sparkles className="size-3" />
                New challenge ready
              </span>
            )}
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1 font-medium transition-colors duration-200",
                live ? "text-foreground/70" : "text-muted-foreground/0 group-hover:text-foreground/70",
              )}
            >
              {live ? "Watch" : session.status === "completed" ? "Review" : "Resume"}
              <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>

        {preview && <CodePlate preview={preview} />}
      </div>
    </button>
  );
}

/** The status chip's place, taken over for as long as the turn owns the card. */
function RunChip({ activity }: { activity: RunActivity }) {
  if (activity.state === "failed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-destructive/10 px-1.5 py-0.5 text-ui-sm font-medium text-destructive">
        <CircleAlert className="size-3" />
        Turn failed
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-background-elevated-secondary)] px-1.5 py-0.5 text-ui-sm font-medium text-foreground">
      <ThinkingOrb aria-hidden size={20} state="working" style={{ width: 11, height: 11 }} />
      Agent working
    </span>
  );
}

/**
 * The live line. It is announced politely rather than assertively: a list of
 * cards can have several of these changing at once, and a screen reader that
 * interrupts on every tool call would make the dashboard unusable.
 */
function ActivityLine({ activity }: { activity: RunActivity }) {
  const failed = activity.state === "failed";
  return (
    <div aria-live="polite" className="flex min-w-0 items-start gap-1.5 text-ui-sm">
      {/* A dot, not a second orb: the chip above already carries the animated
          one, and two of them on a card this size read as two separate things
          happening. This one is here to hold the gutter the focus line uses. */}
      <span className="mt-[0.45em] grid size-3 shrink-0 place-items-center">
        {failed ? (
          <CircleAlert className="size-3 text-destructive/80" />
        ) : (
          <span className="size-1.5 rounded-full bg-foreground/70 animate-[agent-pulse_1.8s_ease-in-out_infinite] motion-reduce:animate-none" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        {/* Keyed on the step, not on the words: each new step crossfades in
            place, while a reply still being streamed grows in the line it is
            already in rather than restarting the animation per token. */}
        <AnimatePresence initial={false} mode="wait">
          <motion.p
            key={activity.headlineKey}
            animate={{ opacity: 1, y: 0 }}
            className={cn("min-w-0 truncate", failed ? "text-destructive/90" : "thinking-shimmer")}
            exit={{ opacity: 0, y: -3 }}
            initial={{ opacity: 0, y: 3 }}
            transition={{ duration: 0.18 }}
          >
            {activity.headline}
          </motion.p>
        </AnimatePresence>
        {/* The step behind the current one, so the line reads as a sequence the
            learner is watching rather than a label that happens to change. */}
        {activity.previous && (
          <p className="min-w-0 truncate text-muted-foreground/60">after {lowerFirst(activity.previous)}</p>
        )}
      </div>
    </div>
  );
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * Wall-clock time since the turn began, ticking every second.
 *
 * Deliberately its own component: it re-renders once a second, and the card
 * around it holds a syntax-highlighted code plate that has no business
 * re-rendering at 1Hz.
 */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [since]);
  const seconds = Math.max(0, Math.round((now - since) / 1_000));
  return <>{seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}</>;
}
