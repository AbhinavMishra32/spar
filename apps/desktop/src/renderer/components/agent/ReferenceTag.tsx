import { forwardRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one shape a reference takes.
 *
 * A challenge named in the agent's answer, a submission the learner picked with
 * `@`, the problem a question is being asked about — these are the same thing
 * seen from three places, and they used to look like three unrelated pieces of
 * UI: a blue underlined word, a bordered card with a progress bar and a run
 * count, and a plain run of text. Nothing about the card's size was carrying
 * meaning; it was a card because it had been built as one.
 *
 * So: a small tag, the height of the line it sits on, carrying a glyph that says
 * what kind of thing it is and a name that says which one. Whatever else is
 * worth knowing — the timing, the cases, the code — belongs in the hover card,
 * which is a place the learner goes on purpose.
 *
 * Two weights of the same tag. In running prose it is coloured text with a
 * glyph in front and no fill: a paragraph that cites three things should read as
 * a sentence, and three filled boxes in it read as a toolbar. Standing on its
 * own — over the composer, as the subject of the next message — it fills,
 * because there is no sentence there to belong to and the fill is what makes it
 * one object you can see the edges of and dismiss.
 */

export type TagTone = "reference" | "success" | "destructive" | "muted";

const TONE: Record<TagTone, string> = {
  reference: "bg-[color-mix(in_oklab,var(--reference)_13%,transparent)] text-[var(--reference-strong)]",
  success: "bg-[color-mix(in_oklab,var(--success)_13%,transparent)] text-[var(--success)]",
  destructive: "bg-[color-mix(in_oklab,var(--destructive)_11%,transparent)] text-destructive",
  muted: "bg-secondary text-muted-foreground",
};

/* The same four kinds as ink rather than as paint, for a tag inside a sentence. */
const INK: Record<TagTone, string> = {
  reference: "text-[var(--reference)] hover:text-[var(--reference-strong)]",
  success: "text-[var(--success)]",
  destructive: "text-destructive",
  muted: "text-muted-foreground hover:text-foreground",
};

const HOVER: Record<TagTone, string> = {
  reference: "hover:bg-[color-mix(in_oklab,var(--reference)_22%,transparent)]",
  success: "hover:bg-[color-mix(in_oklab,var(--success)_22%,transparent)]",
  destructive: "hover:bg-[color-mix(in_oklab,var(--destructive)_20%,transparent)]",
  muted: "hover:bg-accent",
};

export const ReferenceTag = forwardRef<HTMLSpanElement, {
  className?: string;
  glyph?: React.ReactNode;
  label: string;
  /** A marker before the name — an ordinal, usually. Quiet, fixed width, and
   *  read as a label on the tag rather than as part of the title. */
  lead?: React.ReactNode;
  /** Whatever is worth knowing after the name — an outcome, a count, a state. */
  note?: React.ReactNode;
  onClick?(): void;
  onRemove?(): void;
  removeLabel?: string;
  title?: string;
  tone?: TagTone;
  variant?: "inline" | "chip";
}>(function ReferenceTag({
  className,
  glyph,
  label,
  lead,
  note,
  onClick,
  onRemove,
  removeLabel,
  title,
  tone = "reference",
  variant = "inline",
  /* Whatever a hover card, a tooltip or a menu needs to attach to the tag. They
     hand their trigger props to the element they are anchored on, so the tag has
     to be one — a component that swallows them is a card that never opens. */
  ...anchored
}, ref) {
  const Tag = onClick ? "button" : "span";
  const chip = variant === "chip";
  return (
    /* One inline box, so a tag in a paragraph wraps with the sentence and a tag
       on its own sits on the text baseline rather than pushing the line taller.
       `align-[-0.15em]` is what puts the glyph's optical centre on the x-height
       instead of hanging it below the line. */
    <span
      ref={ref}
      {...anchored}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 align-[-0.15em] text-thread font-medium transition-colors",
        chip
          ? cn("rounded-[6px] py-[0.5px] pl-1 pr-1.5", TONE[tone], onClick && HOVER[tone], onRemove && "pr-0.5")
          : INK[tone],
        onClick && "cursor-pointer",
        className,
      )}
    >
      <Tag
        className={cn(
          "inline-flex min-w-0 items-center gap-1 rounded-[4px] underline-offset-[3px] outline-none focus-visible:ring-1 focus-visible:ring-ring",
          !chip && onClick && "hover:underline",
        )}
        onClick={onClick}
        title={title}
        {...(onClick ? { type: "button" as const } : {})}
      >
        {glyph && <span aria-hidden className="grid size-3.5 shrink-0 place-items-center">{glyph}</span>}
        {lead != null && <span className="shrink-0 tabular-nums opacity-55">{lead}</span>}
        <span className="min-w-0 truncate">{label}</span>
        {note != null && <span className="min-w-0 shrink-[2] truncate font-normal opacity-60">{note}</span>}
      </Tag>
      {onRemove && (
        <button
          aria-label={removeLabel ?? `Remove ${label}`}
          className="grid size-4 shrink-0 place-items-center rounded-[4px] opacity-55 outline-none transition-opacity hover:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
          onClick={onRemove}
          type="button"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  );
});
