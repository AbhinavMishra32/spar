/**
 * The Spar Rating, as a rating system rather than as a rescaled average.
 *
 * What was here before was `700 + meanProficiency × 1100`: the confidence-weighted
 * mean of every ability's proficiency, stretched onto a four-figure span. It read
 * like a rating and was not one. It had no notion of how hard the thing attempted
 * was, so solving an 800-rated warm-up and a 2400-rated hard problem moved it by
 * the same amount; it was recomputed from ability state rather than updated from
 * outcomes, so it could not fall on a failure; and the scale it was printed on was
 * chosen because four figures look like a rating.
 *
 * This is Glicko-2 — Mark Glickman's published successor to Glicko and Elo, the
 * one Lichess and Chess.com rate puzzles with. That is the right family because
 * Spar's situation is the puzzle one exactly: a single learner against an item of
 * known difficulty, one at a time, with an outcome. There is no field of
 * contestants to rank against each other, so the expected-rank seeding LeetCode
 * uses for its contests has nothing to seed from here.
 *
 * Glicko-2 over plain Elo for one reason that matters to Spar: it carries a
 * rating deviation alongside the rating. `provisional` stops being the guess
 * `evidenceCount < 8` and becomes what it means everywhere else — the interval
 * around this number is still too wide to quote. RD also decides how far one
 * result moves the rating, which is why a learner's first five challenges move
 * it a long way and their fiftieth barely does, without a hand-tuned schedule.
 *
 * The scale is Codeforces'. Codeforces problem ratings and Codeforces user
 * ratings are the same scale by construction — a user rated R solves an R-rated
 * problem about half the time — which is precisely the quantity Glicko-2
 * estimates. So the difficulties fed in and the rating that comes out are already
 * in the same units, and "roughly Codeforces" is not a conversion at all. See
 * `itemRating` for how everything that is not a rated Codeforces problem is put
 * onto that scale, and `ratingScale.ts` for the one site that does need mapping.
 *
 * Reference: Glickman, "Example of the Glicko-2 system" (glicko.net/glicko/glicko2.pdf).
 * The step numbering in the comments below is his.
 */

/** Glicko-2's internal scale factor, from the paper. Ratings are converted onto a
 *  scale where 1500 is 0 and one step is 173.7178 rating points. */
const SCALE = 173.7178;

/** Where an unrated learner starts. 1500 is Glicko's own default and LeetCode's
 *  starting contest rating; on the Codeforces scale it sits just above the
 *  newcomer band, which is the right place for somebody who has done some
 *  programming but has not shown Spar any of it yet. */
export const INITIAL_RATING = 1500;
/** Glickman's default initial deviation: 1500 ± 2×350 spans essentially the whole
 *  scale, which is an honest statement of knowing nothing. */
export const INITIAL_DEVIATION = 350;
/** Glickman's default initial volatility. */
export const INITIAL_VOLATILITY = 0.06;

/**
 * The system constant τ — how much the volatility itself is allowed to move.
 *
 * Glickman: "Smaller values of τ prevent the volatility measures from changing by
 * large amounts, which in turn prevent enormous changes in ratings based on very
 * improbable results. Reasonable choices are between 0.3 and 1.2." Spar sits at
 * the cautious end. A learner who fails one problem far below their rating has
 * usually misread it or run out of time, and that should not be allowed to
 * declare their whole rating unreliable.
 */
const TAU = 0.5;

/** Above this deviation the rating is quoted as provisional. Glicko's own
 *  convention for an "established" rating is RD below 110; the same threshold
 *  is what decides the badge rather than a second, separate rule. */
export const ESTABLISHED_DEVIATION = 110;

/** The rating floor. Codeforces does not issue ratings below its newcomer band
 *  and neither does Spar, so a run of failures bottoms out rather than
 *  producing a number no scale has a meaning for. */
export const RATING_FLOOR = 800;

export type Rating = {
  rating: number;
  /** Rating deviation: the standard deviation of the estimate. */
  deviation: number;
  /** Expected fluctuation in the rating, Glicko-2's σ. */
  volatility: number;
};

/** One graded result: an item of known difficulty, and how the learner did
 *  against it. `score` is 1 for a win, 0 for a loss, 0.5 for a draw — see
 *  `outcomeScore` for what those mean when the opponent is a problem. */
export type RatingResult = { rating: number; deviation: number; score: number };

export const UNRATED: Rating = { rating: INITIAL_RATING, deviation: INITIAL_DEVIATION, volatility: INITIAL_VOLATILITY };

/** Step 2: onto the Glicko-2 scale. */
const toGlicko2 = (rating: Rating) => ({ mu: (rating.rating - INITIAL_RATING) / SCALE, phi: rating.deviation / SCALE, sigma: rating.volatility });

/** Glickman's g(φ): how much an opponent's own uncertainty discounts the result.
 *  Beating somebody whose rating is barely known tells you less. */
const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

/** Glickman's E(μ, μ_j, φ_j): the expected score against one opponent. With
 *  φ_j = 0 this is exactly the Elo logistic curve with a 400-point decade. */
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * The probability the learner solves an item of this difficulty, on the rating
 * scale rather than Glicko-2's internal one.
 *
 * This is the system's one falsifiable claim and the reason the scale is
 * Codeforces': at equal ratings it returns 0.5, which is what a Codeforces
 * problem rating is defined to mean. Used to pitch challenges at a target
 * success rate rather than at a difficulty word.
 */
export function solveProbability(rating: Rating, itemRating: number): number {
  const { mu, phi } = toGlicko2(rating);
  return expected(mu, (itemRating - INITIAL_RATING) / SCALE, phi);
}

/**
 * The same claim, asked the other way round: the item rating this learner solves
 * with exactly this probability.
 *
 * `solveProbability` answers "how likely is this one", which is the question you
 * have once a problem is in front of you. Choosing what to set next is the
 * inverse — "what should I be looking for" — and it is the question problem
 * selection actually asks, so it gets an exact inverse rather than a second
 * curve fitted alongside the first. Round-tripping any probability through both
 * returns it, which means the gate that admits a problem and the number that
 * scores it afterwards can never come to disagree.
 *
 * It inherits the flattening `solveProbability` applies for an uncertain
 * learner, and that is the point rather than a side effect. A wide deviation
 * flattens the curve, so the item ratings spanning a given probability band sit
 * further apart, and the window of problems worth setting is wider. When Spar
 * does not know where somebody is, more problems are plausibly the right one.
 */
export function itemRatingFor(rating: Rating, probability: number): number {
  const bounded = Math.min(0.999, Math.max(0.001, probability));
  const { mu, phi } = toGlicko2(rating);
  return (mu + Math.log(1 / bounded - 1) / g(phi)) * SCALE + INITIAL_RATING;
}

/**
 * Step 6, applied before a result rather than after: a rating nobody has tested
 * for a while is less certain than it was.
 *
 * Glickman defines a rating period and increases φ once per idle period. Spar has
 * no periods — challenges arrive whenever the learner sits down — so the same
 * increase is applied per elapsed period at the point the rating is next used.
 * Without this a learner who stops for six months comes back with a rating that
 * claims the same precision it had the day they left.
 */
export const RATING_PERIOD_DAYS = 14;

export function decay(rating: Rating, elapsedDays: number): Rating {
  const periods = Math.max(0, elapsedDays / RATING_PERIOD_DAYS);
  if (!periods) return rating;
  const { phi, sigma } = toGlicko2(rating);
  const decayed = Math.sqrt(phi * phi + periods * sigma * sigma);
  return { ...rating, deviation: Math.min(INITIAL_DEVIATION, decayed * SCALE) };
}

/**
 * One rating period's update: Glickman's steps 3 through 8.
 *
 * Results are normally a single item, because that is how Spar delivers them, but
 * the batch form is the paper's and a replay of history can hand it several at
 * once without changing the arithmetic.
 */
export function updateRating(rating: Rating, results: RatingResult[]): Rating {
  /* Step 6: a period in which the learner did nothing widens the deviation and
     leaves everything else alone. */
  if (!results.length) {
    const { phi, sigma } = toGlicko2(rating);
    return { ...rating, deviation: Math.min(INITIAL_DEVIATION, Math.sqrt(phi * phi + sigma * sigma) * SCALE) };
  }

  const { mu, phi, sigma } = toGlicko2(rating);
  const opponents = results.map((result) => {
    const muJ = (result.rating - INITIAL_RATING) / SCALE;
    const phiJ = result.deviation / SCALE;
    return { gJ: g(phiJ), expectedScore: expected(mu, muJ, phiJ), score: result.score };
  });

  /* Step 3: v, the estimated variance of the rating based only on game outcomes. */
  const v = 1 / opponents.reduce((sum, item) => sum + item.gJ * item.gJ * item.expectedScore * (1 - item.expectedScore), 0);
  /* Step 4: Δ, the estimated improvement in rating. */
  const delta = v * opponents.reduce((sum, item) => sum + item.gJ * (item.score - item.expectedScore), 0);

  /* Step 5: the new volatility, by the paper's Illinois-variant root finder on
     f(x). This is the part of Glicko-2 that is not in Glicko: it asks whether the
     results are more surprising than the current volatility predicts, and raises
     or lowers σ accordingly, which is what lets a genuine step change in skill be
     absorbed quickly without making every ordinary result noisy. */
  const sigmaPrime = Math.exp(solveVolatility({ delta, phi, v, sigma }) / 2);

  /* Step 6: pre-rating-period deviation. Step 7: the new deviation and rating. */
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * opponents.reduce((sum, item) => sum + item.gJ * (item.score - item.expectedScore), 0);

  /* Step 8: back onto the rating scale. */
  return {
    rating: Math.max(RATING_FLOOR, INITIAL_RATING + SCALE * muPrime),
    deviation: Math.min(INITIAL_DEVIATION, SCALE * phiPrime),
    volatility: sigmaPrime,
  };
}

/** Step 5 in full: find the root of f(x) = 0 with the Illinois algorithm, exactly
 *  as the paper sets it out. Iteration is bounded because a root finder inside a
 *  database write must terminate; ε and the bound are the paper's own. */
function solveVolatility({ delta, phi, v, sigma }: { delta: number; phi: number; v: number; sigma: number }): number {
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const exp = Math.exp(x);
    const denominator = 2 * Math.pow(phi * phi + v + exp, 2);
    return (exp * (delta * delta - phi * phi - v - exp)) / denominator - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0 && k < 100) k += 1;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  for (let iteration = 0; Math.abs(B - A) > 1e-6 && iteration < 100; iteration += 1) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C;
    fB = fC;
  }
  return A;
}

/**
 * What a challenge is worth as an opponent, on the Codeforces scale.
 *
 * The order is deliberate: a real number the source published beats any band Spar
 * would infer. Codeforces rates most of its problemset and that number is the
 * same scale as the learner's rating, so it is used as-is. Everything else is put
 * on that scale by its band.
 *
 * The LeetCode anchors are the medians of the community difficulty ratings
 * (the projection LeetCode contest results imply for each problem, as compiled
 * from contest performance) translated onto the Codeforces scale by the bands the
 * two sites' populations share. They are approximations of a distribution, not
 * measurements of a problem, which is why a rated Codeforces problem is always
 * preferred and why the LeetCode numbers are round.
 *
 * Spar's own four difficulty words are anchored the same way, in `SPAR_BAND`
 * below — absolutely, and deliberately not against the learner they were written
 * for. See `generatedItemRating` for why that distinction is the difference
 * between a rating and a counter.
 */
const LEETCODE_BAND: Record<"easy" | "medium" | "hard", number> = { easy: 1200, medium: 1600, hard: 2100 };
const CODEFORCES_BAND: Record<"easy" | "medium" | "hard", number> = { easy: 1100, medium: 1600, hard: 2200 };

export function itemRating(item: { source: "leetcode" | "codeforces"; difficulty: "easy" | "medium" | "hard"; sourceRating?: number | null | undefined }): number {
  if (item.source === "codeforces" && item.sourceRating) return item.sourceRating;
  return (item.source === "leetcode" ? LEETCODE_BAND : CODEFORCES_BAND)[item.difficulty];
}

/**
 * What a Spar-authored challenge is worth.
 *
 * Absolutely, from its difficulty word alone — not relative to the learner it was
 * written for. The relative reading is tempting and it is fatal: price an item at
 * `learnerRating + offset` and every solve raises the rating, which raises the
 * price of the next item, which raises the rating again. Fourteen solves of the
 * same warm-up climbed from 1500 to 2700 in testing, because nothing in the loop
 * was fixed. A rating estimates ability against difficulty; if difficulty is
 * defined in terms of the estimate there is no ability left in it, and the number
 * measures how many challenges you have done.
 *
 * So the four difficulty words get four absolute anchors, the same way LeetCode's
 * three bands do. They sit below the public-problem bands on purpose: a Spar
 * challenge is a targeted exercise on one ability, narrower than a contest
 * problem of the same word, and pricing them alike would pay a learner contest
 * credit for a drill. They are also the least certain items Spar rates anybody
 * against — one author, no solvers, no distribution — which `itemDeviation`
 * records as the widest deviation of the three, so a generated result moves the
 * rating a good deal less than a rated Codeforces problem does.
 */
const SPAR_BAND: Record<"foundation" | "developing" | "proficient" | "advanced", number> = {
  foundation: 900,
  developing: 1200,
  proficient: 1500,
  advanced: 1800,
};

export function generatedItemRating(difficulty: "foundation" | "developing" | "proficient" | "advanced"): number {
  return SPAR_BAND[difficulty];
}

/** The four words in price order, for the places that have to choose one rather
 *  than price one that has already been chosen. */
export const GENERATED_DIFFICULTIES = ["foundation", "developing", "proficient", "advanced"] as const;

/**
 * The difficulty word whose price sits closest to the middle of a target window.
 *
 * Spar's four anchors are absolute and 300 points apart, and a training window is
 * about 300 points wide, so for most learners exactly one word lands inside it —
 * which is the word the agent should be writing to. Returning the nearest rather
 * than only an exact hit is deliberate: above roughly 2000 the window climbs past
 * `advanced` and no word is inside it, and a learner who has outgrown the top
 * band still has to be given something.
 */
export function generatedDifficultyFor(window: { minRating: number; maxRating: number }): "foundation" | "developing" | "proficient" | "advanced" {
  const middle = (window.minRating + window.maxRating) / 2;
  return GENERATED_DIFFICULTIES.reduce((best, word) =>
    Math.abs(SPAR_BAND[word] - middle) < Math.abs(SPAR_BAND[best] - middle) ? word : best,
  );
}

/**
 * How certain the item's own rating is, which decides how much weight the result
 * carries. Glicko's g(φ) discounts a result against an opponent whose rating is
 * itself a guess, and Spar's items differ enormously in how well known they are.
 *
 * A rated Codeforces problem has been solved by tens of thousands of people and
 * its rating is about as firm as a rating gets. A difficulty band is one of three
 * buckets covering a spread of many hundreds of points. A challenge Spar wrote
 * this morning has been attempted by exactly one person.
 */
export const ITEM_DEVIATION = { rated: 50, band: 150, generated: 250 } as const;

export function itemDeviation(item: { source?: "leetcode" | "codeforces" | null | undefined; sourceRating?: number | null | undefined }): number {
  if (!item.source) return ITEM_DEVIATION.generated;
  return item.source === "codeforces" && item.sourceRating ? ITEM_DEVIATION.rated : ITEM_DEVIATION.band;
}

/** How a challenge's own rating is arrived at, which decides what the learner is
 *  told it is rather than only how firmly it is quoted. */
export type ItemBasis = "published" | "band" | "generated";

/**
 * What one challenge is worth as an opponent, whatever kind of challenge it is.
 *
 * The three cases were already decided — `itemRating` for a sourced problem,
 * `generatedItemRating` for one Spar wrote, `itemDeviation` for how firmly either
 * is known — but the choice between them lived inside the scorer, so it was only
 * ever made at the moment an attempt ended. A learner looking at a problem could
 * not be told what it was worth without a second copy of that choice, and a
 * second copy is a second answer as soon as either moves.
 *
 * So the choice lives here and the scorer calls it. The number shown on the
 * problem is the number the result is scored against, by construction rather than
 * by agreement. `basis` comes back with it because the three are not the same
 * kind of fact: a published Codeforces rating is a measurement, a band is a
 * bucket covering hundreds of points, and a generated challenge's word is one
 * author's judgement — and a UI that prints all three as a bare number says they
 * are equally solid when `deviation` already says they are not.
 */
export function challengeItemRating(challenge: {
  difficulty: "foundation" | "developing" | "proficient" | "advanced";
  source?: { source: "leetcode" | "codeforces"; difficulty: "easy" | "medium" | "hard"; sourceRating?: number | null | undefined } | null | undefined;
}): { rating: number; deviation: number; basis: ItemBasis } {
  const source = challenge.source;
  if (!source) return { rating: generatedItemRating(challenge.difficulty), deviation: ITEM_DEVIATION.generated, basis: "generated" };
  return {
    rating: itemRating({ source: source.source, difficulty: source.difficulty, sourceRating: source.sourceRating }),
    deviation: itemDeviation({ source: source.source, sourceRating: source.sourceRating }),
    basis: source.source === "codeforces" && source.sourceRating ? "published" : "band",
  };
}

/**
 * An attempt's outcome as a score against the problem.
 *
 * Spar ends an attempt two ways, and neither of them is "failed". A wrong
 * submission leaves the attempt open — the learner keeps working and submits
 * again — so the only ways out are solving it and giving up on it. That makes
 * the scoring the plain one every system in this family uses: a solve is a win,
 * and conceding is a loss.
 *
 * The half point is for a solve that needed hints. The learner did get there, and
 * scoring that the same as giving up would be false; but a hinted solve is not
 * evidence that they can clear a problem at that rating unaided, which is the
 * only thing the rating claims. A draw is the standard way to say "closer than a
 * loss, short of a win" inside a system that only understands scores.
 *
 * A challenge the agent replaced is not a result at all. That was Spar's decision
 * about the challenge, not the learner's performance on it, and rating it either
 * way would let the agent move the learner's rating by changing its mind.
 */
export function outcomeScore(outcome: string | null, options: { assisted?: boolean } = {}): number | null {
  if (outcome === "passed") return options.assisted ? 0.5 : 1;
  if (outcome === "failed" || outcome === "abandoned") return 0;
  return null;
}
