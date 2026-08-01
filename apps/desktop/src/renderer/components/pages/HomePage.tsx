import { useState } from "react";
import { BrainCircuit, Clock3, Flame, Target } from "lucide-react";
import type { SessionSummary } from "@spar/domain";
import type { BootstrapData } from "../../../shared/api";
import { Composer, ComposerPill } from "../agent/Composer";
import { ComposerModelPicker } from "../agent/ModelPicker";
import { SessionCard } from "../common/SessionCard";
import { formatDuration } from "@/lib/format";

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 shadow-[var(--app-shadow-card)]">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--color-background-elevated-secondary)] text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-content font-semibold tabular-nums leading-tight">{value}</p>
        <p className="truncate text-ui-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function HomePage({
  data,
  busy,
  onStart,
  onOpen,
  onOpenSettings,
}: {
  data: BootstrapData;
  busy: boolean;
  onStart(goal: string): void;
  onOpen(session: SessionSummary): void;
  onOpenSettings?(): void;
}) {
  const [goal, setGoal] = useState("");
  const firstName = data.account?.displayName.split(" ")[0] ?? "there";
  const active = data.sessions.filter((session) => session.status !== "completed");
  const completedQuestions = data.sessions.reduce((total, session) => total + session.completedQuestions, 0);
  const totalSeconds = data.sessions.reduce((total, session) => total + session.totalSeconds, 0);

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[52rem] px-6 pb-16 pt-10">
        <h1 className="text-[1.65rem] font-semibold tracking-[-0.03em]">
          {greeting()}, {firstName}.
        </h1>
        <p className="mt-1 text-content text-muted-foreground">
          Describe what you want to get better at. The agent reads your evidence before it picks a target.
        </p>

        <Composer
          className="mt-5"
          busy={busy}
          hint="The agent retrieves your history, declares one training target, then compiles a runnable challenge."
          leading={
            <ComposerPill icon={Target}>
              {active.length ? `${active.length} open ${active.length === 1 ? "session" : "sessions"}` : "New session"}
            </ComposerPill>
          }
          onChange={setGoal}
          onSubmit={() => {
            const value = goal.trim();
            if (!value) return;
            setGoal("");
            onStart(value);
          }}
          placeholder="I want to understand graph algorithms deeply…"
          trailing={<ComposerModelPicker {...(onOpenSettings ? { onOpenSettings } : {})} />}
          value={goal}
        />

        {data.sessions.length > 0 && (
          <div className="mt-6 grid grid-cols-3 gap-2.5">
            <Stat icon={Flame} label={active.length === 1 ? "session open" : "sessions open"} value={String(active.length)} />
            <Stat icon={BrainCircuit} label="challenges completed" value={String(completedQuestions)} />
            <Stat icon={Clock3} label="time practising" value={formatDuration(totalSeconds)} />
          </div>
        )}

        {data.sessions.length > 0 && (
          <>
            <div className="mt-8 mb-3 flex items-baseline justify-between">
              <h2 className="text-content font-semibold tracking-tight">Continue</h2>
              <span className="text-ui-sm text-muted-foreground">{data.sessions.length} total</span>
            </div>
            <div className="grid grid-cols-2 items-start gap-2.5">
              {data.sessions.slice(0, 6).map((session) => (
                <SessionCard key={session.id} session={session} onOpen={() => onOpen(session)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
