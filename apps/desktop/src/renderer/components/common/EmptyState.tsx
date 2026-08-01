import { cn } from "@/lib/utils";

/**
 * Empty states never invent data. Each one says exactly what has to happen
 * before content appears, so an empty pane is never mistaken for a broken one.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-8 text-center",
        compact ? "py-10" : "min-h-[18rem] py-16",
        className,
      )}
    >
      <span className="mb-3 grid size-9 place-items-center rounded-lg border border-border bg-[var(--color-background-elevated-secondary)] text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <p className="text-content font-medium">{title}</p>
      <p className="mt-1 max-w-[26rem] text-ui leading-[1.6] text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
