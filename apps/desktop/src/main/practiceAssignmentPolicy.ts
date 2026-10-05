import { itemRating, solveProbability, type AbilityStatus, type LearnerProfile, type Rating, seededConcept } from "@spar/domain";
import type { PracticeDifficulty, PracticeSourceId } from "@spar/practice";
import type { ConceptTagInput } from "./store.js";

export type PracticeTargetSnapshot = {
  abilityTitle: string;
  specificGap: string;
  desiredEvidence: string;
  abilityStatus: AbilityStatus;
  abilityConcepts: string[];
  experience: LearnerProfile["experience"];
  /** Where the learner is rated, decayed for the time since they were last seen.
   *  This is what makes the level check a measurement rather than a bucket. */
  rating: Rating;
};

export type PracticeCandidateSnapshot = {
  difficulty: PracticeDifficulty;
  concepts: string[];
  /** Which source it came from, and its published rating where it has one. The
   *  two together are what price it as an opponent — see `itemRating`. */
  source: PracticeSourceId;
  sourceRating?: number | null | undefined;
};

export type AssignmentCheck = { name: string; passed: boolean; detail: string };

/**
 * Facts about a problem the agent wants to set, returned with the assignment.
 *
 * Price and predicted solve chance, and whether the provider's own tags cover the
 * aim. These used to include a rating window ("outside the 881-1200 window …
 * that range is where to search") and two word-overlap checks on the agent's
 * rationale; the window was a heuristic stated as a rule, and the overlap
 * checks graded vocabulary rather than fit. What to make of the numbers is the
 * agent's call.
 */
export function assessPracticeAssignment(input: {
  target: PracticeTargetSnapshot;
  candidate: PracticeCandidateSnapshot;
  proposedConcepts: ConceptTagInput[];
}): AssignmentCheck[] {
  const { target, candidate, proposedConcepts } = input;
  const price = itemRating({ source: candidate.source, difficulty: candidate.difficulty, sourceRating: candidate.sourceRating });
  const chance = Math.round(solveProbability(target.rating, price) * 100);

  const primary = proposedConcepts.find((tag) => tag.role === "primary") ?? proposedConcepts[0];
  const actualConcepts = candidate.concepts.filter(Boolean);
  const providerFit = primary !== undefined && (actualConcepts.length === 0 || actualConcepts.some((actual) => relatedConcept(primary, actual)));

  return [
    {
      name: "learner level",
      passed: true,
      detail: `Priced at ${price}; at their rating they would solve it about ${chance}% of the time.`,
    },
    {
      name: "provider concept",
      passed: providerFit,
      detail: providerFit
        ? actualConcepts.length ? `The primary aim ${primary?.slug} belongs to the provider concept family ${actualConcepts.join(", ")}.` : "The provider has no mapped concept metadata."
        : `The primary aim ${primary?.slug || "was not supplied"} is not among the provider's tags (${actualConcepts.join(", ") || "none mapped"}). Provider tags are coarse and named differently from Spar's concepts, so this is about naming as much as fit: the statement is what decides it.`,
    },
  ];
}

function relatedConcept(proposed: ConceptTagInput, actual: string): boolean {
  const proposedFamily = conceptFamily(proposed.slug, proposed.parentSlug);
  const actualFamily = conceptFamily(actual);
  return [...proposedFamily].some((slug) => actualFamily.has(slug));
}

function conceptFamily(slug: string, explicitParent?: string | null): Set<string> {
  const family = new Set<string>();
  let current: string | null | undefined = normalize(slug);
  let first = true;
  for (let depth = 0; current && depth < 5; depth += 1) {
    family.add(current);
    const parent: string | null | undefined = first && explicitParent ? explicitParent : seededConcept(current)?.parentSlug;
    current = parent ? normalize(parent) : null;
    first = false;
  }
  return family;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
