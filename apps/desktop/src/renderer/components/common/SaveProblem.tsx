import { Bookmark } from "lucide-react";
import type { SavedProblem } from "@spar/domain";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { canOpenShelf, openSavedProblems, toggleSavedProblem, useProblemSaved } from "@/hooks/use-saved-problems";
import { toast } from "@/hooks/use-toasts";

/**
 * The bookmark, wherever a problem is shown.
 *
 * One component rather than one per surface, because "saved" is a single fact
 * and a control that means it has to look and behave the same in the transcript,
 * in the library list and on a tile — a second implementation is how you end up
 * with two shapes of the same promise, and with one of them forgetting to stop
 * the click from opening the problem underneath it.
 *
 * Filled when saved and outlined when not, which is the whole state: no colour
 * change, no count, no confirmation. A bookmark is the one control in the app
 * that should be completely reversible and completely quiet, so it says nothing
 * back — the shelf it writes to is one click away and is where the feedback
 * belongs.
 */
export function SaveProblem({
  className,
  problemKey,
  snapshot = null,
  title,
  /** Shown only on hover of the row it sits in, for the two surfaces that are
   *  lists: eighty outlined bookmarks down a column is a column of bookmarks,
   *  and none of them reads as a control you could press. A saved one is always
   *  shown — that one is state rather than an offer. */
  revealOnHover = false,
}: {
  className?: string;
  /** `problemKey`'s identity. Null while the problem has no durable id yet, which
   *  is the moment between the agent publishing it and the host answering — the
   *  bookmark simply is not offered rather than being offered and failing. */
  problemKey: string | null;
  snapshot?: SavedProblem["snapshot"];
  /** The problem's name, for the control's accessible label. A bare "Save" on a
   *  page with forty of them names none of them. */
  title: string;
  revealOnHover?: boolean;
}) {
  const saved = useProblemSaved(problemKey);
  if (!problemKey) return null;
  const label = saved ? `Remove ${title} from saved` : `Save ${title}`;

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        aria-pressed={saved}
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-[var(--radius-md)] outline-none transition-[color,background-color,opacity] duration-150",
          "hover:bg-[var(--color-background-elevated-secondary)] focus-visible:ring-1 focus-visible:ring-ring",
          saved ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          /* Focus keeps it visible too: a control that only exists under the
             pointer is a control nobody can reach with a keyboard. */
          revealOnHover && !saved && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
          className,
        )}
        onClick={(event) => {
          /* The surfaces this sits on are a card and two kinds of row, and on all
             three the thing underneath opens the problem. Saving is not opening. */
          event.preventDefault();
          event.stopPropagation();
          saveWithReceipt({ problemKey, snapshot, title, saved });
        }}
        type="button"
      >
        <Bookmark className={cn("size-3.5 transition-transform duration-150", saved && "fill-current")} />
      </TooltipTrigger>
      <TooltipContent>{saved ? "Saved — click to remove" : "Save for later"}</TooltipContent>
    </Tooltip>
  );
}

/**
 * File a problem and say so.
 *
 * Exported because the bookmark is not the only way to save one — the card's
 * overflow menu carries the same action, and a menu item that files something
 * silently while the bookmark beside it announces the same act is two different
 * promises about the same shelf. The receipt belongs to saving, not to the
 * control that happened to do it.
 *
 * The shelf is a page away, which is why filing needed a word back at all — and
 * why the word names where it went and is itself the way there. Undo is the only
 * other offer worth making: the bookmark is how you do everything else, and it
 * is still under the pointer. Keyed on the problem, so pressing twice replaces
 * the receipt rather than leaving two that disagree about where it ended up.
 */
export function saveWithReceipt({
  problemKey,
  snapshot = null,
  title,
  saved,
}: {
  problemKey: string;
  snapshot?: SavedProblem["snapshot"];
  title: string;
  /** Whether it was on the shelf *before* this press. */
  saved: boolean;
}) {
  void toggleSavedProblem(problemKey, snapshot);
  toast({
    key: `saved:${problemKey}`,
    title: saved ? "Removed from Saved" : "Saved in Problems",
    detail: saved ? title : `${title} — open your saved list`,
    glyph: <Bookmark className={saved ? undefined : "fill-current"} />,
    action: { label: "Undo", onClick: () => void toggleSavedProblem(problemKey, snapshot) },
    ...(saved || !canOpenShelf() ? {} : { onClick: openSavedProblems }),
  });
}
