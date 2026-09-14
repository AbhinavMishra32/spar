import { ITEM_DEVIATION, generatedItemRating, itemDeviation, itemRating, outcomeScore, type ChallengeSource, type RatingResult } from "@spar/domain";

/**
 * A finished challenge as one Glicko-2 result.
 *
 * Kept out of the store so the judgement it encodes can be tested without a
 * database. There are only two judgements in it, and both are about what Spar
 * actually knows rather than about what would be convenient to score:
 *
 * How hard the challenge was. A Codeforces problem with a published rating is
 * taken at that rating, because it is already the scale the learner is rated on.
 * Anything else is banded, and says so by carrying a wider deviation, which is
 * how Glicko discounts a result against an opponent whose own rating is a guess.
 * A challenge Spar wrote has no public difficulty at all, so it is priced by its
 * own difficulty word against an absolute anchor — see `generatedItemRating`, and
 * note that pricing it against the learner instead is what made the first cut of
 * this a ratchet rather than a rating.
 *
 * How the learner did. Spar only ends an attempt two ways: they solved it, or
 * they gave up on it. A failed submission leaves the attempt open, so "failed"
 * is not an outcome here — the learner is still working. That makes the scoring
 * the plain one: a solve is a win, giving up is a loss, and a solve that needed
 * hints is a draw.
 */
export type FinishedChallenge = {
  outcome: string | null;
  /** Whether a hint was requested during the attempt. */
  assisted: boolean;
  difficulty: "foundation" | "developing" | "proficient" | "advanced";
  source: ChallengeSource | null;
};

export function challengeResult(challenge: FinishedChallenge): RatingResult | null {
  const score = outcomeScore(challenge.outcome, { assisted: challenge.assisted });
  if (score === null) return null;
  const source = challenge.source;
  return source
    ? { rating: itemRating({ source: source.source, difficulty: source.difficulty, sourceRating: source.sourceRating }), deviation: itemDeviation({ source: source.source, sourceRating: source.sourceRating }), score }
    : { rating: generatedItemRating(challenge.difficulty), deviation: ITEM_DEVIATION.generated, score };
}

/** Days between two ISO timestamps, for the deviation decay. Never negative: a
 *  clock that went backwards must not sharpen a rating. */
export function elapsedDays(from: string, to: string): number {
  return Math.max(0, (Date.parse(to) - Date.parse(from)) / 86_400_000);
}
