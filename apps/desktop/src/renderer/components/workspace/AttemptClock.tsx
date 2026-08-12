import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { duration } from "../../../shared/attemptReplay";

/**
 * How long this attempt has been open, running while it is.
 *
 * The clock is here because the same number is evidence: every offset in a solve
 * replay is measured from this zero, so the learner is looking at the axis their
 * own attempt gets read on rather than at a stopwatch bolted onto the toolbar.
 * It stops the moment the attempt is graded — work after that is still recorded,
 * but it is no longer being timed against anything.
 */
export function AttemptClock({ startedAt, completedAt }: { startedAt: string; completedAt: string | null }) {
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (end !== null) return;
    // A minute-resolution label only needs a few ticks a minute; seconds of drift
    // on a 40-minute attempt are not worth a 1s interval on the render path.
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [end]);

  if (!Number.isFinite(start)) return null;
  const elapsed = Math.max(0, (end ?? now) - start);
  const running = end === null;

  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-ui-sm tabular-nums",
        running ? "text-muted-foreground" : "text-muted-foreground/60",
      )}
      title={running ? "Time on this attempt — every moment in your solve replay is measured from here" : "Time this attempt took"}
    >
      <Clock3 className="size-3.5" aria-hidden="true" />
      {duration(elapsed)}
    </span>
  );
}
