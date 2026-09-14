import { INITIAL_RATING, RATING_FLOOR } from "@spar/domain";

/**
 * The Spar Rating, and the two contest scales it is shown against.
 *
 * There is one rated quantity in Spar and it is the Glicko-2 rating in
 * `@spar/domain/rating`. It is estimated on the Codeforces scale, because that
 * is the scale the items are on: a Codeforces problem rating is defined as the
 * rating at which a solver is even money against it, which is exactly what
 * Glicko-2 estimates. Everything here is presentation of that one number.
 *
 * Three presentations, each with a stated anchor:
 *
 * - The Spar Rating is Spar's own band. It is an affine map of the underlying
 *   rating and nothing else — no second estimate, no separate history. It exists
 *   because the headline figure should be Spar's, not a number borrowed from a
 *   site the learner may not even have an account on.
 * - Codeforces is the underlying rating, unchanged. No conversion happens, which
 *   is the whole reason the estimate is run on that scale.
 * - LeetCode is the one real translation, and the only place here with any give
 *   in it. See `LEETCODE_ANCHORS`.
 *
 * What this replaces was a linear stretch from an invented 700–1800 span onto
 * invented per-site floors and ceilings — three made-up numbers per site, none
 * of them anchored to anything either site publishes.
 */

/** Spar's own band. The floor is the rating floor; the ceiling is the top of the
 *  range Spar's material can evidence — roughly Codeforces' candidate-master
 *  line, above which a rating would be claiming things about the learner that no
 *  challenge Spar has set them could support. */
const SPAR_FLOOR = 700;
const SPAR_CEILING = 1800;
const UNDERLYING_FLOOR = RATING_FLOOR;
const UNDERLYING_CEILING = 2400;

/**
 * The headline figure.
 *
 * Affine and monotone, so every property of the underlying rating survives it:
 * the order of two learners, the sign of a change, and the fact that a bigger
 * result moves it further. It compresses — 1600 underlying points become 1100 —
 * which is why the store's "don't record a move under 10 points" rule is applied
 * to the underlying rating rather than to this, and why this is rounded to the
 * point rather than to anything coarser.
 */
export function sparRating(rating: number): number {
  const span = (UNDERLYING_CEILING - UNDERLYING_FLOOR) / (SPAR_CEILING - SPAR_FLOOR);
  return Math.round(Math.max(SPAR_FLOOR, Math.min(SPAR_CEILING, SPAR_FLOOR + (rating - UNDERLYING_FLOOR) / span)));
}

/** Where a learner Spar has never rated starts, in Spar's own band. Exported so
 *  copy about the starting figure cannot drift from the figure. */
export const SPAR_INITIAL_RATING = sparRating(INITIAL_RATING);

export type ContestSite = "leetcode" | "codeforces";

/**
 * LeetCode against Codeforces, at the points where the two populations can
 * actually be compared: the boundaries of LeetCode's three problem bands and the
 * Codeforces ratings of problems that sit at the same boundaries.
 *
 * These are the same anchors `itemRating` uses to price a LeetCode problem as an
 * opponent, read the other way round — a learner who is even money against
 * LeetCode mediums and a learner who is even money against 1600-rated Codeforces
 * problems are the same learner, so that pair is a point on this curve. Between
 * the anchors it interpolates; past the ends it holds the end slope rather than
 * clamping, because a learner above the top anchor is still above it.
 *
 * The result is rounded to 10 and prefixed "~" in the UI. It is an approximation
 * of a population, not a score LeetCode has given anybody.
 */
const LEETCODE_ANCHORS: Array<[codeforces: number, leetcode: number]> = [
  [800, 1200],
  [1100, 1400],
  [1600, 1750],
  [2200, 2150],
  [2400, 2350],
];

export function approximateRating(rating: number, site: ContestSite): number {
  if (site === "codeforces") return Math.round(rating / 10) * 10;
  return Math.round(interpolate(rating, LEETCODE_ANCHORS) / 10) * 10;
}

function interpolate(value: number, anchors: Array<[number, number]>): number {
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (value <= first[0]) return first[1] + (value - first[0]) * slope(anchors[0]!, anchors[1]!);
  if (value >= last[0]) return last[1] + (value - last[0]) * slope(anchors[anchors.length - 2]!, last);
  for (let index = 1; index < anchors.length; index += 1) {
    const low = anchors[index - 1]!;
    const high = anchors[index]!;
    if (value <= high[0]) return low[1] + (value - low[0]) * slope(low, high);
  }
  return last[1];
}

const slope = (low: [number, number], high: [number, number]) => (high[1] - low[1]) / (high[0] - low[0]);
