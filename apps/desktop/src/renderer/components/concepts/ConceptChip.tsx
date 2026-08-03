import { ArrowUpRight, CheckCircle2, CircleDashed, CircleSlash, RefreshCw, XCircle } from "lucide-react";
import type { ChallengeHistorySummary, ConceptSummary, ConceptTag } from "@spar/domain";
import { cn } from "@/lib/utils";
import { shortTime } from "@/lib/format";
import { CONCEPT_KIND_SHORT, CONCEPT_KIND_VAR, challengeOutcome, challengesUnder, outcomeBands, standingOf } from "@/lib/concepts";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Meter, MeterKey } from "@/components/ui/meter";

/** The outcome marks, shared by every list that shows a challenge under a concept. */
export const OUTCOME_ICON = {
  passed: { icon: CheckCircle2, className: "text-[var(--success)]", label: "Passed" },
  failed: { icon: XCircle, className: "text-destructive", label: "Failed" },
  abandoned: { icon: CircleSlash, className: "text-muted-foreground/70", label: "Given up on" },
  replaced: { icon: RefreshCw, className: "text-muted-foreground/70", label: "Replaced" },
  open: { icon: CircleDashed, className: "text-[var(--warning)]", label: "Open" },
} as const;

export function OutcomeMark({ className, outcome }: { className?: string; outcome: keyof typeof OUTCOME_ICON }) {
  const { icon: Icon, className: tone, label } = OUTCOME_ICON[outcome];
  return <Icon aria-label={label} className={cn("size-3.5 shrink-0", tone, className)} />;
}

/**
 * One concept, as a tag.
 *
 * Colour lives in the dot and nowhere else. Three kinds of concept want telling
 * apart at a glance, but a row of four filled colour pills under a challenge
 * title competes with the title — so the chip is a neutral surface, the hue is
 * 5px of it, and the wash only appears under the pointer.
 *
 * The chip is a button whenever it can be opened, and plain text when it cannot,
 * rather than a button that does nothing: a cursor that changes over something
 * inert is a promise the row does not keep.
 */
export function ConceptChip({
  challenges,
  className,
  concept,
  onOpen,
  showArea = false,
  summary,
  tag,
}: {
  /** History, for the hover preview. Omit to render the chip without one. */
  challenges?: ChallengeHistorySummary[];
  className?: string;
  /** Either form is accepted: a tag off a challenge row, or a full summary. */
  tag?: ConceptTag;
  concept?: ConceptSummary;
  onOpen?(slug: string): void;
  /** Prefixes the area, for chips that appear away from their own group. */
  showArea?: boolean;
  /** The learner's standing on this concept, when the caller has it. */
  summary?: ConceptSummary;
}) {
  const identity = tag ?? concept;
  if (!identity) return null;
  const evidence = summary ?? concept;
  const area = showArea ? ("parentTitle" in identity ? identity.parentTitle : null) : null;

  const chip = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-[var(--color-background-elevated-secondary)] px-1.5 py-0.5 text-ui-sm text-foreground/80 transition-colors",
        onOpen && "hover:border-[var(--border-strong)] hover:bg-accent/45 hover:text-foreground",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: CONCEPT_KIND_VAR[identity.kind] }} />
      {area && <span className="shrink-0 text-muted-foreground/70">{area} ·</span>}
      <span className="truncate">{identity.title}</span>
      {/* The role only shows when it is the aim. "Supporting" on three of four
          chips is noise; "aimed at this" on one of them is the information. */}
      {tag?.role === "primary" && <span aria-label="what this challenge was aimed at" className="shrink-0 text-muted-foreground/60">◆</span>}
    </span>
  );

  const body = onOpen ? (
    <button
      aria-label={`Open ${identity.title}`}
      className="max-w-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:rounded-md"
      onClick={(event) => { event.stopPropagation(); onOpen(identity.slug); }}
      type="button"
    >
      {chip}
    </button>
  ) : chip;

  if (!evidence || !challenges) return body;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>{body}</HoverCardTrigger>
      <HoverCardContent>
        <ConceptPreview challenges={challenges} concept={evidence} openable={Boolean(onOpen)} />
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * What the learner has done under this concept, at a glance. Deliberately the
 * evidence and not a definition: they hovered a tag on their own history, so the
 * question being asked is "what have I done here", and the description is one
 * line of context underneath rather than the headline.
 */
function ConceptPreview({ challenges, concept, openable }: { challenges: ChallengeHistorySummary[]; concept: ConceptSummary; openable: boolean }) {
  const { label, tone } = standingOf(concept);
  const under = challengesUnder(challenges, concept);
  const recent = under.slice(0, 4);
  const bands = outcomeBands(concept);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full" style={{ background: CONCEPT_KIND_VAR[concept.kind] }} />
        <div className="min-w-0 flex-1">
          {concept.parentTitle && <p className="truncate text-ui-sm text-muted-foreground/70">{concept.parentTitle}</p>}
          <p className="text-content font-semibold leading-tight">{concept.title}</p>
        </div>
        <span className={cn("shrink-0 text-ui-sm font-medium", tone)}>{label}</span>
      </div>

      {concept.challengeCount > 0 ? (
        <>
          <Meter animate={false} bands={bands} height="0.3125rem" />
          <div className="flex flex-wrap gap-x-2.5 gap-y-1">
            {bands.filter((band) => band.value > 0).map((band) => <MeterKey band={band} key={band.key} />)}
          </div>
          <div className="flex flex-col gap-1 border-t border-border/70 pt-2">
            {recent.map((challenge) => (
              <div className="flex items-center gap-1.5 text-ui" key={challenge.id}>
                <OutcomeMark outcome={challengeOutcome(challenge)} />
                <span className="min-w-0 flex-1 truncate text-foreground/85">{challenge.title}</span>
                <span className="shrink-0 tabular-nums text-ui-sm text-muted-foreground/70">{shortTime(challenge.updatedAt)}</span>
              </div>
            ))}
            {under.length > recent.length && (
              <p className="text-ui-sm text-muted-foreground/70">+{under.length - recent.length} more in your history</p>
            )}
          </div>
        </>
      ) : (
        <p className="text-ui leading-[1.6] text-muted-foreground">{concept.description || `${CONCEPT_KIND_SHORT[concept.kind]} · nothing recorded here yet.`}</p>
      )}

      {openable && (
        <p className="flex items-center gap-1 text-ui-sm text-muted-foreground/70">
          Click to see everything under this
          <ArrowUpRight className="size-3" />
        </p>
      )}
    </div>
  );
}

/**
 * A challenge's tags as one row. Clipped rather than wrapped, with the overflow
 * counted: history rows are a fixed height and a challenge with five concepts
 * must not be twice the height of one with two.
 */
export function ConceptChips({
  challenges,
  className,
  concepts,
  limit = 3,
  onOpen,
  summaries,
}: {
  challenges?: ChallengeHistorySummary[];
  className?: string;
  concepts: ConceptTag[];
  limit?: number;
  onOpen?(slug: string): void;
  /** Standing per slug, so a chip in a list can still show a hover preview. */
  summaries?: Map<string, ConceptSummary>;
}) {
  if (!concepts.length) return null;
  const shown = concepts.slice(0, limit);
  const hidden = concepts.length - shown.length;

  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {shown.map((tag) => (
        <ConceptChip
          key={tag.slug}
          {...(challenges ? { challenges } : {})}
          {...(onOpen ? { onOpen } : {})}
          {...(summaries?.get(tag.slug) ? { summary: summaries.get(tag.slug)! } : {})}
          tag={tag}
        />
      ))}
      {hidden > 0 && (
        <span className="shrink-0 text-ui-sm text-muted-foreground/70" title={concepts.slice(limit).map((tag) => tag.title).join(", ")}>
          +{hidden}
        </span>
      )}
    </span>
  );
}
