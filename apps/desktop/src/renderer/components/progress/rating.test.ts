import { describe, expect, it } from "vitest";
import { approximateRating } from "./ratingScale";

describe("contest-rating approximations", () => {
  it("puts the starting rating near where a new entrant sits on each site", () => {
    expect(approximateRating(1200, "leetcode")).toBe(1750);
    expect(approximateRating(1200, "codeforces")).toBe(1400);
  });

  it("clamps below the floor rather than reporting a rating no site issues", () => {
    expect(approximateRating(0, "codeforces")).toBe(800);
    expect(approximateRating(0, "leetcode")).toBe(1300);
  });

  it("clamps at the ceiling, because Spar's own scale ends at 1800", () => {
    expect(approximateRating(5000, "codeforces")).toBe(2100);
    expect(approximateRating(5000, "leetcode")).toBe(2300);
  });

  it("rounds coarsely, so the number cannot be read as a measurement", () => {
    expect(approximateRating(1207, "codeforces") % 50).toBe(0);
    expect(approximateRating(1439, "leetcode") % 50).toBe(0);
  });
});
