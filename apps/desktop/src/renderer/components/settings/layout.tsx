import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Settings page's structural vocabulary, ported from construct.
 *
 * Five pieces and the whole page is built from them: a header, a titled
 * section, a card of rows, a row, and the row's two halves — the label on the
 * left and whatever control answers it on the right. Nothing here holds state
 * or knows what a provider is; the page composes these and supplies content.
 *
 * The rules that matter are the ones no single row shows. The card is
 * negatively inset so its rows sit flush with the column's reading edge while
 * the heading above it does not. Rows are divided by a hairline in light and by
 * a gap in dark, because on a dark ground a translucent surface separated by a
 * gap reads as stacked material while a drawn line reads as a table. And the
 * control slot is capped rather than sized, so a long select and a switch land
 * on the same right edge.
 *
 * Written against Spar's own tokens rather than copied class-for-class: the two
 * apps share a design, not a stylesheet, and construct's utilities would have
 * arrived here as class names that style nothing.
 */

/** The page title. The size and weight live here rather than on the page's own
 *  `h1`, so no section can drift off the scale by writing its own. */
export function SettingsHeader({ children }: { children: React.ReactNode }) {
  return <header className="mb-6 [&_h1]:text-[1.55rem] [&_h1]:font-semibold [&_h1]:tracking-[-0.035em]">{children}</header>;
}

/** A titled band of the page. The title is optional: a section that opens the
 *  page often needs no label, because the `h1` above it already is one. */
export function SettingsSection({ children, id, title }: { children: React.ReactNode; id?: string; title?: string }) {
  return (
    <section data-settings-section={title} id={id}>
      {title && <h2 className="mb-2 pl-1 text-ui font-medium text-muted-foreground">{title}</h2>}
      {children}
    </section>
  );
}

/** The card. Two stacked inside one section get a gap rather than a merge, so a
 *  section can hold related groups without becoming one long list. */
export function SettingsGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        /* Inset into the sheet rather than raised off it. The page is already
           a card; a second card on top of it at the same elevation reads as two
           unrelated surfaces that happen to be stacked. */
        "-mx-1 divide-y divide-border overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-background [&+&]:mt-2",
        className,
      )}
    />
  );
}

/** One row. A minimum height rather than a fixed one: a row with a two-line
 *  description grows, and a row with a bare switch does not. */
export function SettingsRow({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn("flex min-h-[3.375rem] items-center gap-3 px-3 py-2.5", className)} />;
}

/** A row that is itself the control — the whole surface is the hit target, so it
 *  takes a hover the way a menu item does. */
export function SettingsRowButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn("flex min-h-[3.375rem] w-full cursor-default items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/60", className)}
    />
  );
}

/** The left half: what the row is, and one line on why you would touch it. */
export function SettingsField({ description, title }: { description?: React.ReactNode; title: React.ReactNode }) {
  return (
    <div className="min-w-0 grow px-0.5">
      <h4 className="text-content font-medium text-foreground">{title}</h4>
      {description && <p className="mt-0.5 text-ui text-muted-foreground">{description}</p>}
    </div>
  );
}

/** The right half. Capped and right-aligned so every control in a card ends on
 *  the same line no matter how wide its content wants to be. */
export function SettingsControl({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn("flex min-w-0 max-w-40 shrink justify-end", className)} />;
}
