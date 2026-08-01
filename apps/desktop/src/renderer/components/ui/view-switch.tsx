import { useRef } from "react";
import { cn } from "@/lib/utils";

export type ViewOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Live status for the view you are not looking at — a count, a dot, a spinner. */
  badge?: React.ReactNode;
};

/**
 * A tab control shaped like a macOS segmented switch: one sunken track, one
 * raised thumb that slides between equal-width segments.
 *
 * Tabs rather than radios, because these swap what the panel is showing rather
 * than set a value — which is also why the keyboard contract is the tablist one
 * (arrows move between tabs, Home/End jump to the ends).
 */
export function ViewSwitch<T extends string>({
  ariaLabel,
  className,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  className?: string;
  onChange(value: T): void;
  options: Array<ViewOption<T>>;
  value: T;
}) {
  const list = useRef<HTMLDivElement>(null);
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  const keydown = (event: React.KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : step ? index + step : -1;
    if (next < 0 || next > options.length - 1) return;
    event.preventDefault();
    onChange(options[next]!.value);
    // Selection follows focus, so the newly selected tab has to take it.
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      ref={list}
      aria-label={ariaLabel}
      className={cn(
        "relative grid shrink-0 rounded-[var(--radius-lg)] bg-[var(--color-background-elevated-secondary)] p-0.5",
        className,
      )}
      onKeyDown={keydown}
      role="tablist"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0.5 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-background shadow-[0_1px_2px_oklch(0%_0_0/8%)] transition-[left] duration-[260ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none dark:bg-[color-mix(in_oklab,var(--foreground)_14%,transparent)]"
        style={{
          left: `calc(0.125rem + ${index} * ((100% - 0.25rem) / ${options.length}))`,
          width: `calc((100% - 0.25rem) / ${options.length})`,
        }}
      />
      {options.map(({ value: option, label, icon: Icon, badge }) => {
        const selected = option === value;
        return (
          <button
            aria-selected={selected}
            className={cn(
              "relative z-10 inline-flex h-6 items-center justify-center gap-1.5 px-2 text-ui font-medium transition-colors outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring/60",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            key={option}
            onClick={() => !selected && onChange(option)}
            role="tab"
            // Only the selected tab is in the tab order; arrows move within.
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {Icon && <Icon className="size-3.5" />}
            <span className="truncate">{label}</span>
            {badge}
          </button>
        );
      })}
    </div>
  );
}
