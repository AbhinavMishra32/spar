import { ChevronRight, Eye, MoveDown, MoveRight, MoveUp, Target } from "lucide-react";
import type { LearnerAbilityState, LearnerPattern, LearnerProgress } from "@spar/domain";
import { cn } from "@/lib/utils";
import { Band, Meter, Panel } from "../common/Page";

/**
 * Where the learner stands, as three answers rather than three counts.
 *
 * The previous version of this was a stack of rows reading "Strengths … 4" with
 * the first two titles truncated underneath, which is the shape of a summary
 * that has nothing to say: a number you cannot act on and a list you cannot
 * finish reading. Each column here is the list, every row opens the ability it
 * names, and the bar behind the title is the evidence the claim rests on.
 *
 * The three columns are the three things a model of somebody can honestly be in:
 * something it has seen you do, something it is actively working on, and
 * something it has guessed at and not yet checked. Nothing belongs to two.
 */
export function StandingBand({ onOpenAbility, progress }: {
  onOpenAbility(abilityId: string): void;
  progress: LearnerProgress;
}) {
  const training = progress.abilities.filter((ability) => ability.trainingStatus === "training" || ability.trainingStatus === "diagnosing");
  const fluent = progress.abilities.filter((ability) => ability.trainingStatus === "monitoring" && ability.proficiency >= 0.75);
  /* Anything Spar has an opinion about but little reason to hold it. Kept out of
     the other two columns so a low-confidence belief is never read as a finding. */
  const held = new Set([...training, ...fluent].map((ability) => ability.abilityId));
  const uncertain = progress.abilities.filter((ability) => !held.has(ability.abilityId) && ability.confidence < 0.45);

  if (!progress.abilities.length) return null;

  return (
    <Band title="Where you stand">
      <div className="grid gap-2.5 lg:grid-cols-3">
        <Column
          abilities={fluent}
          empty="Nothing yet"
          label="Fluent"
          measure="proficiency"
          onOpen={onOpenAbility}
          tone="text-[var(--success)]"
        />
        <Column
          abilities={training}
          empty="Nothing active"
          label="In training"
          measure="proficiency"
          onOpen={onOpenAbility}
          tone="text-[var(--warning)]"
        />
        <Column
          abilities={uncertain}
          empty="Nothing pending"
          label="Needs evidence"
          measure="confidence"
          onOpen={onOpenAbility}
          tone="text-muted-foreground"
        />
      </div>
    </Band>
  );
}

function Column({ abilities, empty, label, measure, onOpen, tone }: {
  abilities: LearnerAbilityState[];
  empty: string;
  label: string;
  measure: "proficiency" | "confidence";
  onOpen(abilityId: string): void;
  tone: string;
}) {
  /* Strongest first in every column, so the top row is the one worth reading if
     you read only one. */
  const ordered = [...abilities].sort((left, right) => right[measure] - left[measure]);
  return (
    <Panel className="flex flex-col px-3 py-2.5">
      <p className="flex items-baseline justify-between gap-2 px-1 pb-1.5">
        <span className={cn("text-ui font-medium", tone)}>{label}</span>
        <span className="tabular-nums text-ui-sm text-muted-foreground/70">{ordered.length || ""}</span>
      </p>
      {ordered.length ? (
        <div className="flex flex-col">
          {ordered.slice(0, 5).map((ability) => (
            <button
              className="group -mx-1 rounded-[var(--radius-md)] px-1.5 py-[0.3rem] text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring"
              key={ability.abilityId}
              onClick={() => onOpen(ability.abilityId)}
              type="button"
            >
              {/* The bar rides beside the title rather than under it. A
                  full-width rule under a line of type reads as an underline, not
                  as a quantity — which is exactly how the first version of this
                  looked. At 2.5rem it is unmistakably a gauge. */}
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-ui text-foreground/90">{ability.title}</span>
                <Meter
                  className="w-10 shrink-0"
                  title={`${Math.round(ability[measure] * 100)}% ${measure}`}
                  value={ability[measure]}
                />
                <Trend trend={ability.trend} />
                <ChevronRight className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70" />
              </span>
            </button>
          ))}
          {ordered.length > 5 && (
            <p className="px-1.5 pt-1.5 text-ui-sm text-muted-foreground/70">and {ordered.length - 5} more</p>
          )}
        </div>
      ) : (
        <p className="px-1.5 pb-1 pt-1 text-ui text-muted-foreground/60">{empty}</p>
      )}
    </Panel>
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
export function PatternsBand({ patterns }: { patterns: LearnerPattern[] }) {
  const live = patterns.filter((pattern) => pattern.status !== "resolved");
  if (!live.length) return null;

  const rank: Record<LearnerPattern["status"], number> = { pattern: 0, monitoring: 1, hypothesis: 2, observation: 3, resolved: 4 };
  const ordered = [...live].sort((left, right) => rank[left.status] - rank[right.status] || right.evidenceCount - left.evidenceCount);

  return (
    <Band title="Being watched">
      <Panel className="divide-y divide-border overflow-hidden">
        {ordered.slice(0, 5).map((pattern) => (
          /* Title, stage, count. The description is the agent's own prose and
             belongs on the ability it was written against, not stacked five
             deep on an overview. It rides as the row's tooltip instead. */
          <div className="flex items-center gap-2.5 px-4 py-2.5" key={pattern.id} title={pattern.description || undefined}>
            <span className="shrink-0 text-muted-foreground/70">
              {pattern.status === "pattern" ? <Target className="size-3.5" /> : <Eye className="size-3.5" />}
            </span>
            <p className="min-w-0 flex-1 truncate text-ui">{pattern.title}</p>
            <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground/60">×{pattern.evidenceCount}</span>
            <span className="shrink-0 text-ui-sm text-muted-foreground/70">{PATTERN_STAGE[pattern.status]}</span>
          </div>
        ))}
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
