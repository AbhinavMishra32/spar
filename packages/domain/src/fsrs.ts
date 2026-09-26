/**
 * FSRS-6, the scheduler Anki ships, written out rather than depended on.
 *
 * Each review card carries a memory state of two numbers. Stability (S) is how
 * many days until the chance of recalling it falls to 90%. Difficulty (D, 1–10)
 * is how hard it is to make that number grow. Retrievability (R) is the chance of
 * recall right now, read off the forgetting curve from S and the days elapsed.
 * A review is graded Again / Hard / Good / Easy. The grade and the R at that
 * moment move S and D, and the next review is scheduled for the day R is
 * expected to reach the desired retention.
 *
 * This is kept dependency-free on purpose: the formulas are a page long, the
 * domain package ships to the renderer, the main process and the API alike, and
 * every one of them has to agree on what a card's next due date is. The
 * parameters are the published FSRS-6 defaults (open-spaced-repetition, fitted
 * on ~700M Anki reviews). Once a learner has a few hundred reviews they can be
 * refitted from `review_logs`, which record everything the optimiser needs.
 *
 * Reference: https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
 */

export type FsrsRating = 1 | 2 | 3 | 4;
export const FSRS_RATING = { again: 1, hard: 2, good: 3, easy: 4 } as const satisfies Record<string, FsrsRating>;
export type FsrsRatingName = keyof typeof FSRS_RATING;
export const FSRS_RATING_NAME: Record<FsrsRating, FsrsRatingName> = { 1: "again", 2: "hard", 3: "good", 4: "easy" };

export type FsrsState = "new" | "review" | "relearning";

export type MemoryState = {
  state: FsrsState;
  stability: number;
  difficulty: number;
  /** ISO time of the last graded review, or null for a card never reviewed. */
  lastReviewAt: string | null;
  dueAt: string;
  reps: number;
  lapses: number;
};

export type FsrsParameters = {
  w: readonly number[];
  /** The probability of recall at which a card comes due. 0.9 is Anki's default. */
  desiredRetention: number;
  maximumIntervalDays: number;
};

export const FSRS6_DEFAULT_WEIGHTS: readonly number[] = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

export const DEFAULT_FSRS: FsrsParameters = { w: FSRS6_DEFAULT_WEIGHTS, desiredRetention: 0.9, maximumIntervalDays: 365 };

const DAY_MS = 86_400_000;
const MIN_STABILITY = 0.001;

const clampDifficulty = (value: number) => Math.min(10, Math.max(1, value));

function decayOf(w: readonly number[]) {
  const decay = w[20]!;
  return { decay, factor: Math.pow(0.9, -1 / decay) - 1 };
}

/** The chance of recalling a card `elapsedDays` after its last review. */
export function retrievability(stability: number, elapsedDays: number, params: FsrsParameters = DEFAULT_FSRS): number {
  if (stability <= 0) return 0;
  const { decay, factor } = decayOf(params.w);
  return Math.pow(1 + factor * Math.max(0, elapsedDays) / stability, -decay);
}

/** Days until retrievability falls to the desired retention. Fractional; the
 *  caller rounds, because rounding depends on what the interval is for. */
export function intervalDays(stability: number, params: FsrsParameters = DEFAULT_FSRS): number {
  const { decay, factor } = decayOf(params.w);
  const raw = (stability / factor) * (Math.pow(params.desiredRetention, -1 / decay) - 1);
  return Math.min(params.maximumIntervalDays, Math.max(0, raw));
}

export function initialStability(rating: FsrsRating, params: FsrsParameters = DEFAULT_FSRS): number {
  return Math.max(MIN_STABILITY, params.w[rating - 1]!);
}

export function initialDifficulty(rating: FsrsRating, params: FsrsParameters = DEFAULT_FSRS): number {
  const w = params.w;
  return clampDifficulty(w[4]! - Math.exp(w[5]! * (rating - 1)) + 1);
}

export function nextDifficulty(difficulty: number, rating: FsrsRating, params: FsrsParameters = DEFAULT_FSRS): number {
  const w = params.w;
  const delta = -w[6]! * (rating - 3);
  // Linear damping: a card near 10 moves toward it slowly.
  const damped = difficulty + delta * ((10 - difficulty) / 9);
  // Mean reversion toward the difficulty of a card first rated Easy.
  const unclamped = initialDifficulty(4, params);
  return clampDifficulty(w[7]! * unclamped + (1 - w[7]!) * damped);
}

export function stabilityAfterRecall(difficulty: number, stability: number, r: number, rating: FsrsRating, params: FsrsParameters = DEFAULT_FSRS): number {
  const w = params.w;
  const hardPenalty = rating === 2 ? w[15]! : 1;
  const easyBonus = rating === 4 ? w[16]! : 1;
  const growth = Math.exp(w[8]!) * (11 - difficulty) * Math.pow(stability, -w[9]!) * (Math.exp(w[10]! * (1 - r)) - 1) * hardPenalty * easyBonus;
  return Math.max(MIN_STABILITY, stability * (1 + growth));
}

export function stabilityAfterLapse(difficulty: number, stability: number, r: number, params: FsrsParameters = DEFAULT_FSRS): number {
  const w = params.w;
  const forgot = w[11]! * Math.pow(difficulty, -w[12]!) * (Math.pow(stability + 1, w[13]!) - 1) * Math.exp(w[14]! * (1 - r));
  /* A lapse can never leave a card more stable than it was. FSRS-6 bounds it by
     the short-term curve's own ceiling, which is what the reference scheduler does. */
  return Math.max(MIN_STABILITY, Math.min(forgot, stability / Math.exp(w[17]! * w[18]!)));
}

/** A second review on the same day, where the forgetting curve has not had time
 *  to say anything and FSRS-6 uses its short-term model instead. */
export function stabilityShortTerm(stability: number, rating: FsrsRating, params: FsrsParameters = DEFAULT_FSRS): number {
  const w = params.w;
  let increase = Math.exp(w[17]! * (rating - 3 + w[18]!)) * Math.pow(stability, -w[19]!);
  if (rating >= 3) increase = Math.max(1, increase);
  return Math.max(MIN_STABILITY, stability * increase);
}

export function newMemoryState(now: Date): MemoryState {
  return { state: "new", stability: 0, difficulty: 0, lastReviewAt: null, dueAt: now.toISOString(), reps: 0, lapses: 0 };
}

export type ScheduledReview = {
  next: MemoryState;
  elapsedDays: number;
  scheduledDays: number;
  /** R at the moment of this review, before it was graded. 1 for a new card. */
  retrievability: number;
};

/**
 * Grade a card and schedule it again.
 *
 * `fuzzSeed` spreads cards that would otherwise all come due on the same day:
 * a learner who solves six sliding-window problems in one evening should not get
 * six reviews on the same morning three days later. It is deterministic in the
 * seed so the same review scheduled twice lands on the same day.
 */
export function scheduleReview(card: MemoryState, rating: FsrsRating, now: Date, params: FsrsParameters = DEFAULT_FSRS, fuzzSeed = ""): ScheduledReview {
  const elapsedDays = card.lastReviewAt ? Math.max(0, (now.getTime() - Date.parse(card.lastReviewAt)) / DAY_MS) : 0;
  let stability: number;
  let difficulty: number;
  let r = 1;
  if (card.state === "new" || card.stability <= 0) {
    stability = initialStability(rating, params);
    difficulty = initialDifficulty(rating, params);
  } else {
    r = retrievability(card.stability, elapsedDays, params);
    difficulty = nextDifficulty(card.difficulty, rating, params);
    if (elapsedDays < 1) stability = stabilityShortTerm(card.stability, rating, params);
    else if (rating === 1) stability = stabilityAfterLapse(card.difficulty, card.stability, r, params);
    else stability = stabilityAfterRecall(card.difficulty, card.stability, r, rating, params);
  }
  const lapsed = rating === 1 && card.state !== "new";
  const days = scheduledInterval(stability, rating, params, fuzzSeed);
  return {
    next: {
      state: lapsed ? "relearning" : "review",
      stability,
      difficulty,
      lastReviewAt: now.toISOString(),
      dueAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
      reps: card.reps + 1,
      lapses: card.lapses + (lapsed ? 1 : 0),
    },
    elapsedDays,
    scheduledDays: days,
    retrievability: r,
  };
}

/**
 * What each of the four grades would schedule, for the buttons that show it.
 */
export function previewSchedule(card: MemoryState, now: Date, params: FsrsParameters = DEFAULT_FSRS, fuzzSeed = ""): Record<FsrsRatingName, ScheduledReview> {
  return {
    again: scheduleReview(card, 1, now, params, fuzzSeed),
    hard: scheduleReview(card, 2, now, params, fuzzSeed),
    good: scheduleReview(card, 3, now, params, fuzzSeed),
    easy: scheduleReview(card, 4, now, params, fuzzSeed),
  };
}

/**
 * Whole days, never zero. These are patterns, not vocabulary: a pattern forgotten
 * five minutes ago is not usefully re-asked in ten, so Again means tomorrow
 * rather than Anki's intra-day relearning steps.
 */
function scheduledInterval(stability: number, rating: FsrsRating, params: FsrsParameters, fuzzSeed: string): number {
  if (rating === 1) return 1;
  const raw = intervalDays(stability, params);
  const fuzzed = raw >= 2.5 ? raw * (1 + fuzzFraction(fuzzSeed)) : raw;
  return Math.min(params.maximumIntervalDays, Math.max(1, Math.round(fuzzed)));
}

/** ±5%, from the seed. FNV-1a, because it only has to be stable, not strong. */
function fuzzFraction(seed: string): number {
  if (!seed) return 0;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ((hash % 1000) / 1000 - 0.5) * 0.1;
}

/**
 * Partial credit for a card that was not itself reviewed.
 *
 * Math Academy calls this fractional implicit repetition: practising a pattern
 * on one problem is also, less strongly, practice of the same pattern filed under
 * another. Here a sibling card sharing the reviewed card's primary concept moves
 * `weight` of the way toward the state a real review with this grade would have
 * produced. Early credit counts for less, because retrievability is still high,
 * which is FSRS's own spacing effect doing the discounting. A failure pulls
 * siblings' due dates forward instead, never pushes them out.
 */
export function implicitCredit(card: MemoryState, rating: FsrsRating, now: Date, weight: number, params: FsrsParameters = DEFAULT_FSRS): MemoryState | null {
  if (card.state === "new" || card.stability <= 0 || !card.lastReviewAt || weight <= 0) return null;
  const share = Math.min(1, weight);
  const elapsedDays = Math.max(0, (now.getTime() - Date.parse(card.lastReviewAt)) / DAY_MS);
  if (elapsedDays < 1) return null;
  const r = retrievability(card.stability, elapsedDays, params);
  if (rating === 1) {
    const reduced = card.stability * (1 - share * 0.5);
    const pulled = Date.parse(card.lastReviewAt) + Math.max(1, Math.round(intervalDays(reduced, params))) * DAY_MS;
    const dueAt = new Date(Math.max(now.getTime() + DAY_MS, Math.min(Date.parse(card.dueAt), pulled))).toISOString();
    return { ...card, stability: reduced, dueAt };
  }
  const full = stabilityAfterRecall(card.difficulty, card.stability, r, rating, params);
  const stability = card.stability + share * (full - card.stability);
  const dueAt = new Date(Math.max(Date.parse(card.dueAt), Date.parse(card.lastReviewAt) + Math.round(intervalDays(stability, params)) * DAY_MS)).toISOString();
  return { ...card, stability, dueAt };
}
