import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Archive, ArchiveRestore, ArrowRight, Check, ChevronRight, CircleCheck, Command, EllipsisVertical, Eye, History, Library, Loader2, Pencil, Pin, PinOff, Plus, RotateCcw, Settings, Target, Trash2, Waypoints } from "lucide-react";
import type { ChallengeHistorySummary, Language, SessionSummary, Track } from "@spar/domain";
import type { BootstrapData } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { formatDuration, initials, relativeTime } from "@/lib/format";
import { challengeBands } from "@/lib/progress";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Meter } from "@/components/ui/meter";
import { NavButtons } from "./NavButtons";
import { SparWordmark } from "../common/SparWordmark";
import { LanguageGlyph } from "../common/LanguageGlyph";
import { ProblemEmblem } from "../problems/ProblemEmblem";
import { SidebarGlyph } from "./NavIcons";
import type { AgentRun } from "../agent/agentRun";

/* "challenge" is one challenge opened from History or Problems. Like
   "workspace" it draws its own toolbar and is not a destination in the nav; the
   parent destination is kept by App so Back returns to the surface it came from. */
export type Page = "home" | "baseline" | "tracks" | "track" | "history" | "problems" | "visualizer" | "sessions" | "ability" | "challenges" | "challenge" | "settings" | "workspace";

/** What the sidebar can do to a session. Every one of these is a write the main
 *  process owns, so the row reports intent and never edits its own copy. */
export type SessionActions = {
  rename(session: SessionSummary, title: string): void;
  setPinned(session: SessionSummary, pinned: boolean): void;
  setArchived(session: SessionSummary, archived: boolean): void;
  setFinished(session: SessionSummary, finished: boolean): void;
  remove(session: SessionSummary): void;
};

/* Tracks are not in here. A Track is a container for sessions, not a
   destination beside them — so it heads its own group in the list below, over
   the sessions it holds, and the page that shows one is reached by opening
   it. A nav row for "Tracks" and a list of tracks underneath said the same thing
   twice, and only one of them could tell you what was in them. */
const NAV: Array<{ id: Page; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  /* One row, because there is one page. What to do next and how the record
     stands were two destinations that each needed the other to make sense — see
     `HomePage`. */
  { id: "home", label: "Home", icon: Waypoints },
  { id: "problems", label: "Problems", icon: Library },
  /* Below Problems, which is the order of the work: you pick something to solve,
     then you go and look at how it runs. Putting it under the surface it is
     opened from also keeps it out of the first rows, where the daily loop lives. */
  { id: "visualizer", label: "Visualize", icon: Eye },
  { id: "history", label: "History", icon: History },
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

   450, which is a real cut of the system face and not a synthesised one — worth
   saying because `font-synthesis: none` is set globally, so a weight without a cut
   would silently render as Regular. This used to be 400, and the note against
   raising it was half right: it argued that medium would say, wrongly, that the
   fixed rows outrank the session titles, and that a sidebar of semibold rows reads
   as an app shouting its own navigation. Both still hold — of 400/450/500/600
   rendered side by side, 600 is exactly that shout, and 500 collides with the
   `font-medium` the session titles carry below.

   450 is the step that does not. It is visibly heavier than the surrounding chrome
   while still sitting under the session titles, so the ranking the old note was
   protecting survives; it just no longer costs the rows their presence. The part of
   that argument that was simply correct stays correct: the labels are solid
   foreground, never an alpha fraction, because this sidebar is glass and alpha text
   composites against the desktop twice and arrives grey however dark the token was. */
const ROW =
  "flex h-[1.875rem] w-full items-center gap-2 rounded-lg px-2.5 text-source font-[450] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

/** Nav and row glyphs. Set against the label rather than chosen for its own sake:
 *  a source list wants the icon a little larger than the cap height it sits
 *  beside, or the label starts to look like it is dragging the icon along.
 *
 *  Solid foreground, for the reason the label above is solid too: this sidebar is
 *  glass, so an alpha fraction composites against the desktop twice and arrives
 *  grey however dark the token behind it was. That was already the argument for
 *  moving these off 55%, and 70% was just a smaller dose of the same problem — a
 *  16px line drawing has less stroke to spare than a glyph does, so it lost more.
 *  Rank rows by fill and colour, never by thinning the ink. */
const ROW_ICON = "size-4 shrink-0";
const ROW_ICON_TONE = "text-foreground";

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
  challenges,
  sessions,
  runs,
  tracks,
  activeTrackId,
  activeSessionId,
  syncState,
  sessionActions,
  onPage,
  onOpenSession,
  onOpenTrack,
  onNewTrack,
  onNewSession,
  onCommandPalette,
  onCollapse,
  nav,
}: {
  page: Page;
  account: NonNullable<BootstrapData["account"]>;
  /** Where the window has been. The arrows live up here with the window
   *  controls, which is where the platform puts them. */
  nav: { canBack: boolean; canForward: boolean; onBack(): void; onForward(): void };
  /** Challenge history, read only for what each live challenge is about, so the
   *  mark on a session row is the same mark that challenge wears in Problems
   *  rather than a second, private drawing of the same problem. */
  challenges: ChallengeHistorySummary[];
  /** Every session the learner has, across every Track. The sidebar does the
   *  grouping now — it is the thing drawing the groups. */
  sessions: SessionSummary[];
  /** Live agent turns keyed by the session that owns them. */
  runs: Record<string, AgentRun>;
  tracks: Track[];
  activeTrackId?: string | undefined;
  activeSessionId?: string | undefined;
  syncState: BootstrapData["syncState"];
  sessionActions: SessionActions;
  onPage(page: Page): void;
  onOpenSession(session: SessionSummary): void;
  onOpenTrack(track: Track): void;
  onNewTrack(): void;
  onNewSession(): void;
  onCommandPalette(): void;
  onCollapse(): void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  /* Which Tracks the learner has opened in the list. Only their explicit choices live here;
     the Track being worked in is open because it is the Track being worked in,
     which is why that is read off `activeTrackId` rather than seeded into state
     — seeding it would mean a Track you deliberately closed springs back open
     the next time the shell re-reads. */
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  // The store already sorts pinned first, then by last touched; the sidebar only
  // has to say where one group stops and the next starts.
  const shelved = sessions.filter((session) => session.archivedAt);
  const live = sessions.filter((session) => !session.archivedAt);
  /* A session belongs to its Track's group, and only what is left over reaches
     the flat lists underneath — otherwise every title would be in the sidebar
     twice, once under its Track and once under Recent. A `trackId` naming a Track
     that is not in the list counts as loose rather than disappearing. */
  const known = new Set(tracks.map((track) => track.id));
  const loose = live.filter((session) => !session.trackId || !known.has(session.trackId));
  const pinned = loose.filter((session) => session.pinnedAt);
  const recent = loose.filter((session) => !session.pinnedAt).slice(0, RECENT_LIMIT);
  /* The open session keeps its row whatever else is true of it. Archiving or
     finishing the session you are working in is the ordinary way to file it away,
     and the row disappearing from under the cursor while its workspace is still
     on screen reads as having lost the thing rather than having tidied it. */
  const shown = new Set([...live.filter((session) => session.trackId && known.has(session.trackId)), ...pinned, ...recent, ...(showArchived ? shelved : [])].map((session) => session.id));
  const stranded = activeSessionId && !shown.has(activeSessionId) ? sessions.find((session) => session.id === activeSessionId) : undefined;

  /* What each live challenge is about, keyed by the question it is. One pass over
     history rather than a lookup per row, and the first concept is the one the
     challenge was aimed at. */
  const subjects: Record<string, string> = Object.fromEntries(challenges.map((challenge) => [challenge.id, challenge.concepts[0]?.title ?? ""]));

  /* What each session is being written in. Keyed by session rather than by
     challenge, and taken from the session's latest challenge, so a session
     between challenges keeps its mark instead of losing it for as long as Spar is
     setting the next one. History arrives newest first; the first hit for a
     session is therefore the one to keep. */
  const languages: Record<string, Language> = {};
  for (const challenge of challenges) languages[challenge.sessionId] ??= challenge.language;

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
      working={runs[session.id]?.status === "streaming"}
      session={session}
      {...(languages[session.id] ? { language: languages[session.id]! } : {})}
      subject={(session.activeQuestion ? subjects[session.activeQuestion.id] : "") || session.currentFocus[0] || ""}
    />
  );

  return (
    <aside className="app-sidebar app-drag flex h-full w-full flex-col">
      {/* Clears the native traffic lights, and carries the collapse control. The leading
          inset is the shared chrome token rather than a hand-measured margin, so the
          wordmark keeps its clearance if the button metrics ever move. */}
      <div className="flex h-[var(--titlebar-height)] shrink-0 items-center pl-[max(0.625rem,var(--window-controls-leading))] pr-2">
        <SparWordmark className="text-[1.1rem] text-foreground" />
        <NavButtons canBack={nav.canBack} canForward={nav.canForward} className="ml-auto" onBack={nav.onBack} onForward={nav.onForward} />
        <button
          /* `rounded-md` rather than `rounded-lg`: the one control on the
             trailing edge of the title row was shaped unlike every other 28px
             control in the window. */
          className="app-no-drag grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
          onClick={onCollapse}
          title="Hide sidebar  ⌘B"
          type="button"
        >
          <SidebarGlyph />
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
              page === id || (id === "home" && (page === "baseline" || page === "ability")) || (id === "history" && page === "challenge")
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
        {tracks.length > 0 && (
          <>
            <SectionLabel
              action={
                <button
                  aria-label="Start a Track"
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground"
                  onClick={onNewTrack}
                  title="Start a Track"
                  type="button"
                >
                  <Plus className="size-3.5" />
                </button>
              }
            >
              Tracks
            </SectionLabel>
            <div className="space-y-0.5">
              {tracks.map((track) => (
                <TrackGroup
                  key={track.id}
                  onOpen={() => onOpenTrack(track)}
                  onToggle={() => setOpened((value) => ({ ...value, [track.id]: !(value[track.id] ?? activeTrackId === track.id) }))}
                  open={opened[track.id] ?? activeTrackId === track.id}
                  track={track}
                >
                  {(() => {
                    const inside = live.filter((session) => session.trackId === track.id);
                    /* An empty Track says so rather than opening onto nothing —
                       a Track with no sessions yet is the ordinary state of one
                       just started, and a blank gap reads as a bug. */
                    return inside.length ? inside.map(row) : <p className="px-2.5 py-1 text-source-sm text-muted-foreground">No sessions yet</p>;
                  })()}
                </TrackGroup>
              ))}
            </div>
          </>
        )}

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
/**
 * A Track in the source list, with its sessions under it.
 *
 * The whole header toggles, and toggling is all it does. Opening a Track to see
 * what is in it is not the same act as going to it — the first is looking, the
 * second is moving, and a row that did both meant you could not glance inside a
 * Track without leaving the one you were in. Going to a Track is what clicking a
 * session in it does, and the arrow on the right is there for the Track's own
 * page.
 *
 * Radix rather than a bare conditional, for the height it measures: an accordion
 * that pops open has no relationship between the row you clicked and the rows
 * that appeared, and on a list where several can be open at once that is the
 * difference between the list re-laying-out and the list answering you.
 */
function TrackGroup({
  track,
  open,
  onToggle,
  onOpen,
  children,
}: {
  track: Track;
  open: boolean;
  onToggle(): void;
  onOpen(): void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible onOpenChange={onToggle} open={open}>
      {/* No selection fill on the Track itself. The session inside it is the thing
          that is open, and lighting both made two rows look chosen when only one
          was — the Track row is a heading, and a heading does not get selected
          along with its contents. */}
      <div className={cn(ROW, "group/track gap-1 pl-1 pr-1 hover:bg-[var(--sidebar-accent)]")}>
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1 text-left outline-none" type="button">
          {/* No glyph beyond the disclosure. Every mark tried beside it — a
              folder, the Track target — claimed the Track was a kind of thing it
              is not. A source list names its groups and leaves icons to items. */}
          <span className="grid size-5 shrink-0 place-items-center text-muted-foreground">
            <ChevronRight className={cn("size-3.5 transition-transform duration-200 ease-out", open && "rotate-90")} />
          </span>
          <span className="min-w-0 flex-1 truncate">{track.title}</span>
        </CollapsibleTrigger>
        {/* The Track's own page, which is a different place from its sessions.
            Hidden until the row is under the pointer, like the controls on a
            session row: it is the rarer of the two things you want from a Track,
            and a permanent chevron on every row is a second column of chrome. */}
        <button
          aria-label={`Open ${track.title}`}
          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/track:opacity-100 focus-visible:opacity-100 hover:text-foreground"
          onClick={onOpen}
          title={`Open ${track.title}`}
          type="button"
        >
          <ArrowRight className="size-3.5" />
        </button>
      </div>
      {/* Indented to the Track's own text column, so the titles inside line up
          under the name of the thing holding them. */}
      <CollapsibleContent>
        <div className="mt-0.5 space-y-0.5 pl-[0.875rem]">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SessionRow({
  session,
  language,
  subject,
  active,
  renaming,
  working,
  actions,
  onOpen,
  onRenameStart,
  onRenameEnd,
  onRequestDelete,
}: {
  session: SessionSummary;
  /** What the session is written in. Absent only before its first challenge
   *  exists, which is the one case with nothing to name. */
  language?: Language | undefined;
  subject: string;
  active: boolean;
  renaming: boolean;
  working: boolean;
  actions: SessionActions;
  onOpen(): void;
  onRenameStart(): void;
  onRenameEnd(): void;
  onRequestDelete(): void;
}) {
  const [open, setOpen] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const archived = !!session.archivedAt;
  /* The row says what you are working on, not what the folder holding it is
     called. A session's title is written once, when it is created, and stops
     being true the moment Spar sets the next challenge — whereas the challenge
     is the thing you left the app in the middle of and came back for. The
     session's own title is still one hover away, in the peek. */
  const label = session.activeQuestion?.title ?? session.title;
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
            title={session.activeQuestion ? `${session.activeQuestion.title} — ${session.title}` : session.title}
            type="button"
          >
            {/* The language's own mark, in its own colour. The generated emblem
                that was here is a good identity for a problem — it is what the
                challenge wears in Problems and in its own header — but a source
                list is read down a column, and a column of procedurally different
                shapes is a column with no shared vocabulary in it: nothing about
                the ring beside one session tells you anything about the next.
                Which language you are in is the one fact that does, and it is the
                only colour in this sidebar, so it reads as information rather than
                as decoration.

                Sized to the emblem it replaces so the text column does not move,
                and a session with no challenge yet keeps the emblem rather than a
                gap — alignment down the list matters more than which of the two
                marks a not-yet-started session wears. */}
            {language ? (
              <LanguageGlyph className="size-[17px] shrink-0" language={language} />
            ) : (
              <ProblemEmblem
                detail={false}
                seed={`spar:${session.activeQuestion?.id ?? session.id}`}
                size={17}
                strong
                subject={subject}
              />
            )}
            <RowTitle>{label}</RowTitle>
            {working && (
              <Loader2
                aria-label="Agent working"
                className="ml-auto size-3.5 shrink-0 animate-spin text-muted-foreground transition-opacity motion-reduce:animate-none group-hover/session:opacity-0 group-focus-within/session:opacity-0"
                role="status"
              />
            )}
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
