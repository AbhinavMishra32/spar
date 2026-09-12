import { cn } from "@/lib/utils";
import { ChevronLeftGlyph, ChevronRightGlyph } from "./NavIcons";

/**
 * Back and forward, beside the traffic lights.
 *
 * Placed where every document application on the platform puts them — leading
 * edge of the title bar, immediately after the window controls — because that
 * position is what makes them recognisable without a label.
 *
 * Both stay mounted when they cannot be used rather than disappearing. A
 * control that vanishes at the end of the history moves the other one under the
 * cursor, so the click that was meant for "back" lands on "forward"; disabled
 * and dimmed keeps the pair where the hand expects them.
 */
export function NavButtons({
  canBack,
  canForward,
  className,
  onBack,
  onForward,
}: {
  canBack: boolean;
  canForward: boolean;
  className?: string | undefined;
  onBack(): void;
  onForward(): void;
}) {
  return (
    <div className={cn("app-no-drag flex shrink-0 items-center gap-0.5", className)}>
      <NavButton disabled={!canBack} icon={ChevronLeftGlyph} label="Back  ⌘[" onClick={onBack} />
      <NavButton disabled={!canForward} icon={ChevronRightGlyph} label="Forward  ⌘]" onClick={onForward} />
    </div>
  );
}

function NavButton({
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  disabled: boolean;
  icon: React.ComponentType<{ className?: string | undefined }>;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        "grid size-7 place-items-center rounded-md transition-colors",
        disabled
          ? "cursor-default text-muted-foreground/30"
          : "text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground",
      )}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon />
    </button>
  );
}
