/**
 * Spar Rating → an approximate contest rating.
 *
 * The Spar Rating is `700 + performance × 1100`, where performance is the
 * confidence-weighted mean proficiency across every ability. It is not an Elo
 * and it has never played anybody, so converting it means converting the
 * performance underneath rather than the number on top.
 *
 * The anchors are each scale's own shape: a floor at roughly where a new entrant
 * sits, and a ceiling at roughly where somebody fluent in everything Spar has
 * taught them would land. Both ends are approximations, and the result is
 * rounded to the nearest 50 so it cannot be read as a measurement.
 */
const SCALE = {
  leetcode: { floor: 1300, ceiling: 2300 },
  codeforces: { floor: 800, ceiling: 2100 },
} as const;

export type ContestSite = keyof typeof SCALE;

/** Spar's own floor and span, from `recalculateRating` in the store. */
const SPAR_FLOOR = 700;
const SPAR_SPAN = 1100;

export function approximateRating(rating: number, site: ContestSite): number {
  const { ceiling, floor } = SCALE[site];
  const performance = Math.max(0, Math.min(1, (rating - SPAR_FLOOR) / SPAR_SPAN));
  return Math.round((floor + performance * (ceiling - floor)) / 50) * 50;
}
