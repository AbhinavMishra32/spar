import { describe, expect, it } from "vitest";
import { ESTABLISHED_DEVIATION, INITIAL_RATING, RATING_FLOOR } from "@spar/domain";
import { approximateRating, describeChance, leetcodeBand, sparRating, SPAR_INITIAL_RATING } from "./ratingScale";

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

describe("the LeetCode band a rating sits in", () => {
  it("names the band its own translated number falls under", () => {
    /* The word and the figure beside it come from one translation, so a problem
       quoted near LeetCode's easy anchor cannot be labelled anything else. */
    expect(leetcodeBand(800)).toBe("Easy");
    expect(leetcodeBand(1600)).toBe("Medium");
    expect(leetcodeBand(2200)).toBe("Hard");
  });

  it("never goes backwards as the rating climbs", () => {
    const order = { Easy: 0, Medium: 1, Hard: 2 } as const;
    let previous = -1;
    for (let rating = 700; rating <= 2600; rating += 25) {
      const band = order[leetcodeBand(rating)];
      expect(band).toBeGreaterThanOrEqual(previous);
      previous = band;
    }
  });
});

describe("a solve probability, said out loud", () => {
  it("quotes whole tenths, the resolution the estimate actually supports", () => {
    expect(describeChance(0.62, 80)).toBe("about 6 in 10 at your rating");
    expect(describeChance(0.5, 80)).toBe("about 5 in 10 at your rating");
  });

  it("never quotes a certainty it cannot have, at either end", () => {
    expect(describeChance(0.99, 80)).toBe("about 9 in 10 at your rating");
    expect(describeChance(0.01, 80)).toBe("about 1 in 10 at your rating");
  });

  it("declines to quote a figure at all while the rating is provisional", () => {
    /* A number off a deviation this wide is not a hedge away from being right,
       it is a number there is no evidence for. */
    expect(describeChance(0.62, ESTABLISHED_DEVIATION + 1)).not.toMatch(/in 10/);
    expect(describeChance(0.62, ESTABLISHED_DEVIATION)).toMatch(/in 10/);
  });
});
