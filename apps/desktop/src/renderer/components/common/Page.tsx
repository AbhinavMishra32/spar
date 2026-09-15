import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The reading surfaces' shared structure: Today, Progress, and an ability.
 *
 * These three pages are the app's argument about the learner — what to do now,
 * what is believed, and what one belief rests on — and before this they each
 * invented their own measure, heading scale and card. Three pages that make the
 * same kind of claim should be read the same way, so the vocabulary is here and
 * the pages only supply content.
 *
 * Four pieces. A page has one column. A column opens with one header. The header
 * is followed by bands, and a band is a titled thing with an optional line of
 * context and an optional action on its right. Inside a band, a panel is the one
 * raised surface — everything else is type on the page's own ground.
 *
 * The elevation rule is the important one and it runs the same way everywhere in
 * the app: the page is the ground, a panel is lifted off it. Nothing is ever
 * drawn as a darker hole in a lighter page.
 */

/** The scrolling surface and the measure. One column, capped at a width a
 *  paragraph can actually be read across. */
export function Page({ children, className, width = "regular" }: { children: React.ReactNode; className?: string | undefined; width?: "regular" | "wide" | undefined }) {
  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className={cn("mx-auto w-full px-10 pb-20 pt-9", width === "wide" ? "max-w-[62rem]" : "max-w-[46rem]", className)}>{children}</div>
    </div>
  );
}

/**
 * The page's one header: an eyebrow, a title, and whatever control belongs to
 * the whole page. No standfirst. A paragraph under every h1 explaining what the
 * page is for is a paragraph nobody reads twice, and the page has to work
 * without it anyway.
 */
export function PageHeader({ action, className, eyebrow, title }: {
  action?: React.ReactNode;
  className?: string | undefined;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
}) {
  return (
    <header className={cn("mb-7 flex items-baseline justify-between gap-6", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-ui text-muted-foreground">{eyebrow}</p>}
        <h1 className="text-[1.6rem] font-semibold leading-[1.15] tracking-[-0.035em]">{title}</h1>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/**
 * A titled band. The title is a label, not a heading — on a page of panels the
 * panels are the content, and a heavy heading over each one turns the page into
 * an outline of itself. There is no slot for a line explaining the band: a band
 * that needs explaining is the wrong band.
 */
export function Band({ action, children, className, title }: {
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string | undefined;
  title?: React.ReactNode;
}) {
  return (
    <section className={cn("mt-7 first:mt-0", className)}>
      {title && (
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <h2 className="min-w-0 truncate text-ui text-muted-foreground">{title}</h2>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * The surface, drawn the way the rest of the system draws one: a translucent
 * veil over the page, a half-pixel rim, and nothing else. No shadow and no
 * opaque fill — depth here is a change of light, not a box floating over a
 * board, and a drop shadow under every panel is how a quiet page turns into a
 * pile of cards.
 *
 * `tone="quiet"` is the same surface one step fainter, for something that holds
 * context rather than the thing the band is about.
 */
export function Panel({ className, tone = "card", ...props }: React.ComponentProps<"div"> & { tone?: "card" | "quiet" }) {
  return (
    <div
      {...props}
      className={cn(
        "rounded-[var(--radius-xl)] border-[length:var(--hairline)] border-[var(--border-surface-strong)]",
        tone === "card" ? "bg-[var(--surface-primary)]" : "bg-[var(--surface-tertiary)]",
        className,
      )}
    />
  );
}

/**
 * A proportion, drawn.
 *
 * Deliberately a hairline rather than a chunky bar: these sit beside type at
 * text size, and a bar heavy enough to be a chart at that scale reads as a
 * progress meter — a promise that there is an end to get to, which is the one
 * thing a model of somebody's ability must not imply.
 */
export function Meter({ className, title, tone, value }: { className?: string | undefined; title?: string | undefined; tone?: string | undefined; value: number }) {
  const filled = Math.max(0, Math.min(1, value));
  return (
    <span aria-hidden className={cn("block h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-background-elevated-secondary)]", className)} title={title}>
      {/* `tone` colours the fill by what the group of rows *is*, never by how
          full the bar is. A meter that turns green as it fills is a grade, and
          the one thing a model of somebody's ability must not do is grade them —
          the same reason it is a hairline and not a progress bar. */}
      <span className={cn("block h-full rounded-full", !tone && "bg-foreground/45")} style={{ width: `${filled * 100}%`, ...(tone ? { background: `color-mix(in oklab, ${tone} 72%, transparent)` } : {}) }} />
    </span>
  );
}
