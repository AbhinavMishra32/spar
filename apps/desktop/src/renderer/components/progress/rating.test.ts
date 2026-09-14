import { describe, expect, it } from "vitest";
import { INITIAL_RATING, RATING_FLOOR } from "@spar/domain";
import { approximateRating, sparRating, SPAR_INITIAL_RATING } from "./ratingScale";

describe("the Spar Rating as a presentation of the underlying one", () => {
  it("keeps the order and the sign of every change, because it is affine", () => {
    expect(sparRating(1400)).toBeLessThan(sparRating(1500));
    expect(sparRating(1500)).toBeLessThan(sparRating(1900));
    expect(sparRating(1600) - sparRating(1500)).toBe(sparRating(2000) - sparRating(1900));
  });

  it("puts a learner Spar has never rated near the middle of its own band", () => {
    expect(SPAR_INITIAL_RATING).toBe(sparRating(INITIAL_RATING));
    expect(SPAR_INITIAL_RATING).toBeGreaterThan(1000);
    expect(SPAR_INITIAL_RATING).toBeLessThan(1300);
  });

  it("stays inside its band at both ends", () => {
    expect(sparRating(RATING_FLOOR)).toBe(700);
    expect(sparRating(0)).toBe(700);
    expect(sparRating(3500)).toBe(1800);
  });

  /* It compresses 1600 underlying points into 1100, so it has to be reported to
     the point. Rounding it coarsely would leave the headline figure sitting on
     the same digits through moves the learner really made. */
  it("moves when the smallest recorded underlying move moves", () => {
    expect(sparRating(1510)).not.toBe(sparRating(1500));
  });
});

describe("the two contest scales", () => {
  /* The reason the estimate is run on the Codeforces scale in the first place:
     there is nothing to convert, so there is nothing to get wrong. */
  it("reports Codeforces as the underlying rating itself", () => {
    expect(approximateRating(1500, "codeforces")).toBe(1500);
    expect(approximateRating(1737, "codeforces")).toBe(1740);
  });

  it("translates LeetCode through its anchors, monotonically", () => {
    expect(approximateRating(1100, "leetcode")).toBe(1400);
    expect(approximateRating(1600, "leetcode")).toBe(1750);
    expect(approximateRating(2200, "leetcode")).toBe(2150);
    expect(approximateRating(1300, "leetcode")).toBeGreaterThan(approximateRating(1100, "leetcode"));
    expect(approximateRating(1300, "leetcode")).toBeLessThan(approximateRating(1600, "leetcode"));
  });

  /* Past the end anchors it holds the end slope rather than flattening: a learner
     above the top anchor is still above it, and a scale that stops moving reads
     as a broken number rather than a coarse one. */
  it("keeps moving beyond the outermost anchors", () => {
    expect(approximateRating(2600, "leetcode")).toBeGreaterThan(approximateRating(2400, "leetcode"));
    expect(approximateRating(700, "leetcode")).toBeLessThan(approximateRating(800, "leetcode"));
  });

  it("rounds, so neither number can be read as a measurement", () => {
    expect(approximateRating(1447, "leetcode") % 10).toBe(0);
    expect(approximateRating(1447, "codeforces") % 10).toBe(0);
  });
});
