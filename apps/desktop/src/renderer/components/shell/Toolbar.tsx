import { cn } from "@/lib/utils";
import { ExpandSidebar } from "./ExpandSidebar";
import { NavButtons } from "./NavButtons";
import { SIDEBAR_SLIDE_CSS } from "./sidebarMotion";

/** Inset macOS toolbar: one title-bar row tall, hairline base, draggable but for the controls. */
export function Toolbar({
  title,
  subtitle,
  nav,
  onExpandSidebar,
  actions,
  className,
}: {
  /** A node, not only a string: a surface that is one of a series puts its
   *  stepper here, because the stepper *is* the title — see `ChallengeStepper`. */
  title: React.ReactNode;
  subtitle?: string;
  /** The window's back and forward. Drawn here only while the sidebar — which
   *  normally carries them — is hidden, so the window never shows two pairs. */
  nav?: { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void } | undefined;
  /** Present only while the sidebar is hidden, so the traffic lights get their inset. */
  onExpandSidebar?: (() => void) | undefined;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "app-drag hairline-b flex h-[var(--titlebar-height)] shrink-0 items-center gap-2 px-2.5",
        // The OS draws its window buttons over this row: on Windows they are
        // always on the trailing edge, and on macOS they land here only once the
        // sidebar (which normally hosts them) is hidden.
        "pr-[max(0.625rem,var(--window-controls-trailing))]",
        /* Eased rather than switched, on the sidebar's own curve: the inset
           appears as the column vacates the space it needs. Switched, the title
           stepped sideways by the width of the traffic lights on the first frame
           of a collapse that had not started moving yet. */
        "transition-[padding-left]",
        SIDEBAR_SLIDE_CSS,
        onExpandSidebar && "pl-[max(0.625rem,var(--window-controls-leading))]",
        className,
      )}
    >
      {/* Revealed, not mounted — the button is the only part of this row that
          exists *because* the sidebar left, so it opens on the same curve the
          column closes on. */}
      <ExpandSidebar gap={8} onExpand={onExpandSidebar} />
      {onExpandSidebar && nav && (
        <NavButtons canBack={nav.canBack} canForward={nav.canForward} onBack={nav.onBack} onForward={nav.onForward} />
      )}
      <div className="flex min-w-0 items-baseline gap-2">
        {/* Set with the sidebar, not with the toolbar's controls: this is the name
            of the page the nav row points at, and a heading smaller than the row
            that leads to it inverts the hierarchy. */}
        <span className="truncate text-source font-medium">{title}</span>
        {subtitle && <span className="truncate text-ui-sm text-muted-foreground/80">{subtitle}</span>}
      </div>
      <div className="app-no-drag ml-auto flex shrink-0 items-center gap-1">{actions}</div>
    </header>
  );
}

/** Compact toolbar control that matches the native segmented look. */
export function ToolbarButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?(): void;
  title?: string;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-ui transition-colors disabled:pointer-events-none disabled:opacity-45",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      <Icon className="size-3.5" />
      {label && <span>{label}</span>}
    </button>
  );
}
