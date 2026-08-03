import { CONCEPT_STANDING_LABEL, conceptStanding, conceptStrength, type ChallengeHistorySummary, type ConceptKind, type ConceptSummary } from "@spar/domain";
import type { MeterBand } from "@/components/ui/meter";

/** One hue per kind, used only as a dot and a wash — see the tokens in theme.css
 *  for why the colour never reaches the text. */
export const CONCEPT_KIND_VAR: Record<ConceptKind, string> = {
  dsa: "var(--concept-dsa)",
  engineering: "var(--concept-engineering)",
  craft: "var(--concept-craft)",
};

/** The short word for a kind. The long one lives in `CONCEPT_KIND_LABEL`; this is
 *  what fits on a chip's hover card without wrapping. */
export const CONCEPT_KIND_SHORT: Record<ConceptKind, string> = {
  dsa: "Algorithms",
  engineering: "Engineering",
  craft: "Craft",
};

/**
 * How a concept is going, said in one word plus the tone it is drawn in.
 *
 * "Untested" is deliberately toned as muted rather than as a warning: a concept
 * the learner has not been given yet is not a gap in them.
 */
export function standingOf(summary: ConceptSummary) {
  const strength = conceptStrength(summary);
  const standing = conceptStanding(strength);
  const tone =
    standing === "strong" ? "text-[var(--success)]"
    : standing === "steady" ? "text-foreground/75"
    : standing === "uneven" ? "text-[var(--warning)]"
    : standing === "shaky" ? "text-destructive"
    : "text-muted-foreground";
  return { strength, standing, tone, label: CONCEPT_STANDING_LABEL[standing] };
}

/**
 * Outcomes as countable bands rather than one pass-rate bar. The reading that
 * matters is "two passed, three failed, one walked away from" — a single 40% bar
 * says none of that, and a learner cannot act on a percentage.
 */
export function outcomeBands(summary: { passedCount: number; failedCount: number; abandonedCount: number; openCount?: number }): MeterBand[] {
  return [
    { key: "passed", value: summary.passedCount, className: "bg-[var(--success)]", label: "passed" },
    { key: "failed", value: summary.failedCount, className: "bg-destructive/75", label: "failed" },
    { key: "abandoned", value: summary.abandonedCount, className: "bg-muted-foreground/45", label: "given up" },
    { key: "open", value: summary.openCount ?? 0, className: "bg-[var(--warning)]/55", label: "open" },
  ];
}

/** Where a challenge ended up, in the words the concept views use. */
export function challengeOutcome(challenge: ChallengeHistorySummary): "passed" | "failed" | "abandoned" | "replaced" | "open" {
  return challenge.lastOutcome ?? "open";
}

/**
 * Every challenge filed under a concept, including its sub-concepts — the same
 * rollup the store does, applied to the copy of history the renderer already
 * holds so a hover preview costs nothing.
 *
 * The authoritative counts still come from the store's own summary; this only
 * decides which rows to show, which is why re-deriving it here is safe.
 */
export function challengesUnder(challenges: ChallengeHistorySummary[], concept: Pick<ConceptSummary, "slug" | "childSlugs">): ChallengeHistorySummary[] {
  const family = new Set([concept.slug, ...concept.childSlugs]);
  return challenges.filter((challenge) => challenge.concepts.some((tag) => family.has(tag.slug)));
}

/** Concepts grouped by kind, areas first with their sub-concepts beneath them.
 *  Areas the learner has met but has no evidence under are kept, because an area
 *  whose sub-concepts carry all the evidence still has to be the row they sit in. */
export function conceptTree(concepts: ConceptSummary[]) {
  const bySlug = new Map(concepts.map((concept) => [concept.slug, concept]));
  const areas = concepts.filter((concept) => !concept.parentSlug);
  const orphans = concepts.filter((concept) => concept.parentSlug && !bySlug.has(concept.parentSlug));
  return [...areas, ...orphans].map((area) => ({
    area,
    children: concepts
      .filter((concept) => concept.parentSlug === area.slug)
      .sort((left, right) => right.challengeCount - left.challengeCount || left.title.localeCompare(right.title)),
  }));
}
