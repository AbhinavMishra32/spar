import { challengeItemRating, outcomeScore, type ChallengeSource, type RatingResult } from "@spar/domain";

/**
 * A finished challenge as one Glicko-2 result.
 *
 * Kept out of the store so the judgement it encodes can be tested without a
 * database. How hard the challenge was is `challengeItemRating`'s judgement now
 * rather than this one's, because the learner is shown that number before they
 * start and two places deciding it is two answers. What is left here is the half
 * that only exists once an attempt is over:
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
  const { rating, deviation } = challengeItemRating(challenge);
  return { rating, deviation, score };
}

/** Days between two ISO timestamps, for the deviation decay. Never negative: a
 *  clock that went backwards must not sharpen a rating. */
export function elapsedDays(from: string, to: string): number {
  return Math.max(0, (Date.parse(to) - Date.parse(from)) / 86_400_000);
}
