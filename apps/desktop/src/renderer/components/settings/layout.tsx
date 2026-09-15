import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Settings page's structural vocabulary, ported from construct.
 *
 * Six pieces and the whole page is built from them: a header, a titled
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
  return <header className="mb-6 [&_h1]:text-2xl [&_h1]:font-[450] [&_h1]:tracking-[-0.02em]">{children}</header>;
}

/**
 * A titled band of the page. The title is optional: a section that opens the
 * page often needs no label, because the `h1` above it already is one.
 *
 * `data-settings-section` is not decoration — it is the whole contract the rail
 * in the margin and the sidebar's search both read. A section that forgets its
 * title drops out of both rather than appearing unnamed.
 */
export function SettingsSection({
  children,
  description,
  id,
  title,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  id?: string;
  title?: string;
}) {
  return (
    <section data-settings-section={title} id={id}>
      {title && (
        <div className="mb-2">
          <h2 className="flex items-center gap-1.5 text-sm font-[550] text-muted-foreground/80">{title}</h2>
          {description && <p className="mt-1 text-xs font-medium text-muted-foreground">{description}</p>}
        </div>
      )}
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
        /* Raised off the sheet, because the sheet is the ground. A group is the
           only material on this page you actually operate — every switch and
           select lives in one — so it takes the card surface, and the quiet
           sheet under it is what makes the lift readable at all.

           In dark the border and the dividing lines both go: the rows are
           translucent there, and a stack of translucent panes separated by a
           one-pixel gap already reads as material. Drawing a line as well turns
           the card into a table. */
        "-mx-3.5 divide-y divide-border overflow-hidden rounded-xl border border-border",
        "dark:space-y-px dark:divide-y-0 dark:border-transparent dark:bg-transparent",
        "[&+&]:mt-2",
        className,
      )}
    />
  );
}

/** One row. A minimum height rather than a fixed one: a row with a two-line
 *  description grows, and a row with a bare switch does not. */
export function SettingsRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn("flex min-h-[3.25rem] items-center gap-3 bg-[var(--surface-secondary)] p-2.5", className)}
    />
  );
}

/** A row that is itself the control — the whole surface is the hit target, so it
 *  takes a hover the way a menu item does. */
export function SettingsRowButton({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 text-left outline-none transition-colors",
        "min-h-[3.25rem] bg-[var(--surface-secondary)] p-2.5",
        "hover:bg-neutral-100 dark:hover:bg-accent",
        className,
      )}
    />
  );
}

/** The left half: what the row is, and one line on why you would touch it. */
export function SettingsField({ description, title }: { description?: React.ReactNode; title: React.ReactNode }) {
  return (
    <div className="min-w-0 grow px-1">
      <h4
        className="text-content font-medium text-foreground"
        data-settings-field={typeof title === "string" ? title : undefined}
      >
        {title}
      </h4>
      {description && <p className="mt-0.5 text-ui text-muted-foreground">{description}</p>}
    </div>
  );
}

/** The right half. Capped and right-aligned so every control in a card ends on
 *  the same line no matter how wide its content wants to be. */
export function SettingsControl({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn("flex min-w-0 max-w-40 shrink justify-end", className)} />;
}
