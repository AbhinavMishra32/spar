/**
 * Practice sources: where real problems come from.
 *
 * The package is split so that the source-agnostic half can be reasoned about
 * without LeetCode in the picture:
 *
 * - `types` is the vocabulary — a problem, a case, a verdict, a source's
 *   capabilities — and nothing in it mentions a particular site.
 * - `sources` is the registry, and the one place that decides what a source is
 *   allowed to claim it can do.
 * - `concepts` translates between the source's tags and Spar's own concept
 *   vocabulary, in both directions, which is what puts a sourced challenge into
 *   the same ledger as a generated one.
 * - `harness` turns a problem into a workspace the local runner can grade, for
 *   when the source cannot grade it itself — and defines the marker contract that
 *   keeps the learner's file submittable.
 * - `leetcode/*` is the one implementation, and it is where every fact about
 *   LeetCode's API lives.
 */
export * from "./types.js";
export * from "./sources.js";
export * from "./concepts.js";
export * from "./harness.js";
export { LeetCodeClient } from "./leetcode/client.js";
export { LEETCODE_ORIGIN, leetCodeHeaders, parseLeetCodeCookie, type LeetCodeSession } from "./leetcode/session.js";
export { casesForProblem, normalizeProblem, normalizeProblemSummary, SOURCE_LANGUAGE_SLUG } from "./leetcode/normalize.js";
export { isJudgePending, normalizeLeetCodeVerdict } from "./leetcode/verdict.js";
export { parseExamples, splitExampleInput, statementToMarkdown } from "./leetcode/statement.js";
