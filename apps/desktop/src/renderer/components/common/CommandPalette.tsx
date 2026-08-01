import { History, LayoutGrid, Map, Plus, Settings, Waypoints } from "lucide-react";
import type { SessionSummary } from "@spar/domain";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { relativeTime } from "@/lib/format";
import type { Page } from "../shell/Sidebar";

export function CommandPalette({
  open,
  sessions,
  onOpenChange,
  onPage,
  onOpenSession,
  onNewSession,
}: {
  open: boolean;
  sessions: SessionSummary[];
  onOpenChange(open: boolean): void;
  onPage(page: Page): void;
  onOpenSession(session: SessionSummary): void;
  onNewSession(): void;
}) {
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search sessions or jump to a view…" />
      <CommandList className="max-h-[22rem]">
        <CommandEmpty>Nothing matches that.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(onNewSession)} value="new session create start">
            <Plus />
            New session
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        {sessions.length > 0 && (
          <CommandGroup heading="Sessions">
            {sessions.map((session) => (
              <CommandItem
                key={session.id}
                onSelect={() => run(() => onOpenSession(session))}
                value={`${session.title} ${session.originalGoal}`}
              >
                <LayoutGrid />
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                <CommandShortcut>{relativeTime(session.updatedAt)}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => run(() => onPage("home"))} value="home dashboard">
            <Waypoints />
            Home
          </CommandItem>
          <CommandItem onSelect={() => run(() => onPage("sessions"))} value="sessions list">
            <LayoutGrid />
            Sessions
          </CommandItem>
          <CommandItem onSelect={() => run(() => onPage("ability"))} value="ability map concepts">
            <Map />
            Ability map
          </CommandItem>
          <CommandItem onSelect={() => run(() => onPage("history"))} value="history attempts">
            <History />
            History
          </CommandItem>
          <CommandItem onSelect={() => run(() => onPage("settings"))} value="settings provider preferences">
            <Settings />
            Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
