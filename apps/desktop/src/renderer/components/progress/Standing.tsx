import { useState } from "react";
import { ChevronDown, ChevronRight, Eye, MoveDown, MoveRight, MoveUp, Target } from "lucide-react";
import type { LearnerAbilityState, LearnerPattern, LearnerProgress, SparNotice } from "@spar/domain";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
import { Band, Meter, Panel } from "../common/Page";

/**
 * What Spar believes about the learner, as one surface.
 *
 * This was four. "Where you stand" grouped the abilities, "Being watched" listed
 * the habits — which are observations made *against those same abilities* and
 * carry the `abilityId` to prove it — "Noticed" listed the moments those beliefs
 * changed, and a library underneath browsed the abilities a third time. Four
 * bands, four panels, one argument, and the one thing a reader wanted from it —
 * *what is Spar saying about me* — was split across all of them, with a habit
 * sitting six inches below the ability it was about and no line drawn between
 * the two.
 *
 * So the ability is the spine and the habit is a line under the ability it was
 * observed against. One panel, four groups, and every row is one line.
 *
 * Everything is a line because the alternative was tried and it was unreadable:
 * printing each ability's belief sentence under its title turned a surface you
 * are meant to scan into six paragraphs of the agent's prose. The prose is good
 * and it is not deleted — it is on the ability's own page, which is one click
 * from every row here. A summary that says everything is not a summary.
 *
 * Three groups for the abilities, and they are Spar's stance rather than a
 * grade: something it is working on, something it has too little evidence to
 * claim anything about, and something it has stopped asking about. Every ability
 * lands in exactly one — the old three predicates left a middling, confident,
 * untrained ability in no group at all, so the header's count disagreed with the
 * rows beneath it.
 */
export function BeliefSurface({
  className,
  notices,
  onOpenAbility,
  progress,
}: {
  className?: string | undefined;
  notices: SparNotice[];
  onOpenAbility(abilityId: string): void;
  progress: LearnerProgress;
}) {
  if (!progress.abilities.length && !notices.length) return null;

  const training = progress.abilities.filter((ability) => ability.trainingStatus === "training" || ability.trainingStatus === "diagnosing");
  const claimed = new Set(training.map((ability) => ability.abilityId));
  /* Anything Spar has an opinion about but little reason to hold it. Taken
     before the settled group, so a low-confidence belief is never read as a
     finding. */
  const unsure = progress.abilities.filter((ability) => !claimed.has(ability.abilityId) && ability.confidence < 0.45);
  for (const ability of unsure) claimed.add(ability.abilityId);
  const settled = progress.abilities.filter((ability) => !claimed.has(ability.abilityId));

  /* A habit belongs to the ability it was observed against. Resolved ones are
     excluded: a habit you no longer have is history, and history has its page. */
  const live = progress.patterns.filter((pattern) => pattern.status !== "resolved");
  const attached = new Map<string, LearnerPattern[]>();
  for (const pattern of live) {
    if (!pattern.abilityId) continue;
    attached.set(pattern.abilityId, [...(attached.get(pattern.abilityId) ?? []), pattern]);
  }
  /* A pattern Spar has not tied to an ability has no spine to hang off, so it
     gets its own group rather than being dropped or faked onto one. */
  const loose = live.filter((pattern) => !pattern.abilityId || !progress.abilities.some((ability) => ability.abilityId === pattern.abilityId));

  const group = (label: string, tone: string, entries: LearnerAbilityState[], measure: "proficiency" | "confidence") =>
    entries.length > 0 && (
      <Group count={entries.length} label={label} tone={tone}>
        {[...entries]
          .sort((left, right) => right[measure] - left[measure])
          .map((ability) => (
            <Belief
              ability={ability}
              key={ability.abilityId}
              measure={measure}
              onOpen={() => onOpenAbility(ability.abilityId)}
              patterns={attached.get(ability.abilityId) ?? []}
              tone={tone}
            />
          ))}
      </Group>
    );

  return (
    <Band className={className} title={`What Spar believes · ${progress.abilities.length}`}>
      <Panel className="divide-y-[length:var(--hairline)] divide-[var(--border-surface-strong)] overflow-hidden">
        {/* A colour per stance, and the stance is the only thing it says.
            Not a grade: "Settled" holds a 55% ability Spar has stopped asking
            about as readily as an 85% one, so the hues are chosen to be
            unrankable against each other — amber is attention, violet is not
            knowing, slate-blue is at rest. Green was tried for Settled and it
            was wrong for exactly the reason the meters are hairlines: a green
            label over a half-full bar reads as praise the measure beside it does
            not support. */}
        {group("In training", "var(--stance-training)", training, "proficiency")}
        {group("Needs evidence", "var(--stance-unsure)", unsure, "confidence")}
        {group("Settled", "var(--stance-settled)", settled, "proficiency")}

        {loose.length > 0 && (
          <Group label="Also watching" tone="var(--stance-training)">
            {loose.map((pattern) => (
              <div className="flex items-center px-1.5 py-[0.3rem]" key={pattern.id} title={pattern.description || undefined}>
                <PatternLine pattern={pattern} />
              </div>
            ))}
          </Group>
        )}

        {/* No colour and no dot: "Recently" is not a stance Spar holds, it is
            when things changed. Giving it one made it the fourth stance on a
            surface that has three. */}
        {notices.length > 0 && (
          <Group label="Recently">
            {notices.slice(0, 4).map((notice) => <Notice key={notice.id} notice={notice} />)}
          </Group>
        )}
      </Panel>
    </Band>
  );
}

/** One stance, and everything held under it. Stacked rather than set beside its
 *  siblings: a grid gives every group the height of the tallest, so short groups
 *  are padded with air and long ones are cut off at five with "and 4 more" — a
 *  layout whose worst case is its common one. */
function Group({ children, count, label, tone }: { children: React.ReactNode; count?: number; label: string; tone?: string }) {
  return (
    <div className="px-2 py-1.5" style={tone ? { ["--stance" as string]: tone } : undefined}>
      <p className={cn("flex items-center gap-1.5 px-1.5 py-1 text-ui font-medium", tone ? "text-[var(--stance)]" : "text-muted-foreground")}>
        {tone && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
        {label}
        {count !== undefined && count > 1 && <span className="tabular-nums font-normal opacity-65">{count}</span>}
      </p>
      {children}
    </div>
  );
}

/**
 * One ability, on one line.
 *
 * The measure rides beside the title rather than under it: a full-width rule
 * under a line of type reads as an underline, not as a quantity. A habit Spar
 * has caught against this ability gets the only second line on this surface,
 * because "you do this specific wrong thing, repeatedly" is the most useful
 * sentence the app produces and it is worth one line to say it. Its stage and
 * its evidence count are in the tooltip — on the row they were three more
 * figures on a surface already made of figures.
 */
function Belief({ ability, measure, onOpen, patterns, tone }: {
  ability: LearnerAbilityState;
  measure: "proficiency" | "confidence";
  onOpen(): void;
  patterns: LearnerPattern[];
  tone: string;
}) {
  return (
    <button
      className="group flex w-full flex-col gap-0.5 rounded-[var(--radius-md)] px-1.5 py-[0.3rem] text-left outline-none transition-colors hover:bg-accent/35 focus-visible:bg-accent/35"
      onClick={onOpen}
      type="button"
    >
      <span className="flex w-full items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-ui text-foreground">{ability.title}</span>
        <Trend trend={ability.trend} />
        <Meter className="w-14 shrink-0" tone={tone} value={ability[measure]} />
        <span className="w-8 shrink-0 text-right tabular-nums text-ui-sm text-muted-foreground">{Math.round(ability[measure] * 100)}%</span>
        <ChevronRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      {patterns.slice(0, 1).map((pattern) => <PatternLine key={pattern.id} pattern={pattern} />)}
    </button>
  );
}

/** A habit, as one line and no more. The description is the agent's own prose
 *  and belongs on the ability's page where it is written out in full; here it is
 *  the tooltip, along with how far the habit has been established. */
function PatternLine({ pattern }: { pattern: LearnerPattern }) {
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 pr-[6.5rem] text-ui-sm text-muted-foreground"
      title={`${PATTERN_STAGE[pattern.status]} · seen ${pattern.evidenceCount}×${pattern.description ? ` — ${pattern.description}` : ""}`}
    >
      {pattern.status === "pattern"
        ? <Target className="size-3 shrink-0 text-[var(--warning)]" />
        : <Eye className="size-3 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 truncate">{pattern.title}</span>
    </span>
  );
}

/** A change of belief, and when. The row opens itself rather than linking
 *  anywhere: the body is the whole of what Spar has to say, so a destination
 *  would just be this text on its own page. */
function Notice({ notice }: { notice: SparNotice }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-1.5 py-[0.3rem] text-left outline-none transition-colors hover:bg-accent/35 focus-visible:bg-accent/35"
        disabled={!notice.body.trim()}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate text-ui text-foreground">{notice.title}</span>
        <span className="shrink-0 text-ui-sm text-muted-foreground">{relativeTime(notice.createdAt)}</span>
        {notice.body.trim() && <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />}
      </button>
      {open && <p className="px-1.5 pb-2 pt-0.5 text-ui leading-[1.55] text-muted-foreground">{notice.body}</p>}
    </div>
  );
}

/** Direction only. An arrow is the whole message and it does not need a word
 *  beside it in a column this narrow; "stable" gets nothing at all, because a
 *  glyph for "no change" is just noise on every row that has not moved. */
function Trend({ trend }: { trend: LearnerAbilityState["trend"] }) {
  if (trend === "improving") return <MoveUp className="size-3 shrink-0 text-[var(--success)]" />;
  if (trend === "declining") return <MoveDown className="size-3 shrink-0 text-destructive" />;
  if (trend === "stable") return <MoveRight className="size-3 shrink-0 text-muted-foreground" />;
  return null;
}

/** The ledger's own words are stages of belief, so they are said as stages
 *  rather than as statuses — "hypothesis" is a thing Spar is doing, not a label
 *  the learner is wearing. */
const PATTERN_STAGE: Record<LearnerPattern["status"], string> = {
  observation: "Seen once",
  hypothesis: "Suspected",
  pattern: "Established",
  monitoring: "Watching for a repeat",
  resolved: "Resolved",
};
