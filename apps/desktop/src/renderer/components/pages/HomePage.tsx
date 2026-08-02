import { useMemo, useState } from "react";
import { ChevronRight, Target } from "lucide-react";
import type { SessionSummary } from "@spar/domain";
import type { BootstrapData } from "../../../shared/api";
import { formatDuration } from "@/lib/format";
import { challengeBands } from "@/lib/progress";
import { Meter } from "@/components/ui/meter";
import { Composer, ComposerPill } from "../agent/Composer";
import { ComposerModelPicker } from "../agent/ModelPicker";
import { SessionRow } from "../common/SessionRow";

/** How many sessions the dashboard shows before deferring to the sessions page. */
const SHOWN = 6;

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
  onViewAll,
}: {
  data: BootstrapData;
  busy: boolean;
  onStart(goal: string): void;
  onOpen(session: SessionSummary): void;
  onOpenSettings?(): void;
  onViewAll?(): void;
}) {
  const [goal, setGoal] = useState("");
  // The onboarding answer wins over the account's display name: one the learner
  // chose, the other Spar derived from an email address.
  const firstName = (data.profile?.name ?? data.account?.displayName ?? "there").split(" ")[0] || "there";
  const active = data.sessions.filter((session) => session.status !== "completed" && !session.archivedAt);
  const questions = useMemo(() => data.sessions.flatMap((session) => session.questionTitles), [data.sessions]);
  const bands = useMemo(() => challengeBands(questions), [questions]);
  const evaluated = bands[0]?.value ?? 0;
  const seconds = data.sessions.reduce((total, session) => total + session.totalSeconds, 0);

  // Archived sessions are left out — the learner already said they are done
  // reaching for these — but their evidence still counts in the figures above.
  // Held separately from the slice below so the "all" count and the rows are
  // drawn from one population and cannot disagree about how many there are.
  const resumable = useMemo(() => data.sessions.filter((session) => !session.archivedAt), [data.sessions]);

  // Most recently touched first: the page should open on what you were last
  // doing, not on whatever happened to be created first.
  const recent = useMemo(
    () => [...resumable].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, SHOWN),
    [resumable],
  );

  return (
    <div className="app-scroll h-full overflow-y-auto">
      {/* One measure for the whole app: the same 46rem the agent transcript uses,
          so moving between the dashboard and a session does not move the column
          the eye has settled on. */}
      <div className="mx-auto w-full max-w-[46rem] px-8 pb-20 pt-12">
        {/* The greeting is scaffolding and the name is the only part that is
            about you, so the two carry different weight at the same size — a
            smaller word beside a larger one would read as two headings. */}
        <h1 className="text-[1.75rem] font-medium leading-[1.15] tracking-[-0.035em]">
          <span className="text-foreground/40">{greeting()}, </span>
          {firstName}.
        </h1>
        <p className="mt-2 text-content text-muted-foreground">
          Describe what you want to get better at — the agent reads your evidence before it picks today's focus.
        </p>

        {/* No standing hint under the field. It restated the line above it on
            every visit forever; without it the composer falls back to naming
            Return and Shift + Return, which appears only once you are typing and
            is the one thing here you cannot work out by looking. */}
        <Composer
          className="mt-6"
          busy={busy}
          leading={
            active.length ? (
              <ComposerPill icon={Target}>
                {active.length} open {active.length === 1 ? "session" : "sessions"}
              </ComposerPill>
            ) : null
          }
          onChange={setGoal}
          {...(onOpenSettings ? { onOpenSettings } : {})}
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
                whose job is honest progress.

                Open sessions are counted on the composer pill directly above and
                so are not counted a second time here. */}
            <section className="mt-12">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ui">
                <Figure unit={`of ${questions.length} challenges evaluated`} value={String(evaluated)} />
                <span className="text-muted-foreground/55">·</span>
                <Figure unit="practising" value={formatDuration(seconds)} />
              </div>
              <Meter bands={bands} className="mt-3" height="0.1875rem" />
            </section>

            {/* Its own gate rather than the outer one: archive everything and
                the figures above still have years to report, but there is
                nothing left to resume and a bare heading over no rows would be
                the page asking you to do something impossible. */}
            {recent.length > 0 && (
              <section className="mt-10">
                <div className="flex h-5 items-center justify-between">
                  <h2 className="text-ui font-medium text-muted-foreground">Resume sparring</h2>
                  {/* Worth offering only once the list is actually holding some
                      back — otherwise it points at what is already on screen. */}
                  {onViewAll && resumable.length > recent.length && (
                    <button
                      className="group/all -mr-1 inline-flex items-center gap-0.5 rounded px-1 text-ui text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
                      onClick={onViewAll}
                      type="button"
                    >
                      All {resumable.length}
                      <ChevronRight className="size-3 transition-transform group-hover/all:translate-x-0.5 motion-reduce:transition-none" />
                    </button>
                  )}
                </div>

                {/* Cancels the rows' own padding so their text sits on the page's
                    left edge while their hover fill reaches past it. */}
                <div className="-mx-2 mt-1.5">
                  {recent.map((session) => (
                    <SessionRow key={session.id} session={session} onOpen={() => onOpen(session)} />
                  ))}
                </div>
              </section>
            )}
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
