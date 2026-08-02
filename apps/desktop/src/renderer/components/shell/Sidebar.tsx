import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Check, ChevronRight, CircleCheck, Command, EllipsisVertical, History, LayoutGrid, Map, PanelLeftClose, Pencil, Pin, PinOff, Plus, RotateCcw, Settings, Trash2, Waypoints } from "lucide-react";
import type { SessionSummary } from "@spar/domain";
import type { BootstrapData } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { initials, relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SparWordmark } from "../common/SparWordmark";

export type Page = "home" | "sessions" | "ability" | "challenges" | "settings" | "workspace";

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

const ROW =
  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-ui font-normal transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

const SYNC: Record<BootstrapData["syncState"], { label: string; tone: string }> = {
  synced: { label: "Cloud synced", tone: "bg-[var(--success)]" },
  pending: { label: "Syncing…", tone: "bg-[var(--warning)]" },
  offline: { label: "Local checkpoint", tone: "bg-muted-foreground/50" },
};

/** Unpinned sessions shown before the list starts asking to be scrolled. */
const RECENT_LIMIT = 8;

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex h-6 items-center justify-between px-2 pt-1">
      <span className="text-ui-sm font-medium text-muted-foreground/70">{children}</span>
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
      <div className="flex h-[var(--titlebar-height)] shrink-0 items-center pl-[max(0.625rem,var(--window-controls-leading))] pr-2.5">
        <SparWordmark className="text-[0.98rem] text-foreground/90" />
        <button
          className="app-no-drag ml-auto grid size-6 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
          onClick={onCollapse}
          title="Hide sidebar  ⌘B"
          type="button"
        >
          <PanelLeftClose className="size-3.5" />
        </button>
      </div>

      <div className="app-no-drag space-y-0.5 px-2.5">
        <button
          className={cn(ROW, "text-foreground/95 hover:bg-[var(--sidebar-accent)]")}
          onClick={onNewSession}
          type="button"
        >
          <Plus className="size-3.5 text-muted-foreground" />
          <span className="flex-1 text-left">Start a session</span>
          <kbd className="font-sans text-ui-sm text-muted-foreground/60">⌘N</kbd>
        </button>
        <button
          className={cn(ROW, "text-foreground/95 hover:bg-[var(--sidebar-accent)]")}
          onClick={onCommandPalette}
          type="button"
        >
          <Command className="size-3.5 text-muted-foreground" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="font-sans text-ui-sm text-muted-foreground/60">⌘K</kbd>
        </button>
      </div>

      <nav className="app-no-drag mt-3 space-y-0.5 px-2.5">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={cn(
              ROW,
              page === id
                ? "bg-[var(--sidebar-accent-active)] text-foreground"
                : "text-foreground/85 hover:bg-[var(--sidebar-accent)]",
            )}
            onClick={() => onPage(id)}
            type="button"
          >
            <Icon className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          </button>
        ))}
      </nav>

      <div className="app-no-drag app-scroll mt-3 min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
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
              className="flex h-6 w-full items-center gap-1 px-2 pt-1 text-ui-sm font-medium text-muted-foreground/70 transition-colors hover:text-foreground"
              onClick={() => setShowArchived((value) => !value)}
              type="button"
            >
              <ChevronRight className={cn("size-3 transition-transform", showArchived && "rotate-90")} />
              Archived
              <span className="tabular-nums text-muted-foreground/50">{shelved.length}</span>
            </button>
            {showArchived && <div className="space-y-0.5">{shelved.map(row)}</div>}
          </>
        )}
      </div>

      {/* One row rather than three. The address under the name repeated what the
          avatar and the name already say, and the sync line spent a whole line of
          chrome on one bit of state — so sync is the status light on the row and
          the words for it live in the tooltip. */}
      <div className="app-no-drag border-t border-[var(--sidebar-border)] p-2.5">
        <button
          className={cn(ROW, "px-1.5 text-foreground/90 hover:bg-[var(--sidebar-accent)]")}
          onClick={() => onPage("settings")}
          title={`${account.displayName} · ${account.email} · ${SYNC[syncState].label}`}
          type="button"
        >
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-background-elevated-secondary)] text-ui-sm font-semibold text-foreground/80">
            {initials(account.displayName)}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{account.displayName}</span>
          <span className={cn("size-1.5 shrink-0 rounded-full", SYNC[syncState].tone)} />
          <Settings className="size-3.5 shrink-0 text-muted-foreground/70" />
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

/**
 * One session in the list, with everything you can do to it behind ⋮ or a
 * right-click on the row.
 *
 * The trigger is only drawn on hover, but the gutter it sits in is reserved
 * permanently: revealing a control that pushes the title it belongs to is worse
 * than truncating four characters earlier all the time.
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

  if (renaming) return <RenameRow onCancel={onRenameEnd} onCommit={(title) => { actions.rename(session, title); onRenameEnd(); }} session={session} />;

  return (
    <div className="group/session relative" onContextMenu={(event) => { event.preventDefault(); setOpen(true); }}>
      <button
        className={cn(
          ROW,
          active
            ? "bg-[var(--sidebar-accent-active)] text-foreground"
            : "text-foreground/80 hover:bg-[var(--sidebar-accent)]",
          archived && !active && "text-foreground/55",
        )}
        onClick={onOpen}
        title={[session.title, archived ? "archived" : null, relativeTime(session.updatedAt)].filter(Boolean).join(" · ")}
        type="button"
      >
        <StatusDot status={session.status} />
        <span className="min-w-0 flex-1 truncate pr-5 text-left">{session.title}</span>
      </button>

      <DropdownMenu modal={false} onOpenChange={setOpen} open={open}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Options for ${session.title}`}
            className={cn(
              "absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-[var(--radius-sm)]",
              "text-muted-foreground/70 opacity-0 transition-opacity hover:bg-[var(--sidebar-accent-active)] hover:text-foreground",
              "focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none group-hover/session:opacity-100",
              open && "bg-[var(--sidebar-accent-active)] text-foreground opacity-100",
            )}
            type="button"
          >
            <EllipsisVertical className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        {/* The letters are real: Radix would otherwise spend them on typeahead,
            which moves the highlight and leaves the hint lying about what it does. */}
        <DropdownMenuContent
          align="start"
          className="min-w-[13rem]"
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
      <StatusDot status={session.status} />
      <input
        ref={input}
        aria-label="Session title"
        className="min-w-0 flex-1 bg-transparent text-ui outline-none"
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
