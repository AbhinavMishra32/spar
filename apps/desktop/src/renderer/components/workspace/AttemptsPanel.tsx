import { FileCode2, Flag, MessageSquare, Play, Sparkles, Terminal } from "lucide-react";
import type { SessionDetail } from "@pracai/domain";
import { EmptyState } from "../common/EmptyState";

type Event = SessionDetail["events"][number];

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  attempt_started: Flag,
  file_changed: FileCode2,
  command_executed: Play,
  learner_remark: MessageSquare,
  agent_message: Sparkles,
};

/** A readable summary per event type, falling back to the raw payload. */
function describe(event: Event): string {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === "file_changed") return `${String(payload.path ?? "file")} · ${String(payload.bytes ?? 0)} bytes`;
  if (event.type === "command_executed") return `${String(payload.command ?? "run")} · ${String(payload.language ?? "")}`.trim();
  if (event.type === "learner_remark") return String(payload.body ?? "");
  const rest = JSON.stringify(payload);
  return rest === "{}" ? "" : rest;
}

/**
 * The immutable trace behind the current attempt. This is the evidence the agent
 * reads, so it is shown verbatim rather than summarised away.
 */
export function AttemptsPanel({ events }: { events: Event[] }) {
  if (events.length === 0) {
    return (
      <div className="app-scroll h-full overflow-y-auto p-5">
        <EmptyState
          compact
          description="Editing a file, running the tests, or attaching a remark all append to this attempt's trace."
          icon={Terminal}
          title="Nothing recorded yet"
        />
      </div>
    );
  }

  return (
    <div className="app-scroll h-full overflow-y-auto px-4 py-3">
      <ol className="mx-auto w-full max-w-[46rem] space-y-px">
        {events.map((event) => {
          const Icon = ICONS[event.type] ?? Terminal;
          const detail = describe(event);
          return (
            <li key={event.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50">
              <span className="mt-px grid size-5 shrink-0 place-items-center rounded-md border border-border bg-[var(--color-background-elevated-secondary)] text-muted-foreground">
                <Icon className="size-3" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-ui font-medium">{event.type.replace(/_/g, " ")}</span>
                  <span className="text-ui-sm text-muted-foreground/70">{event.source}</span>
                  <span className="ml-auto shrink-0 font-mono text-ui-sm tabular-nums text-muted-foreground/55">
                    #{event.sequence}
                  </span>
                </span>
                {detail && <span className="mt-0.5 block break-words font-mono text-ui-sm text-muted-foreground">{detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
