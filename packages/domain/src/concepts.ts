import { z } from "zod";

/**
 * Concepts are what a challenge is *about* — the vocabulary Spar, the learner and
 * the agent all use for the same thing. LeetCode calls these tags; here they are
 * a two-level tree rather than a flat list, because "arrays" is not a finding.
 * "Restoring a window invariant after a shrink" is. The area is the shelf; the
 * sub-concept is the thing evidence actually accumulates against.
 *
 * The taxonomy below is a seed, not a closed set. The agent tags each challenge
 * with slugs and may introduce ones that are not here (see `conceptSlug`), which
 * is what keeps the vocabulary able to follow a learner into whatever they are
 * actually working on.
 */
export const conceptKindSchema = z.enum(["dsa", "engineering", "craft"]);
export type ConceptKind = z.infer<typeof conceptKindSchema>;

/** What each kind covers, in the words the UI and the agent both use. */
export const CONCEPT_KIND_LABEL: Record<ConceptKind, string> = {
  dsa: "Algorithms & data structures",
  engineering: "Building software",
  craft: "How you work",
};

export const conceptRoleSchema = z.enum(["primary", "supporting"]);
export type ConceptRole = z.infer<typeof conceptRoleSchema>;

/** The compact form: what a chip needs, carried inline on a challenge row. */
export const conceptTagSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  kind: conceptKindSchema,
  parentSlug: z.string().nullable(),
  parentTitle: z.string().nullable(),
  role: conceptRoleSchema,
});
export type ConceptTag = z.infer<typeof conceptTagSchema>;

/** Everything the learner's history says about one concept. Counts are over
 *  challenges, not attempts: a challenge is the unit that got tagged. */
export const conceptSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  title: z.string().min(1),
  kind: conceptKindSchema,
  description: z.string(),
  parentSlug: z.string().nullable(),
  parentTitle: z.string().nullable(),
  /** Sub-concept slugs, for drawing the tree without a second query. */
  childSlugs: z.array(z.string()),
  challengeCount: z.number().int().nonnegative(),
  passedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  abandonedCount: z.number().int().nonnegative(),
  openCount: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative(),
  testRunCount: z.number().int().nonnegative(),
  /** How many times the agent had to swap a challenge out under this concept.
   *  A high count next to a low pass rate is the shape of an aim problem. */
  replacedCount: z.number().int().nonnegative(),
  abilityCount: z.number().int().nonnegative(),
  firstSeenAt: z.string().datetime().nullable(),
  lastSeenAt: z.string().datetime().nullable(),
});
export type ConceptSummary = z.infer<typeof conceptSummarySchema>;

/** One graded challenge under a concept, newest first — the hover card's rows
 *  and the sheet's list are the same shape. */
export const conceptEvidenceSchema = z.object({
  challengeId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sessionTitle: z.string(),
  title: z.string(),
  language: z.string(),
  difficulty: z.string(),
  role: conceptRoleSchema,
  outcome: z.enum(["passed", "failed", "abandoned", "replaced", "open"]),
  testRunCount: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
});
export type ConceptEvidence = z.infer<typeof conceptEvidenceSchema>;

export const conceptDetailSchema = z.object({
  concept: conceptSummarySchema,
  /** Present when this concept sits under an area, so the sheet can say so. */
  parent: conceptSummarySchema.nullable(),
  /** Direct sub-concepts that the learner has actually met. This is the "slacking
   *  on arrays, and specifically on the in-place pass" breakdown. */
  children: z.array(conceptSummarySchema),
  challenges: z.array(conceptEvidenceSchema),
  abilities: z.array(z.object({ id: z.string().uuid(), title: z.string(), status: z.string() })),
});
export type ConceptDetail = z.infer<typeof conceptDetailSchema>;

/**
 * Free text to a stable slug. The agent supplies slugs, and providers being what
 * they are, it will sometimes supply "Sliding Window" or "sliding_window" for a
 * concept it already used. Normalising here is what stops one concept becoming
 * three, and it is the same function on both sides so a tag written by the agent
 * and a tag looked up by the UI land on the same row.
 */
export function conceptSlug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Slug back to a readable title, for a concept the agent invented and named
 *  only by its slug. "window-invariant" reads as "Window invariant". */
export function conceptTitleFromSlug(slug: string): string {
  const words = slug.split("-").filter(Boolean);
  if (!words.length) return "Concept";
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}

export type ConceptGrades = { passedCount: number; failedCount: number; abandonedCount: number };

/**
 * A 0–1 reading of how this concept is going, or null when nothing has been
 * graded yet — an untested concept is not a weak one, and a bar at zero would
 * say it was.
 *
 * Laplace-smoothed, so one pass is encouraging rather than conclusive, and
 * deliberately unable to reach 1: the learner's evidence is a sample, and a full
 * bar would claim a certainty no number of passes earns. Walking away counts
 * with the failures — it is still a challenge that produced no working solution,
 * and hiding that would flatter the number.
 */
export function conceptStrength(grades: ConceptGrades): number | null {
  const graded = grades.passedCount + grades.failedCount + grades.abandonedCount;
  if (graded === 0) return null;
  return (grades.passedCount + 0.5) / (graded + 1);
}

export type ConceptStanding = "untested" | "shaky" | "uneven" | "steady" | "strong";

/** The band a strength falls in. One function so the agent's prose, the chip's
 *  tint and the bar's colour can never disagree about where the line is. */
export function conceptStanding(strength: number | null): ConceptStanding {
  if (strength === null) return "untested";
  if (strength < 0.4) return "shaky";
  if (strength < 0.6) return "uneven";
  if (strength < 0.8) return "steady";
  return "strong";
}

export const CONCEPT_STANDING_LABEL: Record<ConceptStanding, string> = {
  untested: "Untested",
  shaky: "Shaky",
  uneven: "Uneven",
  steady: "Steady",
  strong: "Strong",
};

export type ConceptSeed = {
  slug: string;
  title: string;
  kind: ConceptKind;
  parentSlug: string | null;
  description: string;
};

type ChildSeed = [slug: string, title: string, description: string];

function area(kind: ConceptKind, slug: string, title: string, description: string, children: ChildSeed[]): ConceptSeed[] {
  return [
    { slug, title, kind, parentSlug: null, description },
    ...children.map(([childSlug, childTitle, childDescription]) => ({ slug: childSlug, title: childTitle, kind, parentSlug: slug, description: childDescription })),
  ];
}

/**
 * The seeded vocabulary. Areas are shelves; the sub-concepts under them are what
 * a challenge is really testing and what evidence is worth accumulating against.
 * Written fine deliberately — "arrays: 6 passed, 2 failed" tells nobody what to
 * do next, and "in-place mutation: 0 for 3" tells the agent exactly what to aim.
 */
export const CONCEPT_TAXONOMY: ConceptSeed[] = [
  ...area("dsa", "arrays", "Arrays & sequences", "Indexed storage: iteration order, in-place edits, and the invariants a single pass has to hold.", [
    ["two-pointers", "Two pointers", "Two indices moving under a rule, in place of a nested scan."],
    ["prefix-sums", "Prefix sums", "Precomputed running totals so a range query stops being a loop."],
    ["in-place-mutation", "In-place mutation", "Rewriting a sequence while still reading it, without losing what you overwrote."],
    ["sequence-partitioning", "Partitioning", "Rearranging around a predicate and keeping both regions well-defined."],
    ["index-arithmetic", "Index arithmetic", "Off-by-one boundaries, inclusive versus exclusive ends, wraparound."],
  ]),
  ...area("dsa", "sliding-window", "Sliding window", "A contiguous span that grows and shrinks while a property is maintained across every step.", [
    ["fixed-window", "Fixed window", "A span of constant size: one element enters as one leaves."],
    ["variable-window", "Variable window", "A span sized by a condition rather than a constant."],
    ["window-invariant-restoration", "Restoring the invariant", "Shrinking until the property holds again — repeatedly, not once."],
    ["window-shrink-condition", "Shrink conditions", "Deciding when the window has to give ground, and by how much."],
    ["window-state-bookkeeping", "Window bookkeeping", "Keeping counts and sums honest as elements leave the span."],
  ]),
  ...area("dsa", "hash-maps", "Hash maps & sets", "Constant-time lookup, and choosing a key that means what you need it to mean.", [
    ["frequency-counting", "Frequency counting", "Tallying occurrences and reading conclusions off the tally."],
    ["index-mapping", "Index mapping", "Remembering where something was seen, not just that it was."],
    ["key-design", "Key design", "Building a key that makes equal things collide and unequal things not."],
    ["set-membership", "Set membership", "Deduplication and seen-before checks without a second scan."],
  ]),
  ...area("dsa", "strings", "Strings", "Text as a sequence, with encoding and boundary rules that arrays do not have.", [
    ["string-parsing", "Parsing", "Pulling structure out of text without trusting its shape."],
    ["substring-search", "Substring search", "Finding a span inside a span, and what makes the naive way expensive."],
    ["character-classification", "Character classes", "Case, digits, whitespace, and the assumptions each one hides."],
    ["string-building", "Building strings", "Accumulating output without quadratic concatenation."],
  ]),
  ...area("dsa", "linked-lists", "Linked lists", "Nodes reached only through references, where the shape is the pointers.", [
    ["pointer-reassignment", "Pointer reassignment", "Relinking without losing the rest of the list."],
    ["cycle-detection", "Cycle detection", "Telling a loop from a long list with bounded memory."],
    ["sentinel-nodes", "Sentinel nodes", "A dummy head so the first element stops being a special case."],
    ["list-traversal", "Traversal", "Walking to a position and knowing what you are holding when you stop."],
  ]),
  ...area("dsa", "stacks-queues", "Stacks & queues", "Order of service as the whole point: last-in or first-in, and what that buys.", [
    ["monotonic-stack", "Monotonic stack", "A stack kept ordered so the next greater or smaller element falls out."],
    ["bracket-matching", "Matching & nesting", "Pairing openers with closers, and detecting the pair that never came."],
    ["deque-window", "Deque windows", "Both ends open, so a window can keep its own extremes."],
    ["queue-simulation", "Simulation", "Modelling a process by the order things are handled in."],
  ]),
  ...area("dsa", "trees", "Trees", "Hierarchies where every node's subtree is the same problem, smaller.", [
    ["tree-traversal", "Traversal order", "Pre-, in- and post-order, and which one the answer needs."],
    ["depth-vs-breadth", "Depth versus breadth", "Down first or across first, and what each makes cheap."],
    ["bst-invariants", "Search-tree invariants", "The ordering that makes a lookup logarithmic, and how it breaks."],
    ["subtree-aggregation", "Subtree aggregation", "Returning a summary upward instead of carrying state downward."],
  ]),
  ...area("dsa", "graphs", "Graphs", "Arbitrary connections, where the modelling decision usually outweighs the traversal.", [
    ["adjacency-modelling", "Modelling the graph", "Deciding what a node is and what an edge means before traversing."],
    ["breadth-first-search", "Breadth-first search", "Layer by layer, and why that gives shortest paths on unit edges."],
    ["depth-first-search", "Depth-first search", "Following one path to its end, iteratively or recursively."],
    ["visited-bookkeeping", "Visited bookkeeping", "Marking at the right moment so nothing is processed twice or missed."],
    ["topological-order", "Topological order", "Sequencing dependencies, and recognising when you cannot."],
    ["union-find", "Disjoint sets", "Merging groups and asking whether two things are already connected."],
  ]),
  ...area("dsa", "recursion", "Recursion", "A function defined in terms of itself, and the discipline that keeps it finite.", [
    ["base-case-design", "Base cases", "The smallest input, answered without recurring — and answered correctly."],
    ["recursive-decomposition", "Decomposition", "Reducing to a strictly smaller instance of the same problem."],
    ["backtracking", "Backtracking", "Trying, undoing, and leaving no trace of the branch you abandoned."],
    ["call-stack-depth", "Stack depth", "What recursion costs in frames, and when to stop paying it."],
  ]),
  ...area("dsa", "dynamic-programming", "Dynamic programming", "Overlapping subproblems solved once, with the state chosen so they overlap.", [
    ["state-definition", "Defining the state", "Choosing what a cell means; most DP failures are here."],
    ["transition-derivation", "Transitions", "Deriving one state from the states before it, exhaustively."],
    ["memoization", "Memoization", "Caching the recursive answer, keyed on everything it depends on."],
    ["bottom-up-tabulation", "Tabulation", "Iterating states in an order where dependencies are already filled."],
    ["dp-space-reduction", "Rolling state", "Keeping only the rows the transition actually reads."],
  ]),
  ...area("dsa", "binary-search", "Binary search", "Halving a space each step — over an array, or over an answer.", [
    ["predicate-monotonicity", "Monotone predicates", "Finding the property that flips once, which is what makes it searchable."],
    ["search-space-reduction", "Searching the answer", "Binary searching a value rather than an index."],
    ["boundary-conditions", "Boundaries", "Which half keeps the midpoint, and the loop that never terminates."],
  ]),
  ...area("dsa", "heaps", "Heaps & ordering", "Cheap access to the extreme element without sorting everything.", [
    ["priority-selection", "Priority selection", "Always serving the current best, as the set changes underneath."],
    ["k-selection", "Top-k", "Keeping only what could still matter."],
    ["merge-ordered-streams", "Merging ordered input", "Combining sorted sources while keeping the order."],
  ]),
  ...area("dsa", "greedy", "Greedy reasoning", "Committing locally and being able to argue it stays optimal.", [
    ["exchange-argument", "Exchange arguments", "Showing a swap never makes the answer worse."],
    ["local-vs-global", "Local versus global", "Noticing when the locally best choice forecloses the best answer."],
    ["sorting-first", "Sorting first", "Imposing the order the greedy rule needs to be valid."],
  ]),
  ...area("dsa", "intervals", "Intervals", "Ranges that overlap, and the sorting that makes overlap visible.", [
    ["interval-merging", "Merging", "Collapsing overlapping ranges into the fewest that cover the same span."],
    ["sweep-line", "Sweep line", "Processing endpoints in order and tracking what is currently open."],
    ["interval-overlap-tests", "Overlap tests", "The comparison that gets touching-but-not-overlapping right."],
  ]),
  ...area("dsa", "bit-manipulation", "Bit manipulation", "Numbers as bit patterns, where the operation is the representation.", [
    ["bit-masking", "Masking", "Isolating, setting and clearing individual bits deliberately."],
    ["xor-identities", "XOR identities", "Self-cancellation, and the problems it collapses."],
    ["bit-counting", "Bit counting", "Population counts and the loops that avoid scanning every bit."],
  ]),
  ...area("dsa", "numeric-reasoning", "Numeric reasoning", "Arithmetic where the type, not the maths, is what bites.", [
    ["overflow-and-precision", "Overflow & precision", "Integer limits and floating-point error, before they surprise you."],
    ["modular-arithmetic", "Modular arithmetic", "Wrapping deliberately, including for negative values."],
    ["integer-division", "Integer division", "Truncation, rounding direction, and division by zero."],
  ]),

  ...area("engineering", "async", "Asynchronous control flow", "Work that finishes later, and keeping the order and the errors right anyway.", [
    ["promise-composition", "Composing promises", "Chaining and combining without losing a result or a rejection."],
    ["sequential-vs-parallel", "Sequential versus parallel", "Awaiting in a loop when the work was independent, and the reverse."],
    ["async-error-propagation", "Async error propagation", "Rejections that reach a handler instead of vanishing."],
    ["cancellation", "Cancellation", "Stopping work that is no longer wanted, and cleaning up after it."],
    ["race-conditions", "Races", "Two flows touching the same state with no guaranteed order."],
    ["async-resource-cleanup", "Cleanup on every path", "Releasing what you took, including when the path throws."],
  ]),
  ...area("engineering", "references-and-mutation", "References & mutation", "Who else can see the object you just changed.", [
    ["aliasing", "Aliasing", "Two names for one object, and a write through either."],
    ["shallow-vs-deep-copy", "Shallow versus deep copy", "What a spread actually duplicates, and what it shares."],
    ["immutability", "Immutability", "Returning new values instead of editing what you were handed."],
    ["defensive-copying", "Defensive copies", "Not handing a caller a reference to your own internals."],
  ]),
  ...area("engineering", "state-management", "State", "What is remembered between calls, and keeping it consistent.", [
    ["derived-state", "Derived state", "Computing what can be computed rather than storing it twice."],
    ["state-machines", "State machines", "Naming the legal states and refusing the transitions that are not."],
    ["idempotent-updates", "Idempotency", "An update that is safe to apply twice."],
    ["invariant-maintenance", "Maintaining invariants", "The property that has to hold before and after every mutation."],
  ]),
  ...area("engineering", "error-handling", "Errors & failure", "What happens when it does not work, designed rather than discovered.", [
    ["error-contracts", "Error contracts", "Saying how a function fails, as precisely as how it succeeds."],
    ["input-validation", "Input validation", "Rejecting what you cannot handle, at the boundary."],
    ["failure-modes", "Failure modes", "Enumerating the ways it can go wrong before it does."],
    ["retry-and-backoff", "Retry & backoff", "Trying again without amplifying the problem."],
    ["partial-failure", "Partial failure", "Half the work succeeded; deciding what that means."],
  ]),
  ...area("engineering", "api-design", "Interfaces", "The contract other code reads, and what it is allowed to assume.", [
    ["function-contracts", "Function contracts", "Preconditions, postconditions, and what is guaranteed about the return."],
    ["naming-and-intent", "Naming", "A name that says what it does, so the body does not have to be read."],
    ["parameter-design", "Parameter design", "Options that cannot be combined wrongly."],
    ["return-shape", "Return shape", "One shape per outcome, discoverable without documentation."],
    ["backward-compatibility", "Compatibility", "Changing an interface without breaking who is already using it."],
  ]),
  ...area("engineering", "data-modelling", "Data modelling", "Choosing the shape that makes the wrong state unrepresentable.", [
    ["normalization", "Normalisation", "One source of truth for each fact."],
    ["nullability", "Nullability", "Absent versus empty versus unset, and not conflating them."],
    ["schema-evolution", "Evolution", "Reading old data after the shape changed."],
    ["identity-and-equality", "Identity & equality", "When two values count as the same thing."],
  ]),
  ...area("engineering", "types", "Types", "Constraints the compiler checks so you do not have to.", [
    ["narrowing", "Narrowing", "Convincing the checker of what you already know, provably."],
    ["discriminated-unions", "Discriminated unions", "One tagged shape per case, exhaustively handled."],
    ["generics", "Generics", "Writing once over a type you have not seen yet."],
    ["type-boundaries", "Boundaries", "Where unknown input becomes trusted, and the parse that makes it so."],
  ]),
  ...area("engineering", "modules", "Modules & structure", "How code is divided, and which way the dependencies point.", [
    ["dependency-direction", "Dependency direction", "Which layer is allowed to know about which."],
    ["side-effect-isolation", "Isolating effects", "Keeping I/O out of the part you want to test."],
    ["cohesion", "Cohesion", "One reason for a module to change."],
  ]),
  ...area("engineering", "io-and-parsing", "I/O & serialisation", "Data crossing a boundary, where nothing is trustworthy yet.", [
    ["serialization", "Serialisation", "Round-tripping a value without losing part of it."],
    ["streaming-input", "Streaming", "Processing more than fits, in order, without holding it all."],
    ["encoding", "Encoding", "Bytes versus characters, and the assumption in between."],
  ]),
  ...area("engineering", "caching", "Caching", "Trading memory and staleness for speed, on purpose.", [
    ["cache-invalidation", "Invalidation", "Knowing when the cached answer stopped being the answer."],
    ["memoization-lifetime", "Lifetime", "How long a cached value is allowed to live, and what evicts it."],
  ]),
  ...area("engineering", "concurrency", "Concurrency", "More than one thing in flight against shared state.", [
    ["shared-mutable-state", "Shared mutable state", "The write two flows can both reach."],
    ["synchronisation", "Synchronisation", "Ordering access, and the deadlock that follows from ordering it badly."],
    ["atomicity", "Atomicity", "The read-modify-write that has to be one step."],
  ]),
  ...area("engineering", "memory", "Memory & lifetime", "Who owns a value, and when it stops existing.", [
    ["ownership", "Ownership", "Exactly one place responsible for releasing a resource."],
    ["object-lifetime", "Lifetime", "References that outlive what they point at."],
    ["raii", "Scope-bound resources", "Acquisition tied to a scope, so release cannot be forgotten."],
    ["copy-semantics", "Copy semantics", "What happens on assignment, and what it costs."],
  ]),

  ...area("craft", "testing", "Testing", "Deciding what would convince you it works, then writing that down.", [
    ["boundary-cases", "Boundary cases", "Empty, one, full, first, last — where the bugs actually live."],
    ["test-doubles", "Test doubles", "Standing in for a dependency without pretending too much."],
    ["property-based-thinking", "Properties", "Stating what must always hold, rather than a list of examples."],
    ["regression-capture", "Regression capture", "Turning the bug you just found into the test that keeps it gone."],
    ["test-readability", "Readable tests", "A failure message that says what broke without a debugger."],
  ]),
  ...area("craft", "debugging", "Debugging", "Finding the cause rather than a change that makes the symptom stop.", [
    ["hypothesis-testing", "Hypotheses", "One guess at a time, and an observation that would disprove it."],
    ["bisecting", "Bisecting", "Halving the suspect space instead of reading all of it."],
    ["reading-diagnostics", "Reading diagnostics", "Taking the compiler and the stack trace at their word."],
    ["minimal-reproduction", "Minimal reproduction", "Cutting away everything that is not the bug."],
  ]),
  ...area("craft", "complexity", "Complexity", "What it costs as the input grows, argued rather than felt.", [
    ["time-complexity", "Time", "Counting the work, including the work inside the call you made."],
    ["space-complexity", "Space", "Counting what you keep, including the call stack."],
    ["amortized-analysis", "Amortised cost", "Averaging an expensive step over the cheap ones that earned it."],
    ["constant-factors", "Constant factors", "When the same big-O is still the wrong choice."],
  ]),
  ...area("craft", "reading-code", "Reading code", "Working out what code does when you did not write it.", [
    ["tracing-execution", "Tracing execution", "Following state step by step instead of pattern-matching the shape."],
    ["invariant-spotting", "Spotting invariants", "Reading the property a loop is trying to preserve."],
    ["locating-behaviour", "Locating behaviour", "Finding where a thing happens in code you have not read."],
  ]),
  ...area("craft", "problem-decomposition", "Decomposition", "Turning a stated problem into something you can start on.", [
    ["restating-requirements", "Restating the problem", "Saying it back precisely enough to notice what was missing."],
    ["example-driven-design", "Working an example", "Doing it by hand before generalising it."],
    ["edge-case-enumeration", "Enumerating edge cases", "Listing the awkward inputs before the implementation hides them."],
    ["incremental-construction", "Building incrementally", "A working smaller version before the whole one."],
  ]),
  ...area("craft", "refactoring", "Refactoring", "Changing the shape while keeping the behaviour, provably.", [
    ["extracting-abstractions", "Extracting abstractions", "Naming a piece once it has earned a name."],
    ["removing-duplication", "Removing duplication", "Telling real duplication from two things that merely look alike."],
    ["behaviour-preservation", "Preserving behaviour", "Knowing the change was safe, rather than believing it."],
  ]),
];

const BY_SLUG = new Map(CONCEPT_TAXONOMY.map((seed) => [seed.slug, seed]));

/** The seeded concept for a slug, or undefined for one the agent invented. */
export function seededConcept(slug: string): ConceptSeed | undefined {
  return BY_SLUG.get(conceptSlug(slug));
}

/** Areas in taxonomy order, for a UI that groups by shelf. */
export const CONCEPT_AREAS: ConceptSeed[] = CONCEPT_TAXONOMY.filter((seed) => seed.parentSlug === null);
