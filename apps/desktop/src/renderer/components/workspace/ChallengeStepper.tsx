import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Stepping back through the challenges of one session.
 *
 * A session is a run of challenges and, until now, only its last one was
 * reachable: everything before it had been solved and put away, and the only way
 * back was the global history list, which is a list of every challenge in the
 * app rather than the seven you did this afternoon. The stepper puts the session
 * back in the shape it actually has.
 *
 * Stepping backwards leaves the session. What opens is the practice sandbox for
 * that challenge — no attempt, no events, no agent turn, nothing written to the
 * learner's evidence. That is the whole reason this is safe to offer: the only
 * submission that ever counts is the one on the live challenge, and rehearsing
 * an old one cannot change what Spar thinks you can do. The chip says so, on the
 * toolbar, for as long as you are on one.
 */

export type ChallengeStop = {
  id: string;
  ordinal: number;
  title: string;
  /** The session's open challenge — the one where work still counts. */
  live: boolean;
};

export type ChallengeTrail = {
  /** Every challenge of the session, in the order they were set. */
  stops: ChallengeStop[];
  onGo(stop: ChallengeStop): void;
};

function Step({ label, onGo, stop }: { label: string; onGo(stop: ChallengeStop): void; stop: ChallengeStop | undefined }) {
  const Glyph = label === "Previous" ? ChevronLeft : ChevronRight;
  return (
    <button
      className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      disabled={!stop}
      onClick={stop ? () => onGo(stop) : undefined}
      /* The neighbour is named rather than numbered. Stepping through a session
         is looking for a particular problem, and "Challenge 6" is not what
         anybody remembers about it. */
      title={stop ? `${label}: ${stop.title}` : `No ${label.toLowerCase()} challenge`}
      type="button"
    >
      <Glyph className="size-3.5" />
      <span className="sr-only">{label} challenge</span>
    </button>
  );
}

export function ChallengeStepper({ className, currentId, trail }: {
  className?: string;
  currentId: string;
  trail: ChallengeTrail;
}) {
  const index = trail.stops.findIndex((stop) => stop.id === currentId);
  if (index < 0) return null;
  const current = trail.stops[index]!;

  return (
    /* Never the part that gives way. The toolbar's subtitle is the session's
       name and can truncate to nothing; "Challenge 3 of 7" truncating to
       "Challenge …" costs the one number the row exists to show. */
    <span className={cn("app-no-drag flex shrink-0 items-center gap-1", className)}>
      <Step label="Previous" onGo={trail.onGo} stop={trail.stops[index - 1]} />
      <span className="whitespace-nowrap text-source font-medium">
        Challenge {current.ordinal}
        <span className="font-normal text-muted-foreground/70"> of {trail.stops.length}</span>
      </span>
      <Step label="Next" onGo={trail.onGo} stop={trail.stops[index + 1]} />
      {!current.live && (
        /* The one thing the learner has to know on this surface, said where they
           cannot miss it: this is rehearsal. */
        <span className="shrink-0 rounded-full bg-[var(--color-background-elevated-secondary)] px-1.5 text-ui-sm text-muted-foreground">
          Practice · not recorded
        </span>
      )}
    </span>
  );
}
