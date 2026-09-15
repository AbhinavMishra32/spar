import { ArrowUpRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { savedSnapshot, type ProblemItem } from "@/lib/problems";
import { SaveProblem } from "../common/SaveProblem";
import { BandPill, OriginChip, ProblemMark, STANDING_LABEL, StandingMark, problemNote } from "./ProblemMark";

/**
 * One problem as a row.
 *
 * The list is the view you take when you are scanning rather than browsing, so
 * everything here is a column: standing, title, origin, band, note. Columns are
 * what make a list scannable at all — the eye reads down one of them rather than
 * across all of them — which is why the metadata is right-aligned at fixed widths
 * and the title is the only thing allowed to take the space that is left.
 *
 * Same targets and same tones as `ProblemTile`, because these are two views of one
 * list rather than two lists.
 *
 * A div with the row-wide action as an overlay button underneath, rather than one
 * big button — the same arrangement the history cards use, and for the same
 * reason: the bookmark is a control of its own, and a control nested inside a
 * button is neither valid markup nor reachable by keyboard.
 */
export function ProblemRow({
  item,
  onOpen,
  pending = false,
}: {
  item: ProblemItem;
  onOpen(): void;
  pending?: boolean;
}) {
  const note = problemNote(item);

  return (
    <div
      aria-busy={pending || undefined}
      className={cn(
        /* Full-bleed and ruled, rather than a floating rounded pill per row. A
           list of eighty is read down, and a row whose fill stops short of the
           column edge gives the eye two ragged verticals to ignore before it can
           find the one that matters. The rule is what actually separates rows —
           hover can only mark the one you are on, and without a rule the rest of
           the list was text floating on a white field. */
        "group relative flex h-[3.25rem] w-full items-center gap-3 px-3 text-left",
        "border-b border-border/60 last:border-b-0",
        "transition-colors duration-100 hover:bg-[var(--color-background-elevated-secondary)]",
        "focus-within:bg-[var(--color-background-elevated-secondary)]",
        pending && "pointer-events-none",
      )}
    >
      <button
        aria-label={item.kind === "challenge" ? `Open ${item.title}` : `Start solving ${item.title}`}
        className="absolute inset-0 z-0 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        disabled={pending}
        onClick={onOpen}
        type="button"
      />
      {/* The content layer passes its clicks through to the overlay; only the
          bookmark takes its own. */}
      <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-3">
        <span className="flex shrink-0" title={STANDING_LABEL[item.standing]}>
          <StandingMark standing={item.standing} />
        </span>
        <ProblemMark item={item} size={24} />

        <span className="min-w-0 flex-1 truncate text-content font-medium tracking-[-0.01em]">{item.title}</span>

        {/* Tags as text, not as pills. Four pill shapes in one row — two tags, the
            origin and the band — is four boxes competing to be the thing you notice,
            and the band is the only one of them carrying colour and therefore the
            only one that earns a fill. Below a narrow pane these go first: they are
            the one column that repeats what the concept filter above already says. */}
        <span className="hidden min-w-0 max-w-[15rem] shrink-0 truncate text-right text-ui-sm text-muted-foreground xl:block">
          {item.tags.slice(0, 2).join(" · ")}
        </span>

        {/* Where it came from, as one column rather than two. The chip and the line
            beside it were separate — "Spar" at one width, then the session it was
            written for at another — which spent two of the row's five right-hand
            columns saying one thing. Together they read as a single fact: this is
            Spar's, from this session; this is LeetCode's, and it is number 1234. */}
        <span className="hidden w-[15rem] shrink-0 items-center justify-end gap-2 lg:flex">
          <span className="min-w-0 truncate text-right text-ui-sm text-muted-foreground">
            {item.displayId ?? (item.kind === "challenge" ? item.challenge.sessionTitle : "")}
          </span>
          <OriginChip bare origin={item.origin} />
        </span>

        <span className="w-[4.5rem] shrink-0 text-right">
          <BandPill band={item.band} />
        </span>

        {/* The last column is the note until the pointer arrives, then the action —
            the same trade the tile makes, at the same width so the rows never jump.
            Lining figures, because this column is a column of counts: proportional
            digits put the "·" in a different place on every row and the eye cannot
            read down them. */}
        <span className="hidden w-[8rem] shrink-0 truncate text-right text-ui-sm tabular-nums text-muted-foreground sm:block">
          {pending ? (
            <span className="inline-flex items-center justify-end gap-1 font-medium text-foreground">
              <Loader2 className="size-3 animate-spin" />
              Opening…
            </span>
          ) : (
            <>
              <span className="group-hover:hidden">{note}</span>
              <span className="hidden items-center justify-end gap-1 font-medium text-foreground group-hover:inline-flex">
                <ArrowUpRight className="size-3" />
                {item.kind === "challenge" ? "Open" : "Start solving"}
              </span>
            </>
          )}
        </span>
      </span>

      {/* Last in the row and quiet until the pointer arrives — see
          `SaveProblem`. A saved one stays lit, because that is state rather than
          an offer. */}
      <SaveProblem
        className="pointer-events-auto relative z-10"
        problemKey={item.key}
        revealOnHover
        snapshot={savedSnapshot(item)}
        title={item.title}
      />
    </div>
  );
}
