import { ArrowUpRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortTime } from "@/lib/format";
import { savedSnapshot, type ProblemItem } from "@/lib/problems";
import { SaveProblem } from "../common/SaveProblem";
import { BandPill, OriginChip, ProblemMark, StandingMark, problemNote } from "./ProblemMark";

/**
 * One problem as a card.
 *
 * One destination, and exactly one control beside it. The tags stay ink rather
 * than links — the population is mixed, half of it comes from a source that has
 * never heard of Spar's concept vocabulary, and a grid where some tags open
 * something and some do not teaches the learner only to stop trusting the tags.
 * The bookmark is the exception it is worth making the card a surface for: it is
 * the one thing you can do to a problem without committing to solving it, which
 * is the whole reason a browsing grid exists.
 *
 * So the card-wide action is an overlay button underneath rather than a button
 * wrapped around everything — a control nested inside a button is neither valid
 * markup nor reachable by keyboard.
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
    <div
      aria-busy={pending || undefined}
      className={cn(
        "group relative flex h-[10.25rem] w-full flex-col overflow-hidden rounded-xl border border-border bg-card p-3.5 text-left",
        "shadow-[var(--app-shadow-card)]",
        "transition-[border-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]",
        "hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--app-shadow-sheet)]",
        "focus-within:border-[var(--border-strong)]",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        pending && "pointer-events-none",
      )}
    >
      <button
        aria-label={item.kind === "challenge" ? `Open ${item.title}` : `Start solving ${item.title}`}
        className="absolute inset-0 z-0 rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        disabled={pending}
        onClick={onOpen}
        type="button"
      />
      <div className="pointer-events-none relative z-10 flex min-w-0 items-start gap-3">
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
            {/* Top right, where a bookmark goes on anything that has a corner.
                Quiet until the card is hovered, so a grid of fifty is a grid of
                problems rather than a grid of bookmarks. */}
            <SaveProblem
              className="pointer-events-auto -mr-1 -mt-0.5"
              problemKey={item.key}
              revealOnHover
              snapshot={savedSnapshot(item)}
              title={item.title}
            />
          </div>

          <span className="mt-1.5 flex min-w-0 items-center gap-1.5">
            <OriginChip origin={item.origin} />
            <span className="min-w-0 truncate text-ui-sm tabular-nums text-muted-foreground">
              {item.displayId ?? (item.kind === "challenge" ? item.challenge.sessionTitle : "")}
            </span>
          </span>
        </div>
      </div>

      {/* Tags are ink, not controls — see the note above.

          One row that never wraps, rather than three tags that might need two.
          The card's height is fixed, so a wrapped tag row had nowhere to go: it
          pushed itself under the `mt-auto` footer and was sliced in half by the
          footer's rule — a tag reading "Variable window" cut through the middle of
          the word. Capping the count was the old defence and it did not hold,
          because two long tags wrap as readily as three short ones. Now the row is
          a fixed line and anything past it is counted. */}
      <div className="pointer-events-none relative z-10 mt-2.5 flex h-[1.375rem] min-w-0 shrink-0 items-center gap-1 overflow-hidden">
        {item.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="max-w-[9rem] shrink-0 truncate rounded-md bg-[var(--color-background-elevated-secondary)] px-1.5 py-0.5 text-ui-sm text-muted-foreground transition-colors duration-300 group-hover:bg-background/70"
          >
            {tag}
          </span>
        ))}
        {item.tags.length > 2 && (
          <span className="shrink-0 px-0.5 text-ui-sm text-muted-foreground" title={item.tags.slice(2).join(", ")}>
            +{item.tags.length - 2}
          </span>
        )}
      </div>

      <div className="pointer-events-none relative z-10 mt-auto flex min-w-0 items-center gap-2 border-t border-border/70 pt-2.5">
        <StandingMark standing={item.standing} />
        <span className="shrink-0 text-ui-sm text-muted-foreground">{STANDING_WORD[item.standing]}</span>

        {/* At rest the card reports the standing fact it has; under the pointer it
            says what clicking will do. The two never show at once, so the footer
            stays one line however long the note is — and while the click is being
            honoured only the third thing shows, hover or not. */}
        <span className="min-w-0 flex-1 truncate text-right text-ui-sm text-muted-foreground">
          {pending ? (
            <span className="inline-flex items-center justify-end gap-1 font-medium text-foreground">
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
    </div>
  );
}

const STANDING_WORD = { solved: "Solved", attempted: "In progress", todo: "New" } as const;
