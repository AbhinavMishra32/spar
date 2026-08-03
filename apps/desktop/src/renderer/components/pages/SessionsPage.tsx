import { useMemo, useState } from "react";
import { LayoutGrid, Search } from "lucide-react";
import type { ChallengeHistorySummary, SessionSummary } from "@spar/domain";
import type { SparApi } from "../../../shared/api";
import type { AgentRun } from "../agent/agentRun";
import { EmptyState } from "../common/EmptyState";
import { SessionCard } from "../common/SessionCard";
import { useSessionPreviews } from "../../hooks/use-session-previews";
import { cn } from "@/lib/utils";

type Filter = "all" | "open" | "completed";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "completed", label: "Completed" },
];

export function SessionsPage({
  api,
  sessions,
  challenges,
  runs,
  onOpen,
}: {
  api: SparApi | undefined;
  sessions: SessionSummary[];
  challenges: ChallengeHistorySummary[];
  /** Agent turns in flight, by session. Cards for these report the live work. */
  runs: Record<string, AgentRun>;
  onOpen(session: SessionSummary): void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const previewFor = useSessionPreviews(api, challenges);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sessions.filter((session) => {
      if (filter === "open" && session.status === "completed") return false;
      if (filter === "completed" && session.status !== "completed") return false;
      if (!needle) return true;
      return `${session.title} ${session.originalGoal}`.toLowerCase().includes(needle);
    });
  }, [sessions, filter, query]);

  return (
    <div className="app-scroll h-full overflow-y-auto">
      {/* The same measure the challenge history uses: the two "everything you
          have" pages are siblings, and their cards should be one width. */}
      <div className="mx-auto w-full max-w-[62rem] px-18 pb-16 pt-8">
        <h1 className="text-[1.35rem] font-semibold tracking-[-0.03em]">Sessions</h1>
        <p className="mt-1 text-content text-muted-foreground">
          Durable learning journeys, generated one evidence target at a time.
        </p>

        <div className="mt-5 flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-[var(--color-background-elevated-secondary)] p-0.5">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={cn(
                  "h-6 rounded-md px-2.5 text-ui transition-colors",
                  filter === item.id ? "bg-card text-foreground shadow-[var(--app-shadow-card)]" : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setFilter(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-56">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="h-7 w-full rounded-lg border border-border bg-card pl-7 pr-2 text-ui outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-[var(--border-strong)]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter sessions"
              value={query}
            />
          </div>
        </div>

        {/* One card per row rather than a two-up grid. The card carries a code
            plate on its trailing edge now, and at half this width there is no
            room for one — so the grid would have quietly been a different card. */}
        <div className="mt-4">
          {visible.length ? (
            <div className="flex flex-col gap-2.5">
              {visible.map((session) => (
                <SessionCard
                  key={session.id}
                  onOpen={() => onOpen(session)}
                  preview={previewFor(session.id)}
                  run={runs[session.id] ?? null}
                  session={session}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={LayoutGrid}
              title={sessions.length ? "Nothing matches this filter" : "No sessions yet"}
              description={
                sessions.length
                  ? "Clear the filter or search term to see the rest of your sessions."
                  : "Sessions appear here once you give the agent a learning goal."
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
