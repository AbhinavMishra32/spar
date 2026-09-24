import { cn } from "@/lib/utils";
import { ExpandSidebar } from "./ExpandSidebar";
import { NavButtons } from "./NavButtons";
import { SIDEBAR_SLIDE_CSS } from "./sidebarMotion";

/**
 * One fact about the surface below, drawn small.
 *
 * The toolbar used to hold a single word — "Problems" over a page whose own
 * first line already said Problems — which is a title bar spending a whole row
 * of the window repeating the next one. A row that costs that much has to carry
 * something the page does not, so it carries counts and state: how many, how
 * many of those are done, which Track this is, whether anything is still
 * running. A figure and what it counts, and nothing that needs a sentence.
 */
export type ToolbarFact = {
  /** The figure, or the short phrase that *is* the fact. Drawn a step stronger
   *  than its label, because the number is what gets read. */
  value: string;
  /** What the figure counts. Left off when the value says it on its own. */
  label?: string;
  /** For a fact that is a state rather than a count. Adds the one dot of colour
   *  this row is allowed — anything more and a chrome row becomes a dashboard. */
  tone?: "good" | "warn";
};

const TONE: Record<NonNullable<ToolbarFact["tone"]>, string> = {
  good: "bg-[var(--success)]",
  warn: "bg-[var(--warning)]",
};

/** Separates two facts. A dot, not a pipe: a vertical rule at this size is a
 *  second hairline in a row that just had one taken out of it. */
function Dot() {
  return <span aria-hidden className="size-[3px] shrink-0 rounded-full bg-muted-foreground/30" />;
}

function Fact({ fact }: { fact: ToolbarFact }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {fact.tone && <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE[fact.tone])} />}
      <span className="truncate">
        <span className="font-medium text-foreground/75 tabular-nums">{fact.value}</span>
        {fact.label && <span className="ml-1 text-muted-foreground/75">{fact.label}</span>}
      </span>
    </span>
  );
}

/**
 * Inset macOS toolbar: one title-bar row tall, draggable but for the controls.
 *
 * There is no line under it. The hairline that used to be here was drawn across
 * the full width of the pane, over glass on two surfaces and over paper on the
 * rest, and on a window whose whole construction is one material continuing
 * behind another it read as a seam where there is no seam. The row is separated
 * from the page by the space under it instead, which is what separates every
 * other pair of things in this app.
 *
 * Everything but the row's height is optional. A page that has nothing to put
 * here gets a bare strip — which is not waste, because the strip is also where
 * the window's own buttons and the back and forward controls live once the
 * sidebar is hidden.
 */
export function Toolbar({
  title,
  subtitle,
  facts,
  nav,
  onExpandSidebar,
  actions,
  className,
}: {
  /** A node, not only a string: a surface that is one of a series puts its
   *  stepper here, because the stepper *is* the title — see `ChallengeStepper`.
   *
   *  Omitted on purpose by any page that draws its own heading. Two names for
   *  one page, eleven pixels apart, is not a hierarchy. */
  title?: React.ReactNode;
  subtitle?: string;
  /** What this page is holding right now. See `ToolbarFact`. */
  facts?: ToolbarFact[];
  /** The window's back and forward. Drawn here only while the sidebar — which
   *  normally carries them — is hidden, so the window never shows two pairs. */
  nav?: { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void } | undefined;
  /** Present only while the sidebar is hidden, so the traffic lights get their inset. */
  onExpandSidebar?: (() => void) | undefined;
  actions?: React.ReactNode;
  className?: string;
}) {
  const shown = (facts ?? []).filter((fact) => fact.value.trim().length > 0);
  /* The subtitle is the same kind of thing one line of code earlier called a
     fact, so it is drawn as one rather than as a third type size. */
  const meta: ToolbarFact[] = subtitle ? [{ value: subtitle }, ...shown] : shown;

  return (
    <header
      className={cn(
        "app-drag flex h-[var(--titlebar-height)] shrink-0 items-center gap-2 px-2.5",
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

      {/* Centred on the row rather than baseline-aligned: the facts are a
          different size from the title, and two type sizes sharing a baseline in
          a 28px row sit visibly high in it. */}
      <div className="flex min-w-0 items-center gap-2">
        {title && (
          /* Set with the sidebar, not with the toolbar's controls: this is the
             name of the page the nav row points at, and a heading smaller than
             the row that leads to it inverts the hierarchy. */
          <span className="truncate text-source font-medium">{title}</span>
        )}
        {title && meta.length > 0 && <Dot />}
        {meta.length > 0 && (
          <div className="flex min-w-0 items-center gap-2 text-ui text-muted-foreground">
            {meta.map((fact, index) => (
              <span className="flex min-w-0 items-center gap-2" key={`${fact.value}-${fact.label ?? ""}`}>
                {index > 0 && <Dot />}
                <Fact fact={fact} />
              </span>
            ))}
          </div>
        )}
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
