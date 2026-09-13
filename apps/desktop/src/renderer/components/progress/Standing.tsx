import { ChevronRight, Eye, MoveDown, MoveRight, MoveUp, Target } from "lucide-react";
import type { LearnerAbilityState, LearnerPattern, LearnerProgress } from "@spar/domain";
import { cn } from "@/lib/utils";
import { Band, Meter, Panel } from "../common/Page";

/**
 * Where the learner stands: three groups, one column.
 *
 * The three groups are the three things a model of somebody can honestly be in:
 * something it has seen you do, something it is actively working on, and
 * something it has guessed at and not yet checked. Nothing belongs to two.
 *
 * They were three panels side by side, and side by side was the problem. Three
 * cards in a row give every group the same height whether it holds one ability
 * or nine, so the short ones are padded with air and the long ones are cut at
 * five with "and 4 more" — a layout that makes its own worst case the common
 * one. Stacked into a single panel, each group is exactly as tall as it has
 * content, the titles get the full measure instead of a third of it, and the
 * eye reads one column down rather than three columns across.
 */
export function StandingBand({ className, onOpenAbility, progress }: {
  className?: string | undefined;
  onOpenAbility(abilityId: string): void;
  progress: LearnerProgress;
}) {
  const training = progress.abilities.filter((ability) => ability.trainingStatus === "training" || ability.trainingStatus === "diagnosing");
  const fluent = progress.abilities.filter((ability) => ability.trainingStatus === "monitoring" && ability.proficiency >= 0.75);
  /* Anything Spar has an opinion about but little reason to hold it. Kept out of
     the other two groups so a low-confidence belief is never read as a finding. */
  const held = new Set([...training, ...fluent].map((ability) => ability.abilityId));
  const uncertain = progress.abilities.filter((ability) => !held.has(ability.abilityId) && ability.confidence < 0.45);

  if (!progress.abilities.length) return null;

  return (
    <Band className={className} title="Where you stand">
      <Panel className="divide-y-[length:var(--hairline)] divide-[var(--border-surface-strong)] overflow-hidden">
        <Group
          abilities={fluent}
          label="Fluent"
          measure="proficiency"
          onOpen={onOpenAbility}
          tone="text-[var(--success)]"
        />
        <Group
          abilities={training}
          label="In training"
          measure="proficiency"
          onOpen={onOpenAbility}
          tone="text-[var(--warning)]"
        />
        <Group
          abilities={uncertain}
          label="Needs evidence"
          measure="confidence"
          onOpen={onOpenAbility}
          tone="text-muted-foreground"
        />
      </Panel>
    </Band>
  );
}

/**
 * One group, and every ability in it.
 *
 * Nothing is truncated to a "and N more" line any more: a group of nine is nine
 * rows at 26px, which is shorter than the three padded cards this replaced. An
 * empty group is one row saying so rather than a third of a panel of nothing.
 */
function Group({ abilities, label, measure, onOpen, tone }: {
  abilities: LearnerAbilityState[];
  label: string;
  measure: "proficiency" | "confidence";
  onOpen(abilityId: string): void;
  tone: string;
}) {
  /* Strongest first, so the top row is the one worth reading if you read one. */
  const ordered = [...abilities].sort((left, right) => right[measure] - left[measure]);

  return (
    <div className="px-2 py-1.5">
      <p className="flex items-baseline gap-2 px-1.5 py-1">
        <span className={cn("text-ui font-medium", tone)}>{label}</span>
        <span className="tabular-nums text-ui-sm text-muted-foreground/60">{ordered.length}</span>
      </p>
      {ordered.length ? ordered.map((ability) => (
        <button
          className="group flex w-full items-center gap-3 rounded-[var(--radius-md)] px-1.5 py-[0.3rem] text-left outline-none transition-colors hover:bg-accent/35 focus-visible:bg-accent/35"
          key={ability.abilityId}
          onClick={() => onOpen(ability.abilityId)}
          type="button"
        >
          <span className="min-w-0 flex-1 truncate text-ui text-foreground/90">{ability.title}</span>
          <Trend trend={ability.trend} />
          {/* The bar rides beside the title rather than under it. A full-width
              rule under a line of type reads as an underline, not as a quantity —
              which is exactly how the first version of this looked. */}
          <Meter className="w-14 shrink-0" value={ability[measure]} />
          <span className="w-8 shrink-0 text-right tabular-nums text-ui-sm text-muted-foreground/70">{Math.round(ability[measure] * 100)}%</span>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
        </button>
      )) : (
        <p className="px-1.5 py-[0.3rem] text-ui text-muted-foreground/50">Nothing here</p>
      )}
    </div>
  );
}

/** Direction only. An arrow is the whole message and it does not need a word
 *  beside it in a column this narrow; "stable" gets nothing at all, because a
 *  glyph for "no change" is just noise on every row that has not moved. */
function Trend({ trend }: { trend: LearnerAbilityState["trend"] }) {
  if (trend === "improving") return <MoveUp className="size-3 shrink-0 text-[var(--success)]" />;
  if (trend === "declining") return <MoveDown className="size-3 shrink-0 text-destructive" />;
  if (trend === "stable") return <MoveRight className="size-3 shrink-0 text-muted-foreground/40" />;
  return null;
}

/**
 * What Spar is watching.
 *
 * Patterns were only reachable from inside one ability's page, which meant the
 * app's most useful output — "you do this specific wrong thing, repeatedly" —
 * was the hardest thing in it to find. They are promoted here, ordered by how
 * far each has been established, and every one says what it would take to move.
 *
 * Resolved patterns are excluded: a habit you no longer have is history, and
 * history has its own page.
 */
export function PatternsBand({ className, onOpenAbility, patterns }: {
  className?: string | undefined;
  onOpenAbility(abilityId: string): void;
  patterns: LearnerPattern[];
}) {
  const live = patterns.filter((pattern) => pattern.status !== "resolved");
  if (!live.length) return null;

  const rank: Record<LearnerPattern["status"], number> = { pattern: 0, monitoring: 1, hypothesis: 2, observation: 3, resolved: 4 };
  const ordered = [...live].sort((left, right) => rank[left.status] - rank[right.status] || right.evidenceCount - left.evidenceCount);

  return (
    <Band className={className} title="Being watched">
      <Panel className="divide-y-[length:var(--hairline)] divide-[var(--border-surface-strong)] overflow-hidden">
        {ordered.slice(0, 5).map((pattern) => {
          /* Title, stage, count. The description is the agent's own prose and
             belongs on the ability it was written against, not stacked five
             deep on an overview. It rides as the row's tooltip instead — and,
             where the pattern names an ability, the row goes there, which is
             where that prose is actually written out. */
          const body = (
            <>
              <span className="shrink-0 text-muted-foreground/70">
                {pattern.status === "pattern" ? <Target className="size-3.5" /> : <Eye className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-ui">{pattern.title}</span>
              <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground/60">×{pattern.evidenceCount}</span>
              <span className="shrink-0 text-ui-sm text-muted-foreground/70">{PATTERN_STAGE[pattern.status]}</span>
            </>
          );
          const shared = "flex w-full items-center gap-2.5 px-3.5 py-2 text-left";

          return pattern.abilityId ? (
            <button
              className={cn(shared, "group outline-none transition-colors hover:bg-accent/25 focus-visible:bg-accent/25")}
              key={pattern.id}
              onClick={() => onOpenAbility(pattern.abilityId!)}
              title={pattern.description || undefined}
              type="button"
            >
              {body}
              <ChevronRight className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
            </button>
          ) : (
            /* A pattern Spar has not tied to an ability yet has nowhere to go,
               so it is a row rather than a dead button. */
            <div className={shared} key={pattern.id} title={pattern.description || undefined}>
              {body}
              <span className="size-3 shrink-0" />
            </div>
          );
        })}
      </Panel>
    </Band>
  );
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
