import { ArrowUpRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProblemItem } from "@/lib/problems";
import { BandPill, OriginChip, ProblemMark, StandingMark, problemNote } from "./ProblemMark";

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
    <button
      aria-busy={pending || undefined}
      className={cn(
        "group flex h-12 w-full items-center gap-3 rounded-lg border border-transparent px-2.5 text-left outline-none",
        "transition-colors duration-100 hover:bg-[var(--color-background-elevated-secondary)]",
        "focus-visible:border-[var(--border-strong)] focus-visible:ring-1 focus-visible:ring-ring",
        pending && "pointer-events-none",
      )}
      disabled={pending}
      onClick={onOpen}
      type="button"
    >
      <StandingMark standing={item.standing} />
      <ProblemMark item={item} size={24} />

      <span className="min-w-0 flex-1 truncate text-content font-medium tracking-[-0.01em]">{item.title}</span>

      {/* Below a narrow pane the tags are the first thing to go: they are the only
          column here that repeats what the concept filter above already says. */}
      <span className="hidden min-w-0 max-w-[16rem] gap-1 xl:flex">
        {item.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="truncate rounded-md bg-[var(--color-background-elevated-secondary)] px-1.5 py-0.5 text-ui-sm text-muted-foreground group-hover:bg-background/70">
            {tag}
          </span>
        ))}
      </span>

      <span className="hidden w-[7.5rem] shrink-0 justify-end lg:flex">
        <OriginChip origin={item.origin} />
      </span>

      {/* What the source calls it, or — for a challenge Spar wrote, which has no
          public number — the session it was written for. The same line the tile
          puts under the title, so switching views moves nothing but the layout. */}
      <span className="hidden w-[8.5rem] shrink-0 truncate text-right text-ui-sm text-muted-foreground/70 md:block">
        {item.displayId ?? (item.kind === "challenge" ? item.challenge.sessionTitle : "")}
      </span>

      <span className="w-[4.5rem] shrink-0 text-right">
        <BandPill band={item.band} />
      </span>

      {/* The last column is the note until the pointer arrives, then the action —
          the same trade the tile makes, at the same width so the rows never jump. */}
      <span className="hidden w-[8rem] shrink-0 truncate text-right text-ui-sm text-muted-foreground/70 sm:block">
        {pending ? (
          <span className="inline-flex items-center justify-end gap-1 font-medium text-foreground/80">
            <Loader2 className="size-3 animate-spin" />
            Opening…
          </span>
        ) : (
          <>
            <span className="group-hover:hidden">{note}</span>
            <span className="hidden items-center justify-end gap-1 font-medium text-foreground/80 group-hover:inline-flex">
              <ArrowUpRight className="size-3" />
              {item.kind === "challenge" ? "Open" : "Start solving"}
            </span>
          </>
        )}
      </span>
    </button>
  );
}
