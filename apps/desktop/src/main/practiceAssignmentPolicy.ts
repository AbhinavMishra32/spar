import { ESTABLISHED_DEVIATION, itemRating, itemRatingFor, solveProbability, type AbilityStatus, type LearnerProfile, type Rating, seededConcept } from "@spar/domain";
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
 * Advisory evidence about a problem the agent wants to set.
 *
 * The level check used to read a difficulty word against a bucket keyed on the
 * ability's status, because a word was all Spar had: three provider labels
 * covering everything from a warm-up to a contest problem, matched against
 * "uncertain" or "developing". It is now the rating, against the problem's own
 * price on the same scale — see `trainingWindow`. The concept and rationale
 * comparisons are also advisory; the agent owns the teaching choice.
 */
export function assessPracticeAssignment(input: {
  target: PracticeTargetSnapshot;
  candidate: PracticeCandidateSnapshot;
  proposedConcepts: ConceptTagInput[];
  why: string;
}): AssignmentCheck[] {
  const { target, candidate, proposedConcepts, why } = input;
  const window = trainingWindow(target);
  const price = itemRating({ source: candidate.source, difficulty: candidate.difficulty, sourceRating: candidate.sourceRating });
  const levelPassed = price >= window.minRating && price <= window.maxRating;
  const chance = Math.round(solveProbability(target.rating, price) * 100);

  const primary = proposedConcepts.find((tag) => tag.role === "primary") ?? proposedConcepts[0];
  const actualConcepts = candidate.concepts.filter(Boolean);
  const providerFit = primary !== undefined && (actualConcepts.length === 0 || actualConcepts.some((actual) => relatedConcept(primary, actual)));

  const abilityFit = primary !== undefined && (
    target.abilityConcepts.length
      ? target.abilityConcepts.some((abilityConcept) => relatedConcept(primary, abilityConcept))
      : overlaps(primary.slug, `${target.abilityTitle} ${target.specificGap}`)
  );
  const rationaleFit = overlaps(why, `${target.abilityTitle} ${target.specificGap} ${target.desiredEvidence}`);

  return [
    {
      name: "learner level",
      passed: levelPassed,
      /* Stated in both currencies on purpose. The rating window is the actual
         rule and the agent has to be able to search against it, but "they would
         solve this about a third of the time" is the sentence that says what the
         comparison is for, while the agent remains free to choose this problem. */
      detail: levelPassed
        ? `Priced at ${price}, inside the ${window.minRating}-${window.maxRating} window for a ${target.abilityStatus} ability. They would solve it about ${chance}% of the time, which is the range a result is worth reading.`
        : `Priced at ${price}, outside the ${window.minRating}-${window.maxRating} window for a ${target.abilityStatus} ability — they would solve it about ${chance}% of the time, so ${price > window.maxRating ? "a failure would not say which gap it was" : "a pass would not say anything they have not already shown"}. Search that rating range instead.`,
    },
    {
      name: "provider concept",
      passed: providerFit,
      detail: providerFit
        ? actualConcepts.length ? `The primary aim ${primary?.slug} belongs to the provider concept family ${actualConcepts.join(", ")}.` : "The provider has no mapped concept metadata; target rationale remains required."
        : `The primary aim ${primary?.slug || "was not supplied"} does not belong to the provider's ${actualConcepts.join(", ") || "mapped concepts"}. Read the problem and choose one on the target's concept family.`,
    },
    {
      name: "ability alignment",
      passed: abilityFit,
      detail: abilityFit
        ? `The primary aim is connected to ${target.abilityTitle}: ${target.specificGap}.`
        : `The primary concept ${primary?.slug || "was not supplied"} is not connected to the persisted ability "${target.abilityTitle}" and gap "${target.specificGap}".`,
    },
    {
      name: "target rationale",
      passed: rationaleFit,
      detail: rationaleFit
        ? "The assignment rationale names the persisted target it is meant to discriminate."
        : `The rationale does not connect this problem to "${target.specificGap}" or the desired evidence "${target.desiredEvidence}". Pick a better-fitting problem or explain the concrete connection.`,
    },
  ];
}

/**
 * How likely the learner should be to solve what they are set, by what Spar is
 * trying to find out about the ability.
 *
 * A problem is worth setting when its result is worth reading, and that is a
 * statement about probability rather than about difficulty. Something they would
 * solve nineteen times out of twenty teaches Spar nothing when they solve it;
 * something they would solve once in twenty teaches Spar nothing when they do
 * not, because the failure has too many available explanations to name one.
 *
 * The bands differ by status because the question differs:
 *
 * - `uncertain` is a diagnostic. Aim near even money, where the outcome carries
 *   the most information, and stay off the hard end — a learner can fail a
 *   problem well above them for reasons that have nothing to do with the gap
 *   being investigated, and the whole point of the attempt is to name the gap.
 * - `developing` is practice. Pitched slightly against them, which is where
 *   effort is required and the shape of the mistake shows.
 * - `independent` is monitoring, and only a stretch is informative: Spar already
 *   believes this, so a problem they would comfortably solve confirms nothing.
 * - `stale` is a re-check, so it is the diagnostic band again.
 */
const TARGET_SOLVE_PROBABILITY: Record<AbilityStatus, [hardest: number, easiest: number]> = {
  uncertain: [0.45, 0.85],
  developing: [0.35, 0.75],
  independent: [0.2, 0.55],
  stale: [0.4, 0.8],
};

/** The top of each provider band, as a price. What a claimed experience level is
 *  allowed to mean while Spar has not measured anything yet. */
const EXPERIENCE_CEILING: Record<LearnerProfile["experience"], number> = {
  new: 1200,
  working: 1700,
  senior: Number.POSITIVE_INFINITY,
};

/**
 * The range of problem difficulty worth setting, in item-rating points.
 *
 * Inverted out of the same curve that scores the result afterwards, so the
 * advisory comparison and the rating cannot drift apart.
 * It widens on its own while the rating is provisional, because `itemRatingFor`
 * flattens for an uncertain learner — when Spar does not know where somebody is,
 * more problems are plausibly the right one.
 *
 * The profile's experience caps the top of it, and only until the rating is
 * established. Every learner starts at the same provisional 1500 whatever they
 * said about themselves, and handing a beginner a 1500-rated problem on the
 * strength of an assumption Spar made about them is a reason to check the level
 * carefully. Once the deviation has come down the cap is gone: what they
 * said they were stops mattering the moment there is evidence of what they are.
 */
export function trainingWindow(input: { rating: Rating; abilityStatus: AbilityStatus; experience?: LearnerProfile["experience"] }) {
  const [hardest, easiest] = TARGET_SOLVE_PROBABILITY[input.abilityStatus];
  const minRating = Math.round(itemRatingFor(input.rating, easiest));
  const measured = input.rating.deviation <= ESTABLISHED_DEVIATION;
  const ceiling = measured ? Number.POSITIVE_INFINITY : EXPERIENCE_CEILING[input.experience ?? "new"];
  /* The cap never closes the window: a beginner whose band starts above their
     ceiling still gets the easiest thing the band allows rather than nothing. */
  return { minRating, maxRating: Math.max(minRating, Math.round(Math.min(itemRatingFor(input.rating, hardest), ceiling))) };
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

function overlaps(left: string, right: string): boolean {
  const rightTokens = tokens(right);
  return [...tokens(left)].some((token) => rightTokens.has(token));
}

const STOP_WORDS = new Set(["about", "ability", "agent", "code", "correct", "demonstrate", "evidence", "implement", "learner", "problem", "show", "solution", "solve", "test", "testing", "their", "this", "using", "with"]);

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split("-").map(stem).filter((token) => token.length >= 3 && !STOP_WORDS.has(token)));
}

function stem(value: string): string {
  let token = value;
  if (token.length > 6 && token.endsWith("ing")) token = token.slice(0, -3);
  else if (token.length > 5 && token.endsWith("ed")) token = token.slice(0, -2);
  else if (token.length > 4 && token.endsWith("es")) token = token.slice(0, -2);
  else if (token.length > 3 && token.endsWith("s")) token = token.slice(0, -1);
  if (token.length > 3 && token.at(-1) === token.at(-2)) token = token.slice(0, -1);
  return token;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
