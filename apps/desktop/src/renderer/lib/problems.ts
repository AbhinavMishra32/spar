import { generatedItemRating, itemRating, solveProbability, type ChallengeHistorySummary, type Rating } from "@spar/domain";
import type { PracticeSearchHit } from "../../shared/api";
import { matchRank } from "./search";

/**
 * One library, two populations.
 *
 * The home page shows problems from the learner's own history beside problems
 * their sources have never handed them, and the whole point is that those read as
 * one list rather than as two tabs pretending to be one. That only works if the
 * merge happens *here*, as a pure function over both shapes, rather than inside a
 * component that would end up with a filter for each population and no honest
 * answer to "how many problems are there".
 *
 * Two things are worth stating plainly because getting either wrong would be a
 * lie rather than a bug.
 *
 * **A challenge outranks a hit.** When a source problem is already in the
 * learner's history, the local row wins and the remote one is dropped — the local
 * one carries their own attempts and their own code, and showing both would offer
 * the same problem twice with two different stories about how it went.
 *
 * **Bands are collapsed, never invented.** Spar grades its own challenges on four
 * bands and both sources use three, so the four fold into the three for the sake
 * of one filter. The fold is stated here once; nothing downstream re-derives it.
 */

export type ProblemOrigin = "spar" | "leetcode" | "codeforces";
export type ProblemBand = "easy" | "medium" | "hard";
/** Where the learner stands, in the only three states a mixed list can honestly
 *  report. A source that does not know (nobody is signed in) reads as `todo`:
 *  "not done yet" is the safe claim, and the source badge already says the
 *  account is not connected. */
export type ProblemStanding = "solved" | "attempted" | "todo";
export type ProblemSort = "suggested" | "easiest" | "hardest" | "recent";

export type ProblemFacets = {
  key: string;
  title: string;
  origin: ProblemOrigin;
  band: ProblemBand;
  standing: ProblemStanding;
  /** Concept titles or source tags, in display order. */
  tags: string[];
  /** What the source calls it on its own site — "4/A", "1" — or null for a
   *  challenge Spar wrote, which has no public number. */
  displayId: string | null;
  /** When the learner last touched it, in ms. Zero for a problem they never
   *  have, which is every remote hit. */
  touchedAt: number;
  /** What it costs, in rating points, on the one scale everything here is priced
   *  on. A published Codeforces rating where there is one, a band anchor where
   *  there is not, and Spar's own difficulty anchor for a challenge it wrote —
   *  all of it from `itemRating`, so the list ranks problems the same way the
   *  rating scores them. */
  price: number;
  /** Everything beyond the title that a query may match. */
  meta: string;
};

export type ProblemItem = ProblemFacets &
  ({ kind: "challenge"; challenge: ChallengeHistorySummary } | { kind: "source"; hit: PracticeSearchHit });

/** Spar's four bands onto the three every source uses. `developing` and
 *  `proficient` both land on medium: they are the two middle bands, and the
 *  alternative — promoting `proficient` to hard — would rank Spar's own
 *  intermediate work above a genuinely hard Codeforces problem. */
const SPAR_BAND: Record<ChallengeHistorySummary["difficulty"], ProblemBand> = {
  foundation: "easy",
  developing: "medium",
  proficient: "medium",
  advanced: "hard",
};

const BAND_ORDER: Record<ProblemBand, number> = { easy: 0, medium: 1, hard: 2 };

/** Unfinished business first, then what has never been started, then what is
 *  already done — the order someone opening the page is looking for. */
const STANDING_ORDER: Record<ProblemStanding, number> = { attempted: 0, todo: 1, solved: 2 };

export const ORIGIN_LABEL: Record<ProblemOrigin, string> = {
  spar: "Spar",
  leetcode: "LeetCode",
  codeforces: "Codeforces",
};

export const BAND_LABEL: Record<ProblemBand, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

/** The identity two populations are deduped on. A sourced challenge and the
 *  source's own hit for the same problem have to collide here or they will both
 *  be shown. */
export function problemKey(item: { origin: ProblemOrigin; slug?: string | null; id?: string }): string {
  return item.origin === "spar" ? `spar:${item.id}` : `${item.origin}:${item.slug}`;
}

/** Where a challenge in history stands. `passed` is the only thing that counts as
 *  solved; a replaced or abandoned one was still attempted, and the attempt is
 *  what the learner will remember. */
function challengeStanding(challenge: ChallengeHistorySummary): ProblemStanding {
  if (challenge.lastOutcome === "passed") return "solved";
  if (challenge.attemptCount > 0 || challenge.testRunCount > 0 || challenge.lastOutcome) return "attempted";
  return "todo";
}

/** What level a challenge is, on the one scale the app grades everything by. A
 *  sourced challenge is banded by the source, which graded it, rather than by the
 *  band Spar assigned when it mounted the problem. */
export function challengeBand(challenge: Pick<ChallengeHistorySummary, "difficulty" | "source">): ProblemBand {
  return challenge.source ? challenge.source.difficulty : SPAR_BAND[challenge.difficulty];
}

export function challengeItem(challenge: ChallengeHistorySummary): ProblemItem {
  const tags = challenge.concepts.map((concept) => concept.title);
  const origin: ProblemOrigin = challenge.source?.source ?? "spar";
  return {
    kind: "challenge",
    challenge,
    key: problemKey({ origin, id: challenge.id, slug: challenge.source?.slug ?? null }),
    title: challenge.title,
    origin,
    band: challengeBand(challenge),
    standing: challengeStanding(challenge),
    tags,
    displayId: challenge.source?.displayId ?? null,
    touchedAt: Date.parse(challenge.updatedAt) || 0,
    price: challenge.source ? itemRating(challenge.source) : generatedItemRating(challenge.difficulty),
    meta: [challenge.sessionTitle, challenge.language, challenge.difficulty, tags.join(" "), challenge.source?.displayId ?? ""].join(" "),
  };
}

export function sourceItem(hit: PracticeSearchHit): ProblemItem {
  return {
    kind: "source",
    hit,
    key: problemKey({ origin: hit.source, slug: hit.slug }),
    title: hit.title,
    origin: hit.source,
    band: hit.difficulty,
    standing: hit.status === "unknown" ? "todo" : hit.status,
    tags: hit.concepts,
    displayId: hit.displayId,
    touchedAt: 0,
    price: itemRating({ source: hit.source, difficulty: hit.difficulty, sourceRating: hit.sourceRating }),
    meta: [hit.sourceName, hit.displayId, hit.slug, hit.concepts.join(" ")].join(" "),
  };
}

/**
 * Both populations as one list, history first.
 *
 * History leads so that the dedupe keeps the row the learner has actually worked
 * in: `mergeProblems` walks challenges before hits, and a hit whose key is
 * already taken is dropped rather than merged. Nothing is folded together —
 * merging a remote "solved" flag into a local row that ended in a failure would
 * produce a card that contradicts itself.
 *
 * History is walked most-recently-touched first for the same reason: practise the
 * same Codeforces problem twice and there are two local rows for one problem, and
 * the one worth keeping is the attempt that reflects where the learner is now.
 */
export function mergeProblems(challenges: ChallengeHistorySummary[], hits: PracticeSearchHit[]): ProblemItem[] {
  const items: ProblemItem[] = [];
  const seen = new Set<string>();
  for (const item of challenges.map(challengeItem).sort((a, b) => b.touchedAt - a.touchedAt)) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    items.push(item);
  }
  for (const hit of hits) {
    const item = sourceItem(hit);
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    items.push(item);
  }
  return items;
}

export type ProblemFilter = {
  query: string;
  origin: ProblemOrigin | "all";
  band: ProblemBand | "all";
  standing: ProblemStanding | "all";
};

/** How many items each origin would leave, ignoring the origin filter itself —
 *  which is what a count beside a filter chip has to mean, or picking one would
 *  change every other number on the row. */
export function originCounts(items: ProblemItem[], filter: ProblemFilter): Record<ProblemOrigin | "all", number> {
  const counts: Record<ProblemOrigin | "all", number> = { all: 0, spar: 0, leetcode: 0, codeforces: 0 };
  for (const item of items) {
    if (!passesExceptOrigin(item, filter)) continue;
    counts.all += 1;
    counts[item.origin] += 1;
  }
  return counts;
}

function passesExceptOrigin(item: ProblemItem, filter: ProblemFilter): boolean {
  if (filter.band !== "all" && item.band !== filter.band) return false;
  if (filter.standing !== "all" && item.standing !== filter.standing) return false;
  return matchRank(filter.query, item.title, item.meta) !== null;
}

export function filterProblems(items: ProblemItem[], filter: ProblemFilter): ProblemItem[] {
  return items.filter((item) => (filter.origin === "all" || item.origin === filter.origin) && passesExceptOrigin(item, filter));
}

/**
 * Where a problem sits against the learner, as a distance from the one they
 * would find worth solving.
 *
 * `LIBRARY_TARGET` is what the page is picking for: something they would get
 * about three times in five. Not even money, because this is the browsing list
 * rather than a diagnostic — somebody opening the library wants the next problem
 * they can finish, and Spar's own assessment of what it still needs to find out
 * is the agent's job on the training path.
 *
 * Distance rather than difficulty, so the scale is symmetric: a problem far too
 * easy is as badly suggested as one far too hard, which a difficulty sort cannot
 * say. It is a probability gap and not a rating gap for the same reason the gate
 * uses one — 300 points above a beginner and 300 points above a specialist are
 * not the same problem.
 */
const LIBRARY_TARGET = 0.6;

function misfit(item: ProblemItem, rating: Rating): number {
  return Math.abs(solveProbability(rating, item.price) - LIBRARY_TARGET);
}

/**
 * The order the list is read in.
 *
 * `suggested` is the only one with an opinion, and while a query is being typed
 * that opinion is how well the query matched — anything else would leave the row
 * someone is spelling out somewhere below the fold. With nothing typed it falls
 * back to what the page is for: pick up what you left unfinished, then what you
 * have not tried, and put what you have already solved last.
 *
 * Inside each of those three groups, the learner's rating orders what is left.
 * The grouping stays on top of it deliberately: a problem they walked away from
 * on Tuesday is the thing they came back for, and no fit score should push it
 * under a stranger. What the rating decides is the question the grouping cannot
 * answer — which of two hundred problems they have never tried to offer first —
 * and until it did, that was "whichever source answered first", drawn as a
 * recommendation.
 *
 * Without a rating it is the old order exactly, which is what the preview
 * harness and any caller that has no learner in hand get.
 *
 * Every comparison ends without a tie-break on purpose. `Array.prototype.sort` is
 * stable, so equal items keep the order `mergeProblems` gave them: history before
 * remote hits, and each source in the order it answered.
 */
export function sortProblems(items: ProblemItem[], sort: ProblemSort, query = "", rating?: Rating | null): ProblemItem[] {
  const rows = [...items];
  if (sort === "easiest") return rows.sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band]);
  if (sort === "hardest") return rows.sort((a, b) => BAND_ORDER[b.band] - BAND_ORDER[a.band]);
  if (sort === "recent") return rows.sort((a, b) => b.touchedAt - a.touchedAt);
  if (query.trim()) {
    return rows.sort((a, b) => (matchRank(query, a.title, a.meta) ?? 9) - (matchRank(query, b.title, b.meta) ?? 9));
  }
  if (!rating) return rows.sort((a, b) => STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing] || b.touchedAt - a.touchedAt);
  return rows.sort((a, b) => STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing] || misfit(a, rating) - misfit(b, rating) || b.touchedAt - a.touchedAt);
}
