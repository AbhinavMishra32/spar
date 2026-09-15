import { useRef } from "react";
import { ArrowDownToLine, ChevronDown, ChevronUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
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
  /** Superseded by a later challenge in this session. */
  replaced: boolean;
  elapsedMs?: number | null | undefined;
  passedCases?: number | null | undefined;
  totalCases?: number | null | undefined;
  testRunCount?: number;
  assistance?: "independent" | "assisted" | "unknown" | undefined;
  outcome?: "passed" | "failed" | "abandoned" | "replaced" | null;
};

export type ChallengeTrail = {
  /** Every challenge of the session, in the order they were set. */
  stops: ChallengeStop[];
  onGo(stop: ChallengeStop): void;
  onOpenQuestion?(stop: ChallengeStop): void;
  onOpenSession?(stop: ChallengeStop): void;
  onAsk?(stop: ChallengeStop): void;
};

/* Up and down, not left and right. A session is a column you scroll: back goes up
   to the challenge you did before, forward goes down to the next one, and the
   number between them rolls the same way. Sideways chevrons said "previous page",
   which is a different gesture and set the wrong expectation for the motion. */
function Step({ label, onGo, stop }: { label: string; onGo(stop: ChallengeStop): void; stop: ChallengeStop | undefined }) {
  const Glyph = label === "Previous" ? ChevronUp : ChevronDown;
  return (
    <button
      /* Solid foreground, and a 24px target rather than 20px. These were
         `text-muted-foreground` at size-5 with a size-3.5 glyph, which on a glass
         toolbar is a grey hairline on a grey wash — the control read as decoration
         and was hard to hit. Muted is for text that outranks nothing; this is the
         only way through the session. */
      className="grid size-6 shrink-0 place-items-center rounded-md text-foreground transition-[background-color,transform] duration-150 hover:bg-accent active:scale-90 disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-40"
      disabled={!stop}
      onClick={stop ? () => onGo(stop) : undefined}
      /* The neighbour is named rather than numbered. Stepping through a session
         is looking for a particular problem, and "Challenge 6" is not what
         anybody remembers about it. */
      title={stop ? `${label}: ${stop.title}` : `No ${label.toLowerCase()} challenge`}
      type="button"
    >
      <Glyph className="size-4" />
      <span className="sr-only">{label} challenge</span>
    </button>
  );
}

/* The ordinal rolls in the direction you travelled, so the motion confirms which
   way the press went — pressing up brings the new number down from above, pressing
   down brings it up from below. Only the digit moves: "of 7" is fixed for the whole
   session and a total that slid around would read as though it had changed too.
   `overflow-hidden` on a box sized to the line is what makes it a roll rather than
   a fade — the outgoing digit has to leave through an edge. */
function RollingOrdinal({ ordinal }: { ordinal: number }) {
  const previous = useRef(ordinal);
  const direction = ordinal >= previous.current ? 1 : -1;
  previous.current = ordinal;

  return (
    <span className="relative inline-grid h-[1.375rem] min-w-[1ch] place-items-center overflow-hidden tabular-nums">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={ordinal}
          animate={{ y: 0, opacity: 1 }}
          className="col-start-1 row-start-1"
          exit={{ y: direction * -14, opacity: 0 }}
          initial={{ y: direction * 14, opacity: 0 }}
          transition={{ y: { type: "spring", visualDuration: 0.26, bounce: 0 }, opacity: { duration: 0.14 } }}
        >
          {ordinal}
        </motion.span>
      </AnimatePresence>
    </span>
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
  /* The way home. Stepping back is cheap — one press per challenge — but stepping
     *home* was not: from challenge 2 of 13 the way back to the end of the session
     was eleven presses of the same arrow. The end of the session is a destination
     rather than a direction, so it gets its own control instead of eleven presses
     of one.

     Home is the open challenge while there is one, and otherwise the session's
     last challenge — a finished session, which is most of what you can wander
     into from history, has no open challenge but still has a place you left off.
     One control either way; only the wording changes, because "current" would be
     a lie about a session that has none. Hidden when home is where you already
     are, which is the case the last stop of a finished session kept hitting. */
  const live = trail.stops.find((stop) => stop.live);
  const home = live ?? trail.stops[trail.stops.length - 1];

  return (
    /* Never the part that gives way. "Challenge 3 of 7" truncating to "Challenge …"
       costs the one number the row exists to show, so this stays `shrink-0` even
       now that the session name it used to sit beside is gone from the toolbar. */
    <motion.span className={cn("app-no-drag flex shrink-0 items-center gap-1", className)} layout>
      <Step label="Previous" onGo={trail.onGo} stop={trail.stops[index - 1]} />
      <motion.span className="flex items-center whitespace-nowrap text-source font-medium" layout="position">
        Challenge&nbsp;
        <RollingOrdinal ordinal={current.ordinal} />
        <span className="font-normal text-muted-foreground">&nbsp;of {trail.stops.length}</span>
      </motion.span>
      <Step label="Next" onGo={trail.onGo} stop={trail.stops[index + 1]} />
      {/* Crossing into a practice challenge grows the row by a whole chip, and it
          used to do that between two frames — the label and both arrows jumped
          left to make room. Now the chip scales up from the edge it will occupy
          while its neighbours slide, so the row changes width the way a native
          toolbar does.

          `layout="position"` on the label, not plain `layout`: a layout animation
          that is allowed to interpolate width scales the text inside it, and
          scaled glyphs re-rasterise every frame. Position-only keeps the type at
          one size throughout, which is what actually removes the flicker.

          No blur on the way in or out, deliberately. A filter puts this subtree on
          its own composited layer for the duration, and text crossing that
          boundary is exactly the soft, mis-spaced rendering this app has been
          chasing elsewhere. Opacity and scale are enough. */}
      <AnimatePresence initial={false} mode="popLayout">
        {!current.live && (
          <motion.span
            key="practice"
            animate={{ opacity: 1, scale: 1 }}
            className="flex shrink-0 origin-left items-center gap-1"
            exit={{ opacity: 0, scale: 0.9 }}
            initial={{ opacity: 0, scale: 0.9 }}
            transition={{
              scale: { type: "spring", visualDuration: 0.3, bounce: 0 },
              opacity: { duration: 0.16, ease: [0.22, 0.61, 0.36, 1] },
            }}
          >
            {/* The one thing the learner has to know on this surface, said where
                they cannot miss it: this is rehearsal. */}
            <span className="rounded-full bg-[var(--color-background-elevated-secondary)] px-1.5 text-ui-sm text-muted-foreground">
              Practice · not recorded
            </span>
            {/* And the way out of it, next to the sentence that explains why you
                would want one. The chip states the cost of staying here; the
                button is the answer to it, so they travel together.

                "Current" rather than "live": live is our word for it, and the
                learner's word for the challenge they were working on before they
                wandered off is the current one. The arrow points down and lands
                on a line — home is always the last stop, so this is the same
                downward journey the Next arrow makes, taken in one press.

                Sized as a button, not as a label with an icon glued to it: 24px
                tall to match the arrows either side, 12px type rather than the
                chip's 11, and its own fill. At the chip's weight it read as a
                second piece of status text that happened to be clickable.

                It lands in the session, never on another practice page. That is
                the whole point of the press: the sandbox is a problem statement
                with nothing around it, and what you left behind was the problem
                *and* the conversation about it. `onGo` already does this for the
                live stop; a finished session has no live stop to route through,
                so it takes `onOpenSession` to the same place. Falling back to
                `onGo` only matters for a caller that omits the optional handler —
                that lands on the challenge, which is worse but not nowhere. */}
            {home && home.id !== current.id && (
              <button
                className="flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--color-background-elevated-secondary)] px-2.5 text-ui font-medium text-foreground transition-[background-color,transform] duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95"
                onClick={() => (live || !trail.onOpenSession ? trail.onGo(home) : trail.onOpenSession(home))}
                title={live
                  ? `Back to the current challenge: ${home.title}`
                  : `Back to the session — ${home.title} and the conversation about it`}
                type="button"
              >
                <ArrowDownToLine className="size-3.5" />
                {live ? "Back to current" : "Back to latest"}
              </button>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.span>
  );
}
