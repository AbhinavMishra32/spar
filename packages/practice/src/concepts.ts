import { conceptSlug, seededConcept } from "@spar/domain";

/**
 * LeetCode's topic tags, mapped onto Spar's own concept vocabulary.
 *
 * This mapping is the whole reason a LeetCode problem can be part of the same
 * learning record as a generated one. Spar's ledger, its concept sheets, its
 * hover cards and every retrieval the agent does are keyed on Spar concept slugs;
 * a challenge tagged `sliding-window` in LeetCode's words and nothing else would
 * be evidence no future turn could find. So the tags are translated on the way
 * in, and the translation is deliberately conservative in two directions:
 *
 * - **Areas, not findings.** A LeetCode tag names a shelf ("Array", "Dynamic
 *   Programming"), and Spar's taxonomy separates the shelf from the thing
 *   evidence accumulates against ("Defining the state"). So a tag maps to the
 *   area, and the sub-concept is left for the agent to choose from what the
 *   problem actually asks — which it does when it assigns the problem. Inventing
 *   a sub-concept here would put confident-looking evidence under a finding
 *   nobody established.
 *
 * - **Nothing invented.** A tag with no home in the taxonomy is dropped rather
 *   than turned into a new concept. The agent may extend the vocabulary because
 *   it can explain why; a table cannot.
 *
 * The reverse direction matters just as much: `sourceTagsForConcept` is what lets
 * the agent search LeetCode in the vocabulary it thinks in, so a target aimed at
 * `window-invariant-restoration` finds sliding-window problems without the agent
 * having to know LeetCode's tag list.
 */
const TAG_TO_CONCEPT: Record<string, string> = {
  // Sequences and the two techniques LeetCode tags separately from them.
  "array": "arrays",
  "two-pointers": "two-pointers",
  "prefix-sum": "prefix-sums",
  "sliding-window": "sliding-window",
  "sorting": "arrays",
  "counting": "frequency-counting",
  "counting-sort": "arrays",
  "bucket-sort": "arrays",
  "quickselect": "k-selection",
  "merge-sort": "merge-ordered-streams",
  "matrix": "arrays",
  "simulation": "queue-simulation",

  // Lookup structures.
  "hash-table": "hash-maps",
  "hash-function": "key-design",
  "ordered-set": "priority-selection",

  // Text.
  "string": "strings",
  "string-matching": "substring-search",
  "rolling-hash": "substring-search",
  "suffix-array": "substring-search",
  "trie": "strings",

  // Pointer-shaped data.
  "linked-list": "linked-lists",
  "doubly-linked-list": "linked-lists",

  // Order of service.
  "stack": "stacks-queues",
  "monotonic-stack": "monotonic-stack",
  "queue": "stacks-queues",
  "monotonic-queue": "deque-window",
  "heap-priority-queue": "heaps",

  // Hierarchies and graphs.
  "tree": "trees",
  "binary-tree": "trees",
  "binary-search-tree": "bst-invariants",
  "depth-first-search": "depth-first-search",
  "breadth-first-search": "breadth-first-search",
  "graph": "graphs",
  "topological-sort": "topological-order",
  "union-find": "union-find",
  "shortest-path": "graphs",
  "minimum-spanning-tree": "graphs",
  "eulerian-circuit": "graphs",
  "strongly-connected-component": "graphs",
  "biconnected-component": "graphs",
  "segment-tree": "trees",
  "binary-indexed-tree": "prefix-sums",

  // Recursion and the families built on it.
  "recursion": "recursion",
  "backtracking": "backtracking",
  "divide-and-conquer": "recursive-decomposition",
  "memoization": "memoization",
  "dynamic-programming": "dynamic-programming",

  // Search and selection.
  "binary-search": "binary-search",
  "greedy": "greedy",

  // Ranges.
  "line-sweep": "sweep-line",
  "interval": "intervals",

  // Bits and numbers.
  "bit-manipulation": "bit-manipulation",
  "bitmask": "bit-masking",
  "math": "numeric-reasoning",
  "number-theory": "modular-arithmetic",
  "combinatorics": "numeric-reasoning",
  "probability-and-statistics": "numeric-reasoning",
  "geometry": "numeric-reasoning",
  "randomized": "numeric-reasoning",
  "game-theory": "greedy",

  // Engineering-shaped tags. LeetCode files these with the algorithms; Spar does
  // not, and keeping them out of the DSA shelf is what stops "Design" problems
  // from reading as evidence about algorithms.
  "design": "state-management",
  "data-stream": "state-management",
  "iterator": "state-management",
  "concurrency": "race-conditions",
  "database": "state-management",
  "shell": "state-management",
};

/** Every Spar concept a set of LeetCode tags implies, de-duplicated, in tag
 *  order — which is LeetCode's own relevance order, so the first is the closest
 *  thing the source has to a primary concept. */
export function conceptsForSourceTags(tags: Array<string | { slug: string }>): string[] {
  const seen = new Set<string>();
  for (const entry of tags) {
    const raw = typeof entry === "string" ? entry : entry.slug;
    const mapped = TAG_TO_CONCEPT[conceptSlug(raw)];
    if (mapped && !seen.has(mapped)) seen.add(mapped);
  }
  return [...seen];
}

/**
 * Tagged the way `create_question` tags: primary first, the rest supporting.
 *
 * The primary is a *proposal*, and callers are expected to override it — the
 * source's tag order says which topic the problem belongs to, not which gap the
 * agent is aiming at. When the agent names a primary concept, that one wins and
 * the mapped set fills in around it.
 */
export function conceptTagsForProblem(tags: Array<string | { slug: string }>, primary?: string): Array<{ slug: string; role: "primary" | "supporting" }> {
  const mapped = conceptsForSourceTags(tags);
  const aim = primary ? conceptSlug(primary) : mapped[0];
  if (!aim) return [];
  return [
    { slug: aim, role: "primary" as const },
    ...mapped.filter((slug) => slug !== aim).slice(0, 4).map((slug) => ({ slug, role: "supporting" as const })),
  ];
}

/**
 * The LeetCode tags to search when the agent is aiming at a Spar concept.
 *
 * Walks up one level before giving up: a target on `window-invariant-restoration`
 * has no tag of its own, and the useful answer is sliding-window's rather than
 * nothing. Returns an empty list for a concept LeetCode has no vocabulary for at
 * all — which the caller must read as "search by keyword instead", never as "no
 * problems exist".
 */
export function sourceTagsForConcept(concept: string): string[] {
  const slug = conceptSlug(concept);
  const direct = REVERSE.get(slug);
  if (direct?.length) return direct;
  const parent = seededConcept(slug)?.parentSlug;
  return (parent ? REVERSE.get(parent) : undefined) ?? [];
}

const REVERSE = (() => {
  const index = new Map<string, string[]>();
  for (const [tag, concept] of Object.entries(TAG_TO_CONCEPT)) {
    index.set(concept, [...(index.get(concept) ?? []), tag]);
  }
  return index;
})();

/** Whether Spar has a concept for this source tag at all, for a caller that
 *  wants to report coverage rather than silently drop what it cannot map. */
export function isMappedSourceTag(tag: string): boolean {
  return Boolean(TAG_TO_CONCEPT[conceptSlug(tag)]);
}
