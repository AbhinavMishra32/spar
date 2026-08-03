import { useMemo, useState } from "react";
import { ChevronRight, CircleCheck, Clock3, Target } from "lucide-react";
import type { SessionSummary } from "@spar/domain";
import type { BootstrapData, SparApi } from "../../../shared/api";
import { formatDuration } from "@/lib/format";
import { Composer, ComposerPill } from "../agent/Composer";
import { ComposerModelPicker } from "../agent/ModelPicker";
import type { AgentRun } from "../agent/agentRun";
import { ScrollDrum } from "../common/ScrollDrum";
import { SessionCard } from "../common/SessionCard";
import { useSessionPreviews } from "../../hooks/use-session-previews";

/** How many sessions the dashboard holds before deferring to the sessions page.
 *  Higher than it was, because the list now scrolls in place rather than pushing
 *  the page down — but still bounded, since the full history has its own page. */
const SHOWN = 12;

/** Mirrors `createSessionInput` in the main process. Held here so a two-letter
 *  goal keeps the send button off rather than coming back as a rejected IPC. */
const GOAL_MIN_LENGTH = 3;

/** How tall the session drum grows before it starts scrolling. Deliberately not a
 *  whole number of cards: a list that ends exactly on a card boundary looks
 *  finished, and the point of the cut-off row is to say there is more. */
const DRUM_HEIGHT = "21.5rem";

export function HomePage({
  api,
  data,
  busy,
  runs,
  onStart,
  onOpen,
  onOpenSettings,
  onViewAll,
}: {
  api: SparApi | undefined;
  data: BootstrapData;
  busy: boolean;
  /** Agent turns in flight, by session. Cards for these report the live work. */
  runs: Record<string, AgentRun>;
  onStart(goal: string): void;
  onOpen(session: SessionSummary): void;
  onOpenSettings?(): void;
  onViewAll?(): void;
}) {
  const [goal, setGoal] = useState("");
  const previewFor = useSessionPreviews(api, data.challenges);
  // The onboarding answer wins over the account's display name: one the learner
  // chose, the other Spar derived from an email address.
  const firstName = (data.profile?.name ?? data.account?.displayName ?? "there").split(" ")[0] || "there";
  const active = data.sessions.filter((session) => session.status !== "completed" && !session.archivedAt);
  const questions = useMemo(() => data.sessions.flatMap((session) => session.questionTitles), [data.sessions]);
  // "Evaluated" means the deterministic runner returned a verdict, which is
  // exactly `completed` — the same definition the meter's evaluated band used
  // before the bar came off this page.
  const evaluated = useMemo(() => questions.filter((question) => question.status === "completed").length, [questions]);
  const seconds = data.sessions.reduce((total, session) => total + session.totalSeconds, 0);

  // Archived sessions are left out — the learner already said they are done
  // reaching for these — but their evidence still counts in the figures above.
  // Held separately from the slice below so the "all" count and the rows are
  // drawn from one population and cannot disagree about how many there are.
  const resumable = useMemo(() => data.sessions.filter((session) => !session.archivedAt), [data.sessions]);

  // Most recently touched first: the page should open on what you were last
  // doing, not on whatever happened to be created first. A session the agent is
  // working on right now goes above all of them — the list is capped, and a live
  // card the learner cannot see is the same as no live card at all. `updatedAt`
  // alone would not do it: a turn can run for a minute without writing anything
  // to the session it is deciding about.
  const recent = useMemo(
    () => [...resumable]
      .sort((a, b) => Number(!!runs[b.id]) - Number(!!runs[a.id]) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, SHOWN),
    [resumable, runs],
  );

  return (
    <div className="app-scroll h-full overflow-y-auto">
      {/* One measure for the whole app: the same 46rem the agent transcript uses,
          so moving between the dashboard and a session does not move the column
          the eye has settled on.

          `min-h-full` and a growing hero are what centre the composer. The hero
          takes whatever height the session list does not, so an empty account
          gets it in the middle of the pane and a busy one gets it above a full
          drum — without either case needing its own layout. */}
      <div className="mx-auto flex min-h-full w-full max-w-[46rem] flex-col px-8 pb-14 pt-8">
        <section className="flex flex-1 flex-col justify-center py-4">
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
              is the one thing here you cannot work out by looking.

              The figures ride in the composer's own pill row rather than in a
              section of their own further down. Two numbers do not deserve a
              region of the page, and the row already exists and already holds
              exactly this kind of quiet standing fact. */}
          <Composer
            className="mt-6"
            busy={busy}
            leading={
              <>
                {active.length > 0 && (
                  <ComposerPill icon={Target}>
                    {active.length} open {active.length === 1 ? "session" : "sessions"}
                  </ComposerPill>
                )}
                {questions.length > 0 && (
                  <ComposerPill icon={CircleCheck} title={`${evaluated} of ${questions.length} challenges have a deterministic verdict`}>
                    {evaluated}/{questions.length} evaluated
                  </ComposerPill>
                )}
                {seconds > 0 && (
                  <ComposerPill icon={Clock3} title="Time spent inside challenges">
                    {formatDuration(seconds)}
                  </ComposerPill>
                )}
              </>
            }
            minLength={GOAL_MIN_LENGTH}
            onChange={setGoal}
            {...(onOpenSettings ? { onOpenSettings } : {})}
            onSubmit={() => {
              const value = goal.trim();
              if (value.length < GOAL_MIN_LENGTH) return;
              setGoal("");
              onStart(value);
            }}
            placeholder="I want to understand graph algorithms deeply…"
            trailing={<ComposerModelPicker {...(onOpenSettings ? { onOpenSettings } : {})} />}
            value={goal}
          />
        </section>

        {/* Gated on there being something to resume rather than on there being any
            sessions at all: archive everything and the figures above still have
            years to report, but a heading over no rows would be the page asking
            for something impossible. */}
        {recent.length > 0 && (
          <section className="mt-8 shrink-0">
            <div className="flex h-5 items-center justify-between">
              <h2 className="text-ui font-medium text-muted-foreground">Resume sparring</h2>
              {/* Worth offering only once the list is actually holding some back —
                  otherwise it points at what is already on screen. Compared
                  against the whole population, not against what fits in the drum:
                  the drum scrolls, so everything in it counts as shown. */}
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

            {/* The list scrolls inside its own box instead of growing the page, so
                the composer above it keeps its place however many sessions are
                open. */}
            <ScrollDrum className="mt-2.5" maxHeight={DRUM_HEIGHT}>
              <div className="flex flex-col gap-2.5">
                {recent.map((session) => (
                  <SessionCard
                    key={session.id}
                    onOpen={() => onOpen(session)}
                    preview={previewFor(session.id)}
                    run={runs[session.id] ?? null}
                    session={session}
                  />
                ))}
              </div>
            </ScrollDrum>
          </section>
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
