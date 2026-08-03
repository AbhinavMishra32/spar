import { useMemo } from "react";
import {
  Check,
  CircleDot,
  Eye,
  EyeOff,
  Flag,
  MessageSquare,
  Minus,
  Pencil,
  Play,
  Sparkles,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import type { SessionDetail } from "@spar/domain";
import { cn } from "@/lib/utils";
import { EmptyState } from "../common/EmptyState";
import {
  duration,
  foldAttempt,
  offset,
  type AttemptReplay,
  type CaseVerdict,
  type ReplayCase,
  type ReplayMoment,
} from "../../../shared/attemptReplay";

type Event = SessionDetail["events"][number];

const MOMENT_ICONS: Record<ReplayMoment["kind"], React.ComponentType<{ className?: string }>> = {
  opened: Flag,
  edit: Pencil,
  run: Play,
  submission: Upload,
  verdict: CircleDot,
  asked: Sparkles,
  said: MessageSquare,
  ended: Flag,
};

/**
 * The attempt, read back as the solve it was.
 *
 * This used to print each event's raw payload, which is the one presentation that
 * hides the thing worth seeing: a case's whole life across the attempt. It is
 * drawn from the same fold the agent reads, so what the learner sees here and
 * what Spar reasons about are the same account of the same attempt.
 */
export function AttemptsPanel({
  events,
  title,
  language,
  startedAt,
  completedAt,
}: {
  events: Event[];
  title?: string;
  language?: string;
  startedAt?: string;
  completedAt?: string | null;
}) {
  const replay = useMemo(
    () => foldAttempt(events, { ...(title ? { title } : {}), ...(language ? { language } : {}) }),
    [events, title, language],
  );

  if (events.length === 0) {
    return (
      <div className="app-scroll h-full overflow-y-auto p-5">
        <EmptyState
          compact
          description="Every edit, run, and submission is recorded here with its own timestamp. Spar reads this to see how you solved it, not just whether you did."
          icon={Terminal}
          title="Nothing recorded yet"
        />
      </div>
    );
  }

  const { stats } = replay;
  return (
    <div className="app-scroll h-full overflow-y-auto px-4 py-3">
      <div className="mx-auto w-full max-w-[46rem] space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Stat label="on this attempt" value={duration(elapsed(replay, startedAt, completedAt))} />
          <Stat label={stats.runs === 1 ? "run" : "runs"} value={String(stats.runs)} />
          <Stat label={stats.submissions === 1 ? "submission" : "submissions"} value={String(stats.submissions)} />
          <Stat label={stats.saves === 1 ? "save" : "saves"} value={String(stats.saves)} />
          {stats.regressions > 0 && (
            <span className="rounded-md bg-destructive/12 px-1.5 py-0.5 text-ui-sm text-destructive">
              {stats.regressions} case{stats.regressions === 1 ? "" : "s"} broke after passing
            </span>
          )}
        </div>

        {replay.cases.length > 0 && (
          <Section
            hint={`One row per case, one mark per run, oldest first.${replay.cases.some((item) => item.hidden) ? " Hidden cases only run when you submit." : ""}`}
            title="How each case went"
          >
            <div className="space-y-px">
              {replay.cases.map((item) => (
                <CaseRow key={item.name} item={item} />
              ))}
            </div>
          </Section>
        )}

        <Section hint="Times are measured from the moment this challenge opened." title="What happened, when">
          <ol className="space-y-px">
            {replay.moments.map((moment) => {
              const Icon = MOMENT_ICONS[moment.kind];
              return (
                <li
                  key={`${moment.eventId}-${moment.kind}`}
                  className="flex items-baseline gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-accent/50"
                >
                  <span className="shrink-0 font-mono text-ui-sm tabular-nums text-muted-foreground/55">
                    {offset(moment.offsetMs)}
                  </span>
                  <Icon
                    className={cn(
                      "size-3 shrink-0 translate-y-0.5",
                      moment.kind === "submission" ? "text-foreground/70" : "text-muted-foreground/60",
                    )}
                  />
                  <span className="min-w-0 flex-1 break-words text-ui text-foreground/85">{moment.text}</span>
                </li>
              );
            })}
          </ol>
        </Section>

        <p className="px-2 pb-1 text-ui-sm text-muted-foreground/55">
          Spar reads this same log — every event, every case, with these timings — to decide what to ask you next.
        </p>
      </div>
    </div>
  );
}

/** The panel shows the clock's own elapsed time where it has it, so the two
 *  numbers in the workspace cannot disagree by a render. */
function elapsed(replay: AttemptReplay, startedAt?: string, completedAt?: string | null): number {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(start)) return replay.stats.elapsedMs;
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  return Math.max(0, (Number.isFinite(end) ? end : Date.now()) - start);
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 text-ui text-muted-foreground">
      <span className="font-medium tabular-nums text-foreground">{value}</span>
      {label}
    </span>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1 px-2">
        <p className="text-ui font-medium">{title}</p>
        {hint && <p className="mt-0.5 text-ui-sm text-muted-foreground/65">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function CaseRow({ item }: { item: ReplayCase }) {
  return (
    <div className="rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-ui text-foreground/90">{item.name}</span>
        <span
          className="shrink-0"
          title={item.hidden ? "Hidden — only runs when you submit" : "Visible while you work"}
        >
          {item.hidden ? (
            <EyeOff className="size-3 text-muted-foreground/50" />
          ) : (
            <Eye className="size-3 text-muted-foreground/35" />
          )}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {item.verdicts.map((verdict, index) => (
            <Mark key={index} verdict={verdict} />
          ))}
        </span>
      </div>
      <p className="mt-0.5 text-ui-sm text-muted-foreground/70">{story(item)}</p>
      {item.finalVerdict === "failed" && item.lastFailure?.expected !== undefined && (
        <p className="mt-0.5 font-mono text-ui-sm text-muted-foreground/60">
          expected {item.lastFailure.expected}
          {item.lastFailure.actual === undefined ? "" : ` · got ${item.lastFailure.actual}`}
        </p>
      )}
    </div>
  );
}

/** One case's whole history in a sentence, in the second person. */
function story(item: ReplayCase): string {
  const failures = `${item.failures} failure${item.failures === 1 ? "" : "s"}`;
  if (item.neverPassed) return `Never passed — ${failures}.`;
  if (item.regressed) {
    return `Passed at ${offset(item.fixedAtMs ?? 0)}, then broke again at ${offset(item.lastFailure?.atMs ?? 0)}.`;
  }
  if (item.fixedAtMs !== undefined) return `Fixed at ${offset(item.fixedAtMs)}, after ${failures}.`;
  if (item.passedFirstTry) return "Right from the first run.";
  return "Passed.";
}

function Mark({ verdict }: { verdict: CaseVerdict }) {
  if (verdict === "passed") {
    return (
      <span className="grid size-3.5 place-items-center rounded-[3px] bg-[var(--success)]/15">
        <Check className="size-2.5 text-[var(--success)]" />
      </span>
    );
  }
  if (verdict === "failed") {
    return (
      <span className="grid size-3.5 place-items-center rounded-[3px] bg-destructive/15">
        <X className="size-2.5 text-destructive" />
      </span>
    );
  }
  if (verdict === "absent") {
    return (
      <span className="grid size-3.5 place-items-center" title="Not run in that run">
        <span className="size-1 rounded-full bg-muted-foreground/30" />
      </span>
    );
  }
  return (
    <span className="grid size-3.5 place-items-center" title="Skipped">
      <Minus className="size-2.5 text-muted-foreground/50" />
    </span>
  );
}
