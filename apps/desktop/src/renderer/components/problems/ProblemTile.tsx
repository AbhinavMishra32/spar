import { ArrowUpRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortTime } from "@/lib/format";
import type { ProblemItem } from "@/lib/problems";
import { BandPill, OriginChip, ProblemMark, StandingMark, problemNote } from "./ProblemMark";

/**
 * One problem as a card.
 *
 * The whole tile is a single button rather than a surface with controls on it.
 * That is a deliberate step away from the challenge history card, which has to
 * carry openable concept chips: here the population is mixed, half of it comes
 * from a source that has never heard of Spar's concept vocabulary, and a grid
 * where some tags are links and some are decoration would teach the learner
 * nothing except to stop trusting the tags. One target, one destination.
 *
 * Height is fixed rather than fitted. A grid of cards that each end where their
 * content does is a ragged wall, and the ragged edge is the first thing the eye
 * reads — before any of the titles.
 *
 * Hover firms the edge and lifts the card a hair, and that is the whole of it.
 * Coloured washes, a sheen crossing the face and a halo under the mark were all
 * tried here: each one reads as a reward for looking rather than as a surface you
 * can click, and fifty of them together stop being a list of problems.
 */
export function ProblemTile({
  item,
  onOpen,
  pending = false,
}: {
  item: ProblemItem;
  onOpen(): void;
  /** This problem is being opened. Only ever one at a time — starting a source
   *  problem creates a session, so a second click would create a second one. */
  pending?: boolean;
}) {
  const note = problemNote(item);

  return (
    <button
      aria-busy={pending || undefined}
      className={cn(
        "group relative flex h-[10.25rem] w-full flex-col overflow-hidden rounded-xl border border-border bg-card p-3.5 text-left",
        "shadow-[var(--app-shadow-card)] outline-none",
        "transition-[border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]",
        "hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--app-shadow-sheet)]",
        "focus-visible:border-[var(--border-strong)] focus-visible:ring-1 focus-visible:ring-ring",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        pending && "pointer-events-none",
      )}
      disabled={pending}
      onClick={onOpen}
      type="button"
    >
      <div className="flex min-w-0 items-start gap-3">
        <ProblemMark
          className="mt-px transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          item={item}
          size={40}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-start gap-2">
            {/* Two lines and then an ellipsis. A problem title is the one thing on
                the card that cannot be abbreviated without becoming a different
                problem, so it gets the room, and the band pill holds its own
                column rather than being pushed off the end by a long one. */}
            <span className="line-clamp-2 min-w-0 flex-1 text-content font-semibold leading-[1.3] tracking-[-0.01em]">
              {item.title}
            </span>
            <BandPill band={item.band} className="mt-px" />
          </div>

          <span className="mt-1.5 flex min-w-0 items-center gap-1.5">
            <OriginChip origin={item.origin} />
            <span className="min-w-0 truncate text-ui-sm tabular-nums text-muted-foreground/70">
              {item.displayId ?? (item.kind === "challenge" ? item.challenge.sessionTitle : "")}
            </span>
          </span>
        </div>
      </div>

      {/* Tags are ink, not controls — see the note above. Capped at three because
          a fourth wraps the row, and a wrapped tag row is what makes a fixed-height
          card start clipping its own footer. */}
      <div className="relative mt-2.5 flex min-w-0 flex-wrap gap-1 overflow-hidden">
        {item.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="max-w-[9rem] truncate rounded-md bg-[var(--color-background-elevated-secondary)] px-1.5 py-0.5 text-ui-sm text-muted-foreground transition-colors duration-300 group-hover:bg-background/70"
          >
            {tag}
          </span>
        ))}
        {item.tags.length > 3 && (
          <span className="px-0.5 py-0.5 text-ui-sm text-muted-foreground/70" title={item.tags.slice(3).join(", ")}>
            +{item.tags.length - 3}
          </span>
        )}
      </div>

      <div className="relative mt-auto flex min-w-0 items-center gap-2 border-t border-border/70 pt-2.5">
        <StandingMark standing={item.standing} />
        <span className="shrink-0 text-ui-sm text-muted-foreground/80">{STANDING_WORD[item.standing]}</span>

        {/* At rest the card reports the standing fact it has; under the pointer it
            says what clicking will do. The two never show at once, so the footer
            stays one line however long the note is — and while the click is being
            honoured only the third thing shows, hover or not. */}
        <span className="min-w-0 flex-1 truncate text-right text-ui-sm text-muted-foreground/70">
          {pending ? (
            <span className="inline-flex items-center justify-end gap-1 font-medium text-foreground/80">
              <Loader2 className="size-3 animate-spin" />
              Opening…
            </span>
          ) : (
            <>
              <span className="group-hover:hidden">
                {note ?? (item.kind === "challenge" ? shortTime(item.challenge.updatedAt) : "")}
              </span>
              <span className="hidden items-center justify-end gap-1 font-medium text-foreground group-hover:inline-flex">
                {item.kind === "challenge" ? "Open" : "Start solving"}
                <ArrowUpRight className="size-3 transition-transform duration-300 group-hover:translate-x-px group-hover:-translate-y-px motion-reduce:transition-none" />
              </span>
            </>
          )}
        </span>
      </div>
    </button>
  );
}

const STANDING_WORD = { solved: "Solved", attempted: "In progress", todo: "New" } as const;
