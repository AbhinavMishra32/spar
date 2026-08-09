import { seededConcept, type AbilityStatus, type LearnerProfile } from "@spar/domain";
import type { PracticeDifficulty } from "@spar/practice";
import type { ConceptTagInput } from "./store.js";

export type PracticeTargetSnapshot = {
  abilityTitle: string;
  specificGap: string;
  desiredEvidence: string;
  abilityStatus: AbilityStatus;
  abilityConcepts: string[];
  experience: LearnerProfile["experience"];
};

export type PracticeCandidateSnapshot = {
  difficulty: PracticeDifficulty;
  concepts: string[];
};

export type AssignmentCheck = { name: string; passed: boolean; detail: string };

/** Provider difficulty labels are coarse, so the policy admits an evidence band
 * rather than pretending one label is a psychometric score. The important hard
 * boundaries are that an untested ability never receives a hard problem and an
 * independently demonstrated ability is not assessed with an easy diagnostic. */
export function assessPracticeAssignment(input: {
  target: PracticeTargetSnapshot;
  candidate: PracticeCandidateSnapshot;
  proposedConcepts: ConceptTagInput[];
  why: string;
}): AssignmentCheck[] {
  const { target, candidate, proposedConcepts, why } = input;
  const allowed = difficultyBand(target.abilityStatus, target.experience);
  const levelPassed = allowed.includes(candidate.difficulty);

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
      detail: levelPassed
        ? `${candidate.difficulty} is inside the ${target.abilityStatus} ability band (${allowed.join(" or ")}).`
        : `${candidate.difficulty} is outside the learner's ${target.abilityStatus} ability band. Choose ${allowed.join(" or ")} for this target.`,
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

export function difficultyBand(status: AbilityStatus, experience: LearnerProfile["experience"] = "new"): PracticeDifficulty[] {
  if (status === "uncertain") return experience === "new" ? ["easy"] : ["easy", "medium"];
  if (status === "independent") return ["medium", "hard"];
  return ["easy", "medium"];
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
