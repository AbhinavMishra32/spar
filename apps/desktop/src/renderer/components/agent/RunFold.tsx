import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
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

  if (!worthFolding) return <div className="min-w-0">{children}</div>;

  return (
    <div className="min-w-0">
      <button
        aria-expanded={open}
        className="group/fold -mx-1 flex min-h-6 items-center gap-1 px-1 text-ui text-muted-foreground transition-colors select-none hover:text-foreground"
        onClick={() => { if (!open) void load(); setOverride(!open); }}
        type="button"
      >
        <span className={cn("min-w-0 truncate", working && "thinking-shimmer")}>
          {working ? "Working for" : "Worked for"} {known ? workedFor(elapsed) : "a moment"}
        </span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 transition-transform duration-200 group-aria-expanded/fold:rotate-90" />
      </button>
      {/* A rows-to-`1fr` grid rather than a measured height: the work inside is
          still streaming and changing height as it goes, and a pixel figure
          captured when the fold opened would clip whatever arrived after it. */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        {/* React 19 takes `inert` as a boolean. A closed fold is zero pixels
            tall but still in the document, and without this its buttons stay
            tabbable — the learner would tab into steps they cannot see. */}
        <div className={cn("min-w-0 overflow-hidden", open ? "pt-1" : undefined)} inert={!open}>
          {!bodyLoaded && loading && <p className="py-1 text-ui text-muted-foreground" role="status">Loading the steps…</p>}
          {!bodyLoaded && failed && (
            <button className="py-1 text-ui text-muted-foreground transition-colors hover:text-foreground" onClick={() => void load()} type="button">
              Those steps could not be loaded. Try again
            </button>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
