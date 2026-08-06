import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Archive, ArchiveRestore, Check, ChevronRight, CircleCheck, Command, EllipsisVertical, History, LayoutGrid, Map, PanelLeftClose, Pencil, Pin, PinOff, Plus, RotateCcw, Settings, Target, Trash2, Waypoints } from "lucide-react";
import type { SessionSummary } from "@spar/domain";
import type { BootstrapData } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { formatDuration, initials, relativeTime } from "@/lib/format";
import { challengeBands } from "@/lib/progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Meter } from "@/components/ui/meter";
import { SparWordmark } from "../common/SparWordmark";

/* "challenge" is one challenge opened on its own, out of the history list. Like
   "workspace" it draws its own toolbar and is not a destination in the nav — the
   sidebar highlights "challenges" while it is up, because that is where it came
   from and where Back returns to. */
export type Page = "home" | "sessions" | "ability" | "challenges" | "challenge" | "settings" | "workspace";

/** What the sidebar can do to a session. Every one of these is a write the main
 *  process owns, so the row reports intent and never edits its own copy. */
export type SessionActions = {
  rename(session: SessionSummary, title: string): void;
  setPinned(session: SessionSummary, pinned: boolean): void;
  setArchived(session: SessionSummary, archived: boolean): void;
  setFinished(session: SessionSummary, finished: boolean): void;
  remove(session: SessionSummary): void;
};

const NAV: Array<{ id: Page; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "home", label: "Home", icon: Waypoints },
  { id: "sessions", label: "Sessions", icon: LayoutGrid },
  { id: "ability", label: "Abilities", icon: Map },
  { id: "challenges", label: "Challenges", icon: History },
];

/* 30px tall on a 13px label, cornered at --radius-lg, inset 8px from the sidebar's
   edge by its container and carrying 10px of padding itself: the metrics of a
   platform source list, which is what this is. The height is not h-7-and-a-bit by
   accident — it is the 20px line box plus 5px of air top and bottom, so a row is
   exactly as tall as its text needs and not a pixel more.

   No transition on the fill. A source list is the one surface where the pointer
   is expected to travel fast, and a 150ms crossfade per row turns that into a
   wake of half-lit rows trailing the cursor. AppKit paints the highlight on the
   frame the pointer arrives — hovering here should feel like touching hardware,
   not like waking a web page up.

   Every label is solid ink at regular weight, and both halves of that are
   deliberate. Solid, because the labels used to be foreground at some fraction —
   95, 85, 80 — and on an opaque sidebar that is a legitimate way to rank rows,
   but on this one it is not: the surface is glass, so alpha text composites
   against the desktop twice and arrives grey and soft however dark the token
   behind it was. That, not the transparency, was why the list read as washed out.

   Regular, because the fix for washed-out text is not weight. A source list sets
   every row the same and separates them by fill and by colour. Reaching for medium
   here would buy back the contrast the alpha lost while saying, wrongly, that the
   fixed rows outrank the session titles — and a sidebar of semibold rows is the
   thing that makes an app look like it is shouting its own navigation at you. */
const ROW =
  "flex h-[1.875rem] w-full items-center gap-2 rounded-lg px-2.5 text-source font-normal text-foreground outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

/** Nav and row glyphs. Set against the label rather than chosen for its own sake:
 *  a source list wants the icon a little larger than the cap height it sits
 *  beside, or the label starts to look like it is dragging the icon along.
 *
 *  A shade off the label rather than the muted grey they used to be: at 55% on
 *  glass a 16px line drawing has no stroke left to read, and the row turned into
 *  a label with a smudge in front of it. */
const ROW_ICON = "size-4 shrink-0";
const ROW_ICON_TONE = "text-foreground/70";

const STATUS_COPY: Record<SessionSummary["status"], string> = {
  planning: "Planning",
  active: "In progress",
  paused: "Paused",
  completed: "Completed",
};

const SYNC: Record<BootstrapData["syncState"], { label: string; tone: string }> = {
  synced: { label: "Cloud synced", tone: "bg-[var(--success)]" },
  pending: { label: "Syncing…", tone: "bg-[var(--warning)]" },
  offline: { label: "Local checkpoint", tone: "bg-muted-foreground/50" },
};

/** Unpinned sessions shown before the list starts asking to be scrolled. */
const RECENT_LIMIT = 8;

/** Indented to the row's text column, not to the row's box: the label heads a
 *  list of titles, so it is the titles it has to line up with. */
function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between px-2.5 pt-1">
      <span className="text-source-sm text-muted-foreground">{children}</span>
      {action}
    </div>
  );
}

export function Sidebar({
  page,
  account,
  sessions,
  activeSessionId,
  syncState,
  sessionActions,
  onPage,
  onOpenSession,
  onNewSession,
  onCommandPalette,
  onCollapse,
}: {
  page: Page;
  account: NonNullable<BootstrapData["account"]>;
  sessions: SessionSummary[];
  activeSessionId?: string | undefined;
  syncState: BootstrapData["syncState"];
  sessionActions: SessionActions;
  onPage(page: Page): void;
  onOpenSession(session: SessionSummary): void;
  onNewSession(): void;
  onCommandPalette(): void;
  onCollapse(): void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // The store already sorts pinned first, then by last touched; the sidebar only
  // has to say where one group stops and the next starts.
  const shelved = sessions.filter((session) => session.archivedAt);
  const live = sessions.filter((session) => !session.archivedAt);
  const pinned = live.filter((session) => session.pinnedAt);
  const recent = live.filter((session) => !session.pinnedAt).slice(0, RECENT_LIMIT);
  /* The open session keeps its row whatever else is true of it. Archiving or
     finishing the session you are working in is the ordinary way to file it away,
     and the row disappearing from under the cursor while its workspace is still
     on screen reads as having lost the thing rather than having tidied it. */
  const shown = new Set([...pinned, ...recent, ...(showArchived ? shelved : [])].map((session) => session.id));
  const stranded = activeSessionId && !shown.has(activeSessionId) ? sessions.find((session) => session.id === activeSessionId) : undefined;

  const row = (session: SessionSummary) => (
    <SessionRow
      key={session.id}
      actions={sessionActions}
      active={activeSessionId === session.id}
      onOpen={() => onOpenSession(session)}
      onRenameEnd={() => setRenaming(null)}
      onRenameStart={() => setRenaming(session.id)}
      onRequestDelete={() => setPendingDelete(session)}
      renaming={renaming === session.id}
      session={session}
    />
  );

  return (
    <aside className="app-sidebar app-drag flex h-full w-full flex-col">
      {/* Clears the native traffic lights, and carries the collapse control. The leading
          inset is the shared chrome token rather than a hand-measured margin, so the
          wordmark keeps its clearance if the button metrics ever move. */}
      <div className="flex h-[var(--titlebar-height)] shrink-0 items-center pl-[max(0.625rem,var(--window-controls-leading))] pr-2">
        <SparWordmark className="text-[1.1rem] text-foreground" />
        <button
          className="app-no-drag ml-auto grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground"
          onClick={onCollapse}
          title="Hide sidebar  ⌘B"
          type="button"
        >
          <PanelLeftClose className={ROW_ICON} />
        </button>
      </div>

      <div className="app-no-drag space-y-0.5 px-2">
        <button
          className={cn(ROW, "hover:bg-[var(--sidebar-accent)]")}
          onClick={onNewSession}
          type="button"
        >
          <Plus className={cn(ROW_ICON, ROW_ICON_TONE)} />
          <span className="flex-1 text-left">Start a session</span>
          <kbd className="font-sans text-source-sm text-muted-foreground">⌘N</kbd>
        </button>
        <button
          className={cn(ROW, "hover:bg-[var(--sidebar-accent)]")}
          onClick={onCommandPalette}
          type="button"
        >
          <Command className={cn(ROW_ICON, ROW_ICON_TONE)} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="font-sans text-source-sm text-muted-foreground">⌘K</kbd>
        </button>
      </div>

      {/* Wider than the gap between rows by enough to read as a new group rather
          than as a skipped row — the reference's own break between its actions and
          its nav, and between the nav and the first section label. */}
      <nav className="app-no-drag mt-4 space-y-0.5 px-2">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={cn(
              ROW,
              /* Selection is the fill and nothing else. The ink was a step lighter
                 on unselected rows, which meant the nav read as one lit item and
                 four half-off ones — on glass, where alpha already costs contrast,
                 that is four rows you have to look at rather than glance at. AppKit
                 keeps the label constant and moves the highlight. */
              // A single challenge is a page under Challenges, so the section
              // stays lit rather than the nav going blank while it is open.
              page === id || (id === "challenges" && page === "challenge")
                ? "bg-[var(--sidebar-accent-active)]"
                : "hover:bg-[var(--sidebar-accent)]",
            )}
            onClick={() => onPage(id)}
            type="button"
          >
            <Icon className={cn(ROW_ICON, ROW_ICON_TONE)} />
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          </button>
        ))}
      </nav>

      <div className="app-no-drag app-scroll mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {pinned.length > 0 && (
          <>
            <SectionLabel>Pinned</SectionLabel>
            <div className="space-y-0.5">{pinned.map(row)}</div>
          </>
        )}

        {(recent.length > 0 || stranded) && (
          <>
            <SectionLabel>Recent</SectionLabel>
            <div className="space-y-0.5">
              {recent.map(row)}
              {stranded && row(stranded)}
            </div>
          </>
        )}

        {/* Collapsed by default: the point of archiving was to get these out of
            the way, and a permanent list of them would put them back. */}
        {shelved.length > 0 && (
          <>
            <button
              className="flex h-7 w-full items-center gap-1 px-2.5 pt-1 text-source-sm text-muted-foreground hover:text-foreground"
              onClick={() => setShowArchived((value) => !value)}
              type="button"
            >
              <ChevronRight className={cn("size-3.5 transition-transform", showArchived && "rotate-90")} />
              Archived
              <span className="tabular-nums font-normal text-muted-foreground">{shelved.length}</span>
            </button>
            {showArchived && <div className="space-y-0.5">{shelved.map(row)}</div>}
          </>
        )}
      </div>

      {/* One row rather than three. The address under the name repeated what the
          avatar and the name already say, and the sync line spent a whole line of
          chrome on one bit of state — so sync is the status light on the row and
          the words for it live in the tooltip.

          Taller than the rows above it, because the avatar is: this is the one
          place in the list where the leading glyph is a face rather than a line
          drawing, and it takes the room a face needs to read as one. */}
      <div className="app-no-drag border-t border-[var(--sidebar-border)] p-2">
        {/* The avatar is 4px wider than a nav glyph, so the gap gives back the 4px:
            it starts on the icons' left edge and the name still lands on the one
            text column the whole list reads down. */}
        <button
          className={cn(ROW, "h-9 gap-1 hover:bg-[var(--sidebar-accent)]")}
          onClick={() => onPage("settings")}
          title={`${account.displayName} · ${account.email} · ${SYNC[syncState].label}`}
          type="button"
        >
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-background-elevated-secondary)] text-ui-sm font-semibold text-foreground">
            {initials(account.displayName)}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{account.displayName}</span>
          <span className={cn("size-1.5 shrink-0 rounded-full", SYNC[syncState].tone)} />
          <Settings className={cn(ROW_ICON, ROW_ICON_TONE)} />
        </button>
      </div>

      <DeleteSessionDialog
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) sessionActions.remove(pendingDelete);
          setPendingDelete(null);
        }}
        session={pendingDelete}
      />
    </aside>
  );
}

/** The control cluster's buttons, in the order they sit in the row. */
const ICON_BUTTON =
  "grid size-6 shrink-0 place-items-center rounded-md text-foreground/70 hover:bg-[var(--sidebar-accent-active)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

/**
 * One session in the list, with everything you can do to it behind ⋮ or a
 * right-click on the row — and the two you actually reach for, pinning and
 * filing, as their own icons on hover.
 *
 * No gutter is reserved for them. The old row paid for the ⋮ on every row it
 * drew, so titles ended in an ellipsis a word early even with nothing hovered;
 * here the controls take their room from the title only while they are visible,
 * and the title fades under them rather than being cut. What the fade hides,
 * hovering walks past — see {@link RowTitle}.
 */
function SessionRow({
  session,
  active,
  renaming,
  actions,
  onOpen,
  onRenameStart,
  onRenameEnd,
  onRequestDelete,
}: {
  session: SessionSummary;
  active: boolean;
  renaming: boolean;
  actions: SessionActions;
  onOpen(): void;
  onRenameStart(): void;
  onRenameEnd(): void;
  onRequestDelete(): void;
}) {
  const [open, setOpen] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const archived = !!session.archivedAt;
  const finished = session.status === "completed";
  // A live challenge is what the session is, so its status is not the learner's
  // to relabel while one is open.
  const canFinish = !session.activeQuestion;

  const items: Array<{ key: string; label: string; icon: React.ComponentType<{ className?: string }>; run(): void; destructive?: boolean }> = [
    { key: "r", label: "Rename", icon: Pencil, run: onRenameStart },
    ...(archived
      ? []
      : [{ key: "p", label: session.pinnedAt ? "Unpin" : "Pin to top", icon: session.pinnedAt ? PinOff : Pin, run: () => actions.setPinned(session, !session.pinnedAt) }]),
    ...(canFinish
      ? [{ key: "f", label: finished ? "Mark as in progress" : "Mark as finished", icon: finished ? RotateCcw : CircleCheck, run: () => actions.setFinished(session, !finished) }]
      : []),
    { key: "a", label: archived ? "Restore" : "Archive", icon: archived ? ArchiveRestore : Archive, run: () => actions.setArchived(session, !archived) },
    { key: "d", label: "Delete…", icon: Trash2, run: onRequestDelete, destructive: true },
  ];

  /* Pin and file, the two that are one click on the row rather than two through a
     menu. Everything else stays in the menu: shelf position is worth an icon,
     renaming and deleting are not — and three icons is already the most a row
     this narrow can show without becoming a toolbar. */
  const quick = [
    ...(archived ? [] : [{ label: session.pinnedAt ? "Unpin" : "Pin to top", icon: session.pinnedAt ? PinOff : Pin, run: () => actions.setPinned(session, !session.pinnedAt) }]),
    { label: archived ? "Restore" : "Archive", icon: archived ? ArchiveRestore : Archive, run: () => actions.setArchived(session, !archived) },
  ];

  if (renaming) return <RenameRow onCancel={onRenameEnd} onCommit={(title) => { actions.rename(session, title); onRenameEnd(); }} session={session} />;

  /** Asking for the menu withdraws the peek. Both open off the same row, so the
   *  two of them up at once is two panels fighting over one anchor — and once the
   *  menu has been dismissed the pointer has to leave and come back before the
   *  peek is offered again, rather than springing up in the menu's place. */
  const openMenu = (next: boolean) => {
    setOpen(next);
    if (next) setPeeking(false);
  };

  return (
    <HoverCard closeDelay={90} onOpenChange={setPeeking} open={peeking && !open} openDelay={420}>
      <HoverCardTrigger asChild>
        <div
          className="sidebar-row group/session relative"
          onContextMenu={(event) => { event.preventDefault(); openMenu(true); }}
          // The cluster is absolute, so the gutter it needs has to be stated: one
          // slot per quick action plus the ⋮, and the inset it sits in.
          style={{ "--sidebar-controls-width": `calc(${quick.length + 1} * 1.5rem + 0.7rem)` } as CSSProperties}
        >
          <button
            className={cn(
              ROW,
              /* Solid ink at regular weight: a title is the one thing in the list
                 you actually read word by word, so it gets the full value and
                 leaves being-chrome to the medium rows above it. Archived is still
                 dimmed, because filed-away is a state of the session rather than a
                 rank in the list — but not so far down that reading it is work. */
              "text-foreground",
              active ? "bg-[var(--sidebar-accent-active)]" : "hover:bg-[var(--sidebar-accent)]",
              archived && !active && "text-foreground/60",
            )}
            onClick={onOpen}
            type="button"
          >
            <RowTitle>{session.title}</RowTitle>
          </button>

          {/* No `flex` utility here: display is CSS's to own, because it is the
              thing hover toggles, and a utility-layer `display` would outrank the
              rule that hides the cluster at rest. */}
          <div
            className="absolute right-1 top-1/2 -translate-y-1/2 items-center gap-px"
            data-open={open}
            data-row-controls
          >
            {quick.map((action) => (
              <button
                key={action.label}
                aria-label={`${action.label}: ${session.title}`}
                className={ICON_BUTTON}
                onClick={action.run}
                title={action.label}
                type="button"
              >
                <action.icon className={ROW_ICON} />
              </button>
            ))}

            <DropdownMenu modal={false} onOpenChange={openMenu} open={open}>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Options for ${session.title}`}
                  className={cn(ICON_BUTTON, open && "bg-[var(--sidebar-accent-active)] text-foreground")}
                  type="button"
                >
                  <EllipsisVertical className={ROW_ICON} />
                </button>
              </DropdownMenuTrigger>
              {/* The letters are real: Radix would otherwise spend them on typeahead,
                  which moves the highlight and leaves the hint lying about what it does. */}
              <DropdownMenuContent
                align="start"
                className="min-w-[11.5rem]"
                onKeyDown={(event) => {
                  if (event.metaKey || event.ctrlKey || event.altKey) return;
                  const item = items.find((entry) => entry.key === event.key.toLowerCase());
                  if (!item) return;
                  event.preventDefault();
                  setOpen(false);
                  item.run();
                }}
                side="right"
              >
                {items.map((item) => (
                  <Fragment key={item.key}>
                    {item.destructive && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={item.run} variant={item.destructive ? "destructive" : "default"}>
                      <item.icon />
                      <span className="flex-1">{item.label}</span>
                      <kbd className="font-sans text-ui-sm text-muted-foreground/60 uppercase">{item.key}</kbd>
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </HoverCardTrigger>

      {/* Unmounted while the menu is up rather than only closed, so there is no
          panel left to animate out over the menu that replaced it.

          Not hoverable either: there is nothing in it to click, and a panel that
          kept itself alive under the pointer would swallow clicks on the page it
          is floating over. */}
      {!open && (
        <HoverCardContent align="start" className="pointer-events-none w-[18.5rem]" side="right" sideOffset={10}>
          <SessionPeek session={session} />
        </HoverCardContent>
      )}
    </HoverCard>
  );
}

/**
 * A sidebar title that fades where it runs out of room, and walks the rest of
 * itself past the fade while its row is hovered.
 *
 * Both need the same measurement — how much of the title does not fit — and it
 * has to be taken live: the width changes when the sidebar is dragged, when the
 * hover controls claim their gutter, and when the title is renamed. The clipped
 * flag and the travel are handed to CSS, which owns the hover state; see
 * `.sidebar-title` in theme.css.
 */
function RowTitle({ children }: { children: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const box = viewport.current;
    const inner = text.current;
    if (!box || !inner) return;
    const measure = () => {
      const hidden = inner.scrollWidth - box.clientWidth;
      // Sub-pixel layout leaves a fraction over on titles that do fit, and a row
      // that marquees by half a pixel is a row that twitches under the cursor.
      setOverflow(hidden > 1 ? hidden : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [children]);

  /* Travel is the hidden part plus the fade, so the last character ends up clear
     of the gradient rather than arriving inside it. Pace is constant — a long
     title takes longer than a short one instead of moving faster — with a floor
     so a two-word overrun is not a flick. */
  const travel = overflow + TITLE_FADE;
  const seconds = Math.min(9, Math.max(2.6, travel / 38 + 1.4));

  return (
    <span
      ref={viewport}
      className="sidebar-title text-left"
      data-clipped={overflow > 0}
      style={overflow > 0 ? ({ "--sidebar-title-shift": `-${travel}px`, "--sidebar-title-duration": `${seconds}s` } as CSSProperties) : undefined}
    >
      <span ref={text}>{children}</span>
    </span>
  );
}

/** Width of the gradient that hides the overrun, matching `--sidebar-title-fade`. */
const TITLE_FADE = 26;

/**
 * What the row could not say in one line: where the session got to, and what it
 * has actually been doing.
 *
 * This is what the native tooltip on the row used to be. A tooltip could only
 * repeat the title and a timestamp, which is the one thing the fade and the
 * marquee already cover — so the space is spent on the numbers you would open the
 * session to find out.
 */
function SessionPeek({ session }: { session: SessionSummary }) {
  const questions = session.questionTitles;
  const done = questions.filter((question) => question.status === "completed").length;
  // The focus is what the agent settled on; the goal is only the stand-in from
  // before it had.
  const focus = session.currentFocus.join(" · ") || session.objective || session.originalGoal;
  const meta = [
    STATUS_COPY[session.status],
    session.archivedAt ? "archived" : null,
    relativeTime(session.updatedAt),
    session.totalSeconds > 0 ? formatDuration(session.totalSeconds) : null,
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-ui leading-snug font-medium text-foreground">{session.title}</p>
        <p className="text-ui-sm text-muted-foreground/75">{meta.join(" · ")}</p>
      </div>

      {focus && <p className="line-clamp-2 text-ui-sm leading-[1.5] text-muted-foreground">{focus}</p>}

      {questions.length > 0 ? (
        <div className="space-y-1.5 border-t border-border/60 pt-2">
          <div className="flex items-baseline justify-between text-ui-sm">
            <span className="text-muted-foreground/70">Challenges</span>
            <span className="tabular-nums text-foreground/80">{done}/{questions.length} evaluated</span>
          </div>
          <Meter animate={false} bands={challengeBands(questions)} height="0.1875rem" />
          {/* Newest first, and only three: this is a glance, and the whole list is
              one click away in the session itself.

              The one the learner has open is marked in place rather than named
              again underneath. It is nearly always the newest challenge, so a
              line for it repeated the row directly above it word for word. */}
          <ul className="space-y-0.5 pt-0.5">
            {questions.slice(-3).reverse().map((question) => {
              const live = question.id === session.activeQuestion?.id;
              return (
                <li key={question.id} className={cn("flex items-center gap-1.5 text-ui-sm", live ? "text-foreground/85" : "text-muted-foreground")}>
                  {/* One slot whichever mark goes in it, so the titles keep a
                      single left edge down the list. */}
                  <span className="grid size-3 shrink-0 place-items-center">
                    {live ? (
                      <Target className="size-3 text-foreground/70" />
                    ) : (
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          question.status === "completed" ? "bg-[var(--success)]" : "bg-muted-foreground/40",
                        )}
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{question.title}</span>
                  {live && <span className="shrink-0 text-muted-foreground/60">open</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="border-t border-border/60 pt-2 text-ui-sm text-muted-foreground/70">
          No challenges compiled yet — the agent is still working out what to set.
        </p>
      )}
    </div>
  );
}

/** Renaming happens in place. Enter and blur commit, Escape restores the old
 *  title — a dialog for one short string would be more ceremony than the edit. */
function RenameRow({ session, onCommit, onCancel }: { session: SessionSummary; onCommit(title: string): void; onCancel(): void }) {
  const input = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  /* Claimed twice: the menu that opened this row unmounts in the same commit, and
     the focus its overlay hands back can land after the first attempt. */
  useLayoutEffect(() => {
    const claim = () => {
      if (document.activeElement === input.current) return;
      input.current?.focus();
      input.current?.select();
    };
    claim();
    const frame = requestAnimationFrame(claim);
    return () => cancelAnimationFrame(frame);
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const value = input.current?.value.trim() ?? "";
    if (value && value !== session.title) onCommit(value);
    else onCancel();
  };

  return (
    <div className={cn(ROW, "bg-[var(--sidebar-accent-active)] text-foreground")}>
      <input
        ref={input}
        aria-label="Session title"
        className="min-w-0 flex-1 bg-transparent text-source outline-none"
        defaultValue={session.title}
        maxLength={80}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") { committed.current = true; onCancel(); }
        }}
      />
    </div>
  );
}

/** Deleting is the one option with nothing behind it afterwards, so it says what
 *  goes and what survives before it runs. */
function DeleteSessionDialog({ session, onConfirm, onCancel }: { session: SessionSummary | null; onConfirm(): void; onCancel(): void }) {
  const challenges = session?.questionTitles.length ?? 0;

  return (
    <Dialog onOpenChange={(next) => { if (!next) onCancel(); }} open={!!session}>
      <DialogContent className="sm:max-w-[27rem]">
        <DialogHeader>
          <DialogTitle>Delete this session?</DialogTitle>
          <DialogDescription>
            {session?.title} loses {challenges ? `its ${challenges} ${challenges === 1 ? "challenge" : "challenges"}, the attempt evidence behind them,` : "its planning history"} and its workspace files, on this device and in the cloud. What Spar already learned about your abilities is kept. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} variant="secondary">Cancel</Button>
          <Button onClick={onConfirm} variant="destructive">Delete permanently</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StatusDot({ status }: { status: SessionSummary["status"] }) {
  const tone =
    status === "completed"
      ? "bg-[var(--success)]"
      : status === "active"
        ? "bg-[var(--foreground)]/70"
        : status === "planning"
          ? "bg-[var(--warning)]"
          : "bg-muted-foreground/45";
  return (
    <span className="grid size-3.5 shrink-0 place-items-center">
      {status === "completed" ? (
        <Check className="size-3 text-[var(--success)]" />
      ) : (
        <span className={cn("size-1.5 rounded-full", tone)} />
      )}
    </span>
  );
}
