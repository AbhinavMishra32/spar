import { cn } from "@/lib/cn";

type Variant = "panel" | "bloom" | "rail" | "floor";

type Props = {
  /** Which mask the grid is cut with — see `.dots--*` in globals.css. */
  variant?: Variant;
  /** Grid step in px. The page's own field runs at 30. */
  step?: number;
  /** Dot brightness. Above about 0.2 it stops being a texture and starts
   *  competing with the copy set on top of it. */
  alpha?: number;
  /** Where a bloom is centred, as CSS percentages. */
  x?: string;
  y?: string;
  className?: string;
};

/**
 * The dot grid, as a decoration you can put somewhere.
 *
 * The hero's field is a WebGL canvas and the page can afford exactly one or two
 * of those. Everything else that should carry the same aesthetic gets this
 * instead: one background-image and one mask, free to paint. It is aria-hidden
 * because it is texture — there is nothing here to read.
 *
 * The parent must be `relative isolate`: this sits at z-index -1 so the copy
 * stays on top without every sibling needing its own stacking context, and the
 * isolation is what stops it falling through to the page behind the section.
 */
export function Dots({ variant = "panel", step, alpha, x, y, className }: Props) {
  return (
    <span
      aria-hidden
      className={cn("dots", `dots--${variant}`, className)}
      style={{
        ...(step ? { ["--dots-step" as string]: `${step}px` } : {}),
        ...(alpha ? { ["--dots-alpha" as string]: String(alpha) } : {}),
        ...(x ? { ["--dots-x" as string]: x } : {}),
        ...(y ? { ["--dots-y" as string]: y } : {}),
      }}
    />
  );
}
