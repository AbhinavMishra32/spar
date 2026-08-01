import { Check, Command, History, LayoutGrid, Map, PanelLeftClose, Plus, Settings, Waypoints } from "lucide-react";
import type { SessionSummary } from "@pracai/domain";
import type { BootstrapData } from "../../../shared/api";
import { cn } from "@/lib/utils";
import { initials, relativeTime } from "@/lib/format";

export type Page = "home" | "sessions" | "ability" | "history" | "settings" | "workspace";

const NAV: Array<{ id: Page; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "home", label: "Home", icon: Waypoints },
  { id: "sessions", label: "Sessions", icon: LayoutGrid },
  { id: "ability", label: "Ability map", icon: Map },
  { id: "history", label: "History", icon: History },
];

const ROW =
  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-ui font-normal transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

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
  onPage(page: Page): void;
  onOpenSession(session: SessionSummary): void;
  onNewSession(): void;
  onCommandPalette(): void;
  onCollapse(): void;
}) {
  const recent = sessions.slice(0, 8);

  return (
    <aside className="app-drag app-vibrant hairline-r flex h-full w-[228px] flex-col">
      {/* Clears the native traffic lights, and carries the collapse control. */}
      <div className="flex h-[38px] shrink-0 items-center justify-end px-2.5">
        <button
          className="app-no-drag grid size-6 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
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
          <span className="flex-1 text-left">New session</span>
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
        {recent.length > 0 && (
          <>
            <SectionLabel>Recent</SectionLabel>
            <div className="space-y-0.5">
              {recent.map((session) => (
                <button
                  key={session.id}
                  className={cn(
                    ROW,
                    activeSessionId === session.id
                      ? "bg-[var(--sidebar-accent-active)] text-foreground"
                      : "text-foreground/80 hover:bg-[var(--sidebar-accent)]",
                  )}
                  onClick={() => onOpenSession(session)}
                  title={`${session.title} · ${relativeTime(session.updatedAt)}`}
                  type="button"
                >
                  <StatusDot status={session.status} />
                  <span className="min-w-0 flex-1 truncate text-left">{session.title}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="app-no-drag border-t border-[var(--sidebar-border)] p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 px-1 text-ui-sm text-muted-foreground/80">
          <span
            className={cn(
              "size-1.5 rounded-full",
              syncState === "synced" ? "bg-[var(--success)]" : syncState === "pending" ? "bg-[var(--warning)]" : "bg-muted-foreground/50",
            )}
          />
          {syncState === "synced" ? "Cloud synced" : syncState === "pending" ? "Syncing…" : "Local checkpoint"}
        </div>
        <button
          className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-[var(--sidebar-accent)]"
          onClick={() => onPage("settings")}
          type="button"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-background-elevated-secondary)] text-ui-sm font-semibold">
            {initials(account.displayName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui font-medium">{account.displayName}</span>
            <span className="block truncate text-ui-sm text-muted-foreground/75">{account.email}</span>
          </span>
          <Settings className="size-3.5 shrink-0 text-muted-foreground/70" />
        </button>
      </div>
    </aside>
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
