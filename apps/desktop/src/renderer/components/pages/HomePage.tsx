import { useMemo, useState } from "react";
import { Target } from "lucide-react";
import type { SessionSummary } from "@spar/domain";
import type { BootstrapData } from "../../../shared/api";
import { formatDuration } from "@/lib/format";
import { Meter, type MeterBand } from "@/components/ui/meter";
import { Composer, ComposerPill } from "../agent/Composer";
import { ComposerModelPicker } from "../agent/ModelPicker";
import { SessionCard } from "../common/SessionCard";

type Question = SessionSummary["questionTitles"][number];

/**
 * The one bar on this page, in a single hue at three weights.
 *
 * Colour here would be claiming a judgement the numbers do not support:
 * abandoning a challenge is not a failure and a challenge still compiling is not
 * a warning. Weight says how settled each part is and nothing more.
 */
function bandsFor(questions: Question[]): MeterBand[] {
  const count = (...statuses: Question["status"][]) =>
    questions.filter((question) => statuses.includes(question.status)).length;

  return [
    { key: "evaluated", value: count("completed"), className: "bg-foreground/70", label: "evaluated" },
    { key: "open", value: count("active", "playable", "generating", "validating"), className: "bg-foreground/28", label: "in flight" },
    { key: "closed", value: count("abandoned", "invalid"), className: "bg-foreground/10", label: "closed" },
  ];
}

/** A number and its unit, sized so the number leads and the unit recedes. */
function Figure({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium tabular-nums text-foreground">{value}</span>{" "}
      <span className="text-muted-foreground">{unit}</span>
    </span>
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
  const questions = useMemo(() => data.sessions.flatMap((session) => session.questionTitles), [data.sessions]);
  const bands = useMemo(() => bandsFor(questions), [questions]);
  const evaluated = bands[0]?.value ?? 0;
  const seconds = data.sessions.reduce((total, session) => total + session.totalSeconds, 0);

  // Recurrence across sessions is the signal worth surfacing: a focus that keeps
  // coming back is one the evidence has not settled. Rendered as prose rather
  // than as ranked bars — five bars for five small integers is a chart pretending
  // there is a distribution to read.
  const focuses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of data.sessions) {
      for (const focus of session.currentFocus) counts.set(focus, (counts.get(focus) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([focus]) => focus);
  }, [data.sessions]);

  // Most recently touched first: the page should open on what you were last
  // doing, not on whatever happened to be created first.
  const recent = useMemo(
    () => [...data.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [data.sessions],
  );

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[56rem] px-6 pb-16 pt-10">
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
          <>
            {/* The whole summary is one line of prose and one hairline. There is
                no per-day history in the model, only a last-touched timestamp per
                session, so there is deliberately no streak or activity chart —
                invented days would be the least trustworthy thing on a page
                whose job is honest progress. */}
            <section className="mt-9">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ui">
                <Figure unit={`of ${questions.length} challenges evaluated`} value={String(evaluated)} />
                <span className="text-muted-foreground/40">·</span>
                <Figure unit={active.length === 1 ? "session open" : "sessions open"} value={String(active.length)} />
                <span className="text-muted-foreground/40">·</span>
                <Figure unit="practising" value={formatDuration(seconds)} />
              </div>

              <Meter bands={bands} className="mt-3" height="0.1875rem" />

              {focuses.length > 0 && (
                <p className="mt-3.5 min-w-0 text-ui leading-[1.7] text-muted-foreground">
                  <span className="text-foreground/70">Working on </span>
                  {focuses.join(" · ")}
                </p>
              )}
            </section>

            <div className="mt-9 mb-3 flex items-baseline justify-between">
              <h2 className="text-content font-semibold tracking-tight">Continue</h2>
              <span className="text-ui-sm text-muted-foreground">{data.sessions.length} total</span>
            </div>
            <div className="grid grid-cols-1 items-start gap-2.5 md:grid-cols-2">
              {recent.slice(0, 6).map((session) => (
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
