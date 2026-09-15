import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * How long the turn took, the way a person says it.
 *
 * Seconds up to a minute, then minutes and seconds, then hours — never
 * milliseconds, and never a decimal. The number is here to tell the learner
 * whether the agent has been working for four seconds or four minutes, and a
 * figure like "4.28s" answers that question no better while reading worse.
 */
export function workedFor(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1_000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Under this, a finished turn shows no fold at all: a header saying a turn took
 *  no time is a line to read about nothing having happened. */
const WORTH_FOLDING_MS = 1_000;

/** Above this the number is information — it is the difference between a turn
 *  you waited through and one you did not. Below it, it is a stopwatch on a
 *  conversation. Half a minute is where a wait starts being one: under it the
 *  learner never left the screen, and nothing about the figure is news to them. */
const A_MOMENT_MS = 30_000;

/**
 * What a short turn took, in things rather than seconds.
 *
 * "Worked for 5s" is a figure nobody has a use for. Nothing in the app is
 * decided by it, the learner was watching the whole time, and a number under a
 * reply is the transcript reporting on itself. Said in a unit they have their
 * own feel for it becomes what it always was — an aside, and a small joke
 * between two people who both know it was quick.
 *
 * The line varies per turn so a page of quick answers is not a page of the same
 * sentence, and it is chosen from the turn's own timings rather than at random,
 * so a turn says the same thing every time it is drawn. Scrolling back through a
 * session whose jokes rewrote themselves under you would be a transcript you
 * cannot trust about anything else either.
 */
const A_MOMENT = [
  "about one variable name",
  "less than a git status",
  "one sip of coffee",
  "about two blinks",
  "less than a tab switch",
  "one stretch of the fingers",
  "shorter than a rename",
  "half a stack trace",
  "one glance at the docs",
  "less than a compile",
  "about one deep breath",
  "a keystroke or two",
] as const;

export function aMoment(seed: number): string {
  /* Whole milliseconds, mixed so that turns a few ms apart do not land on the
     same phrase — the low digits are the ones that actually vary. */
  const whole = Math.abs(Math.trunc(seed));
  const mixed = (whole ^ (whole >>> 3) ^ (whole >>> 7)) >>> 0;
  return A_MOMENT[mixed % A_MOMENT.length]!;
}

/**
 * The turn's work, folded into one line.
 *
 * A Spar turn is twenty-one phases, and every one of them draws its rows. That
 * is the right thing to watch while it runs and the wrong thing to scroll past
 * afterwards — the transcript became a wall of tool calls with the actual reply
 * somewhere inside it, and re-reading a conversation meant hunting for the
 * sentences between the work.
 *
 * So the work opens itself while it is happening and folds itself away the
 * moment the agent starts answering, which is the point at which what it did
 * stops being the thing you are waiting for. Clicking either way overrides it
 * and the choice sticks: a learner who opened a turn to read its steps does not
 * want it closing under them when the next phase starts.
 *
 * The clock ticks once a second while the work is live, so a long phase reads as
 * a turn that is still going rather than one that has hung.
 */
export function RunFold({
  live,
  startedAt,
  finalStartedAt,
  workedMs,
  onOpen,
  bodyLoaded = true,
  children,
}: {
  /** Whether this turn is still running. */
  live: boolean;
  /** When it began, for a live turn. Absent for one read back from storage,
   *  which carries its own total instead. */
  startedAt?: number | undefined;
  /** When the agent began its reply — the end of the work, before the end of
   *  the turn. This is what closes the fold. */
  finalStartedAt?: number | undefined;
  /** The finished turn's total. Zero means it was never recorded, which is true
   *  of every turn from before it was: those still fold, they just cannot say
   *  how long they took. */
  workedMs?: number | undefined;
  /** Fetches the body the first time the fold is opened. Older turns keep their
   *  steps on disk rather than in memory, and this is what goes and gets them —
   *  which is only worth doing for a fold somebody actually opened. */
  onOpen?: (() => void | Promise<void>) | undefined;
  /** Whether the body is here yet. False means `onOpen` has not run, or is running. */
  bodyLoaded?: boolean;
  children: React.ReactNode;
}) {
  const [override, setOverride] = useState<boolean | undefined>();
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const working = live && finalStartedAt === undefined;

  const load = async () => {
    if (!onOpen || bodyLoaded || loading) return;
    setLoading(true);
    setFailed(false);
    try { await onOpen(); } catch { setFailed(true); } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [working]);

  /* A live turn is measured from its start; a settled one carries its total.
     The end of the work is the reply's first token where there is one, and the
     end of the turn otherwise. */
  const elapsed = startedAt === undefined
    ? workedMs
    : Math.max(0, (finalStartedAt ?? (live ? now : startedAt + (workedMs ?? 0))) - startedAt);
  const open = override ?? working;
  /* Unknown durations still fold — that is every turn recorded before this
     existed, and burying their steps would be a worse trade than a fold that
     cannot name its length. */
  const known = elapsed !== undefined && elapsed > 0;
  const worthFolding = live || !known || elapsed >= WORTH_FOLDING_MS;
  /* A settled turn says how long it took the way a person would: in seconds
     when the wait was long enough to have been a wait, and in a comparison when
     it was not. The exact figure stays in the title for the one reader in a
     hundred who wants it. */
  const length = !known
    ? "a moment"
    : elapsed < A_MOMENT_MS
      ? aMoment((startedAt ?? 0) + elapsed)
      : workedFor(elapsed);

  if (!worthFolding) return <div className="min-w-0">{children}</div>;

  return (
    <div className="min-w-0">
      <button
        aria-expanded={open}
        className="group/fold -mx-1 flex min-h-6 w-[calc(100%+0.5rem)] items-center gap-1 border-b border-border/40 px-1 pb-2 text-thread text-muted-foreground transition-colors select-none hover:text-foreground"
        onClick={() => { if (!open) void load(); setOverride(!open); }}
        title={known && !working ? `${workedFor(elapsed)} of work — click to ${open ? "hide" : "see"} the steps` : undefined}
        type="button"
      >
        {/* The turn landing, said once. While it runs this line shimmers and
            counts; the moment the agent starts answering it stops being a clock
            and becomes a record, and swapping the words in place made the most
            significant change of state in a turn the least visible thing on
            screen. The past tense rises into the present tense's place and the
            shimmer goes with it, which is the only mark the end of the work
            gets — and the only one it needs, because the answer is arriving
            underneath it at the same moment.

            Keyed on the tense rather than on the text, so the clock's own ticks
            pass through without animating: a number that jumped every second
            would be a spinner. */}
        <span className="relative min-w-0 truncate">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              animate={{ y: 0, opacity: 1 }}
              className={cn("inline-block min-w-0 truncate", working && "thinking-shimmer")}
              exit={reduced ? { opacity: 0 } : { y: -10, opacity: 0 }}
              initial={reduced ? false : { y: 10, opacity: 0 }}
              key={working ? "working" : "worked"}
              transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: 0.4, bounce: 0.18 }}
            >
              {working ? `Working for ${known ? workedFor(elapsed) : ""}` : `Worked for ${length}`}
            </motion.span>
          </AnimatePresence>
        </span>
        <motion.span
          aria-hidden
          className="inline-flex shrink-0"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ type: "spring", visualDuration: reduced ? 0 : 0.34, bounce: 0.2 }}
        ><ChevronRight className="size-3.5" /></motion.span>
      </button>
      {/* Animate to auto so the open fold continues to grow with streamed rows. */}
      <motion.div
        className="overflow-hidden"
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        /* Folding is the turn putting its working away, and it is watched more
           often than it is asked for — it happens by itself the moment the reply
           starts. So the close is unhurried enough to read as the steps being
           filed rather than deleted, and the contents fade out ahead of the
           height so nothing is legible while it is being squashed. */
        transition={reduced ? { duration: 0 } : {
          height: open
            ? { type: "spring", visualDuration: 0.46, bounce: 0.05 }
            : { type: "tween", duration: 0.36, ease: [0.32, 0.72, 0, 1] },
          opacity: open ? { duration: 0.3, delay: 0.04 } : { duration: 0.16 },
        }}
      >
        {/* React 19 takes `inert` as a boolean. A closed fold is zero pixels
            tall but still in the document, and without this its buttons stay
            tabbable — the learner would tab into steps they cannot see. */}
        <div className="min-w-0 overflow-hidden pt-2" inert={!open}>
          {!bodyLoaded && loading && <p className="py-1 text-thread text-muted-foreground" role="status">Loading the steps…</p>}
          {!bodyLoaded && failed && (
            <button className="py-1 text-thread text-muted-foreground transition-colors hover:text-foreground" onClick={() => void load()} type="button">
              Those steps could not be loaded. Try again
            </button>
          )}
          {children}
        </div>
      </motion.div>
    </div>
  );
}
