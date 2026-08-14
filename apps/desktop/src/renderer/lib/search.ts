import type { ChallengeHistorySummary, ConceptSummary, SessionSummary } from "@spar/domain";
import type { Page } from "@/components/shell/Sidebar";

/**
 * What ⌘K can find, and how the matches are ordered.
 *
 * Kept out of the palette component because the ranking is the part worth being
 * sure about: it reads four unrelated shapes — sessions, challenges, concepts and
 * the nav itself — and has to put them in one list where the row the learner
 * meant is the row that is already selected when they stop typing. That is a pure
 * function of the query and the bootstrap, so it is tested as one.
 */

/** One thing the palette can offer. The payload travels with the hit so the row
 *  can draw the entity properly rather than from a flattened label. */
export type SearchHit =
  | { kind: "action"; key: string; action: PaletteAction }
  | { kind: "session"; key: string; session: SessionSummary }
  | { kind: "challenge"; key: string; challenge: ChallengeHistorySummary }
  | { kind: "concept"; key: string; concept: ConceptSummary }
  | { kind: "place"; key: string; place: PalettePlace };

export type SearchKind = SearchHit["kind"];

export type SearchGroup = { key: SearchKind; heading: string; hits: SearchHit[] };

export type PaletteAction = { id: "new-session"; label: string; keywords: string };

/** A destination in the nav. The pages that draw their own toolbar are not here:
 *  a workspace and a single challenge are things you open, not places you go. */
export type PalettePlace = { page: Exclude<Page, "workspace" | "challenge" | "baseline">; label: string; keywords: string };

export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: "new-session", label: "Start a session", keywords: "new create begin spar practice goal" },
];

export const PALETTE_PLACES: PalettePlace[] = [
  { page: "today", label: "Today", keywords: "home recommendation next practice" },
  { page: "tracks", label: "Tracks", keywords: "goals training direction" },
  { page: "progress", label: "Progress", keywords: "abilities rating patterns evidence" },
  { page: "history", label: "History", keywords: "attempts challenges completed incomplete" },
  { page: "problems", label: "Problems", keywords: "practice browse library leetcode codeforces solve pick" },
  { page: "sessions", label: "Sessions", keywords: "all list" },
  { page: "ability", label: "Abilities", keywords: "map skills evidence what i can do" },
  { page: "challenges", label: "Challenges", keywords: "history problems attempts tests" },
  { page: "settings", label: "Settings", keywords: "preferences provider model theme account leetcode codeforces sign out" },
];

const HEADING: Record<SearchKind, string> = {
  action: "Actions",
  session: "Sessions",
  challenge: "Challenges",
  concept: "Concepts",
  place: "Go to",
};

/** The order the groups are offered in at rest, and the tie-break between two
 *  groups that matched a query equally well: what you can do, what you were
 *  doing, then where you can go. */
const ORDER: SearchKind[] = ["action", "session", "challenge", "concept", "place"];

/** Rows per group while there is a query. A palette that answers with thirty rows
 *  has handed the learner a page to read instead of a thing to pick — past this
 *  many, typing one more character is faster than scrolling. */
const LIMIT: Record<SearchKind, number> = { action: 2, session: 6, challenge: 6, concept: 5, place: 5 };

/** And with nothing typed, where the list is a starting point rather than an
 *  answer: the sessions and challenges you last touched, and the whole nav.
 *  Concepts sit this one out — there is no recent concept, only a used one, and a
 *  list of five arbitrary ones at rest would push the recents off the panel. */
const RESTING: Record<SearchKind, number> = { action: 1, session: 5, challenge: 3, concept: 0, place: 5 };

/**
 * How well a query met one entry, lowest first, or null if it did not.
 *
 * The bands exist because substring matching alone ranks badly across mixed
 * entities: typing "two" would otherwise let a session whose *goal* mentions two
 * pointers outrank the challenge actually called "Two Sum". So a hit on the title
 * always beats a hit on everything else the entry carries, and a hit at the start
 * of a word beats one buried mid-token.
 */
export function matchRank(query: string, title: string, meta = ""): number | null {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  const name = title.toLowerCase();
  const rest = meta.toLowerCase();
  // Every token has to land somewhere, so a second word narrows the list instead
  // of widening it — "two sum python" is one problem, not three unions.
  if (!tokens.every((token) => name.includes(token) || rest.includes(token))) return null;

  const phrase = tokens.join(" ");
  if (name.startsWith(phrase)) return 0;
  if (wordPrefix(name, phrase)) return 1;
  if (name.includes(phrase)) return 2;
  if (tokens.every((token) => name.includes(token))) return 3;
  return 4;
}

/** Whether `needle` starts a word in `haystack`. Scanned rather than matched with
 *  a built regex: the needle is whatever the learner typed, and `(`, `[` or `+`
 *  are ordinary characters in a challenge title. Both arguments are lowercase. */
function wordPrefix(haystack: string, needle: string): boolean {
  for (let from = 0; from <= haystack.length; ) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    if (at === 0 || !/[a-z0-9]/.test(haystack[at - 1]!)) return true;
    from = at + 1;
  }
  return false;
}

type Candidate = { hit: SearchHit; rank: number; tie: number };

/**
 * Everything the query matches, grouped, capped, and with the group holding the
 * best match first.
 *
 * Two orderings, and both matter. Inside a group, equal matches are settled by how
 * recently the learner touched the thing rather than by the order the bootstrap
 * held it in — two equally good title matches means the one worked on this morning
 * is the one being looked for. Between groups, the best-ranked group leads: typing
 * "two" turns up two sessions that merely mention two pointers in their goal and a
 * challenge actually called Two Sum, and the challenge is what Return should open.
 * Sorting the groups is how that happens, because the selected row is the first
 * one drawn — asking for the highlight directly would be a fight with cmdk, which
 * reclaims it every time the row that had it stops being rendered.
 */
export function searchEverything(
  query: string,
  data: { sessions: SessionSummary[]; challenges: ChallengeHistorySummary[]; concepts: ConceptSummary[] },
): SearchGroup[] {
  const needle = query.trim();
  const resting = needle.length === 0;
  const candidates: Candidate[] = [];

  const add = (hit: SearchHit, title: string, meta: string, tie: number) => {
    const rank = matchRank(needle, title, meta);
    if (rank === null) return;
    candidates.push({ hit, rank, tie });
  };

  PALETTE_ACTIONS.forEach((action, index) =>
    add({ kind: "action", key: `action:${action.id}`, action }, action.label, action.keywords, -index),
  );

  for (const session of data.sessions) {
    /* Its own challenges are part of what a session is findable by. Learners
       remember the problem they were stuck on long after they have forgotten what
       they called the session it was in. */
    const meta = [
      session.originalGoal,
      session.objective,
      session.currentFocus.join(" "),
      session.questionTitles.map((question) => question.title).join(" "),
    ].join(" ");
    add({ kind: "session", key: `session:${session.id}`, session }, session.title, meta, Date.parse(session.updatedAt));
  }

  for (const challenge of data.challenges) {
    const meta = [
      challenge.sessionTitle,
      challenge.language,
      challenge.difficulty,
      challenge.concepts.map((concept) => concept.title).join(" "),
      // A source problem is remembered by its number as often as by its name.
      challenge.source ? `${challenge.source.source} ${challenge.source.displayId} ${challenge.source.difficulty}` : "",
    ].join(" ");
    add({ kind: "challenge", key: `challenge:${challenge.id}`, challenge }, challenge.title, meta, Date.parse(challenge.updatedAt));
  }

  for (const concept of data.concepts) {
    const meta = [concept.parentTitle ?? "", concept.description, concept.kind].join(" ");
    /* Weight by how much history is filed under it rather than by when it was
       last seen: a concept the learner has met twenty times is the one they mean,
       and the one touched most recently is already at the top of Challenges. */
    add({ kind: "concept", key: `concept:${concept.slug}`, concept }, concept.title, meta, concept.challengeCount);
  }

  PALETTE_PLACES.forEach((place, index) =>
    add({ kind: "place", key: `place:${place.page}`, place }, place.label, place.keywords, -index),
  );

  return ORDER.map((kind, index) => {
    const limit = resting ? RESTING[kind] : LIMIT[kind];
    const shown = candidates
      .filter((candidate) => candidate.hit.kind === kind)
      .sort((a, b) => a.rank - b.rank || b.tie - a.tie)
      .slice(0, limit);
    return { kind, index, shown };
  })
    .filter((group) => group.shown.length > 0)
    /* Ranks compare across kinds; the tie-breaks do not — one is a timestamp, one
       is a count — so an honest tie falls back to `ORDER` rather than to comparing
       a date against a number. With nothing typed every rank is 0, which leaves
       the resting panel in exactly `ORDER`. */
    .sort((a, b) => a.shown[0]!.rank - b.shown[0]!.rank || a.index - b.index)
    .map((group) => ({
      key: group.kind,
      heading: HEADING[group.kind],
      hits: group.shown.map((candidate) => candidate.hit),
    }));
}
