import type { Scenario } from "./types.js";

/**
 * The learners Spar is evaluated against.
 *
 * Each one is a person with a specific, stated problem — or specifically without
 * one — and a run of attempts written to be consistent with that. The ground
 * truth is in the fixture rather than in a label somebody applied afterwards,
 * which is what lets these be scored with no judge at all.
 *
 * Three of them, chosen to fail in different directions rather than to cover
 * three topics. A ledger can be wrong by never arriving at the finding, by
 * arriving and then not keeping it, by crediting someone for work they were
 * helped through, or by refusing to credit someone who has plainly earned it.
 * A suite where every scenario fails the same way measures one thing twice.
 */

const SHRINK_ONCE = {
  slug: "window-invariant-restoration",
  statement: "Restores the window invariant with a single shrink and moves on, so cases needing a second shrink fail.",
  markers: ["shrink", "invariant", "again", "second", "repeat", "restore", "once"],
  markersRequired: 3,
  verdictWords: ["weak at", "struggles with", "does not understand", "failed the"],
};

/**
 * The headline. A learner who is not *bad at sliding window* — they build the
 * window correctly and hold state correctly — and who restores the invariant
 * once where it needs restoring repeatedly.
 *
 * The attempt run is inconsistent rather than uniformly failing, which is the
 * hard part and the whole reason this scenario exists. A learner who fails
 * everything is easy to describe and the description is useless. This one solves
 * the third problem, with help, and then fails the fourth — so any reading that
 * amounts to "they can't do windows" is contradicted by their own record, and
 * the only reading that survives the whole run is the narrow one.
 */
const windowInvariant: Scenario = {
  id: "window-invariant-restoration",
  claim: "Spar names the specific invariant failure rather than the topic, keeps it across attempts, and does not read one assisted solve as competence.",
  goal: "Get faster at sliding window problems for interviews",
  profile: { name: "Ari", experience: "working", focus: "interview preparation", weakness: "I lose track of what the window is supposed to guarantee", language: "javascript" },
  ability: { title: "Window invariant restoration", concepts: [{ slug: "window-invariant-restoration", role: "primary" }, { slug: "sliding-window", role: "supporting" }] },
  misconception: SHRINK_ONCE,
  attempts: [
    { outcome: "abandoned", hints: 0, regressed: true, reading: "Shrank once when the sum went over, then advanced the right edge, so every case that needed a second shrink failed." },
    { outcome: "abandoned", hints: 1, regressed: true, reading: "Rewrote the shrink as an if again after the hint, so the invariant was restored once more and the same two cases failed." },
    { outcome: "passed", hints: 2, regressed: false, reading: "Got to a while loop after being shown a failing trace, so the invariant was restored repeatedly — but only once the shape was handed over." },
    { outcome: "abandoned", hints: 0, regressed: true, reading: "Back to a single shrink on a problem that presented the window differently, so the repeated restore did not transfer." },
  ],
  candidates: [
    { source: "codeforces", slug: "1234/A", title: "Well within reach", difficulty: "easy", sourceRating: 800 },
    { source: "codeforces", slug: "1352/C", title: "About right", difficulty: "medium", sourceRating: 1400 },
    { source: "codeforces", slug: "1500/F", title: "Far above them", difficulty: "hard", sourceRating: 2600 },
  ],
  /* Three abandonments and one solve they were talked through cannot add up to
     an ability the learner has, and the one assisted pass must not be allowed to
     carry the reading. */
  expect: { statusNot: ["independent"], proficiencyBelow: 0.5, rating: "down", pattern: true },
};

/**
 * The other direction. Somebody who can genuinely do the thing, unaided, three
 * times running.
 *
 * Here the failure mode under test is a ledger too cautious to ever credit
 * anybody — which is the predictable overcorrection from a ledger that used to
 * credit everybody. If three clean independent solves do not move the belief,
 * the belief is not reading the evidence either.
 */
const hashCounting: Scenario = {
  id: "hash-map-counting",
  claim: "Three clean unaided solves move Spar's belief, and the number beside it goes up rather than counting events.",
  goal: "Practise frequency counting until it is automatic",
  profile: { name: "Ari", experience: "working", focus: "fundamentals", weakness: "", language: "javascript" },
  ability: { title: "Counting with a hash map", concepts: [{ slug: "hash-map-counting", role: "primary" }] },
  misconception: {
    slug: "hash-map-counting",
    statement: "Builds the count in one pass and reads it back correctly, including the empty and single-element cases.",
    markers: ["count", "pass", "map", "key", "empty"],
    markersRequired: 2,
    verdictWords: ["weak at", "struggles with", "does not understand"],
  },
  attempts: [
    { outcome: "passed", hints: 0, regressed: false, reading: "One pass to build the count and one to read it, with the empty input handled before the loop rather than after it." },
    { outcome: "passed", hints: 0, regressed: false, reading: "Same shape on a problem that keyed on pairs rather than on values, so the idea carried rather than the code." },
    { outcome: "passed", hints: 0, regressed: false, reading: "Reached for the map immediately on a problem whose statement did not suggest one." },
  ],
  /* Nothing recurring to find, so there should be no standing pattern — a suite
     that only ever rewards finding something teaches the ledger to invent. */
  expect: { proficiencyAbove: 0.6, rating: "up", pattern: false },
};

/**
 * Improvement, which is the case a snapshot cannot see at all.
 *
 * Two failures then two clean solves. Any reading that looks only at the final
 * state gets this right by accident; the thing worth checking is whether the
 * trajectory is visible — whether Spar's belief moved in the direction the
 * attempts moved, rather than settling on an average of them.
 */
const recursionBaseCase: Scenario = {
  id: "recursion-base-case",
  claim: "Spar's belief moves with the attempts rather than averaging them, so a learner who improved reads as having improved.",
  goal: "Stop getting recursion wrong",
  profile: { name: "Ari", experience: "new", focus: "fundamentals", weakness: "recursion", language: "javascript" },
  ability: { title: "Choosing a recursive base case", concepts: [{ slug: "recursion-base-case", role: "primary" }] },
  misconception: {
    slug: "recursion-base-case",
    statement: "Writes the base case for the empty input but not for the one that stops the recursion early, so deep inputs run past it.",
    markers: ["base", "case", "empty", "stop", "early", "depth"],
    markersRequired: 2,
    verdictWords: ["weak at", "struggles with", "does not understand", "failed the"],
  },
  attempts: [
    { outcome: "abandoned", hints: 0, regressed: true, reading: "Handled the empty input and nothing else, so the recursion ran past the stopping condition on every deep case." },
    { outcome: "abandoned", hints: 1, regressed: false, reading: "Added a depth guard after the hint rather than a base case, which stopped the crash without making the result right." },
    { outcome: "passed", hints: 0, regressed: false, reading: "Named the stopping condition before writing the function and both base cases were there in the first draft." },
    { outcome: "passed", hints: 0, regressed: false, reading: "Same again on a tree rather than a list, unaided, with the base case written first." },
  ],
  /* The direction is the claim. Two failures then two clean solves should read
     as somebody who got there, not as somebody averaging 50%. */
  expect: { trend: "improving", pattern: true },
};

export const SCENARIOS: Scenario[] = [windowInvariant, hashCounting, recursionBaseCase];

export function scenarioById(id: string): Scenario {
  const found = SCENARIOS.find((scenario) => scenario.id === id);
  if (!found) throw new Error(`No scenario named ${id}. Known: ${SCENARIOS.map((scenario) => scenario.id).join(", ")}`);
  return found;
}
