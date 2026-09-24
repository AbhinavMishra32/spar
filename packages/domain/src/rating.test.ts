import { describe, expect, it } from "vitest";
import { challengeItemRating, decay, ESTABLISHED_DEVIATION, generatedItemRating, INITIAL_DEVIATION, ITEM_DEVIATION, itemDeviation, itemRating, itemRatingFor, outcomeScore, RATING_FLOOR, solveProbability, UNRATED, updateRating } from "./rating.js";

/**
 * The first test is the only one that can tell you the implementation is right:
 * it is the worked example from Glickman's own paper, numbers and all. Everything
 * below it tests Spar's decisions about how to use the system; this tests that
 * the system is the system.
 */
describe("Glicko-2, against the paper's worked example", () => {
  it("reproduces Glickman's published result to his own precision", () => {
    const result = updateRating(
      { rating: 1500, deviation: 200, volatility: 0.06 },
      [
        { rating: 1400, deviation: 30, score: 1 },
        { rating: 1550, deviation: 100, score: 0 },
        { rating: 1700, deviation: 300, score: 0 },
      ],
    );
    /* The paper prints 1464.06. It rounds every intermediate value to four
       decimals as it goes; carrying full precision through the same steps lands
       on 1464.0507. One decimal is the precision Glickman's own worked example
       actually supports, and the difference is his rounding rather than ours. */
    expect(result.rating).toBeCloseTo(1464.06, 1);
    expect(result.deviation).toBeCloseTo(151.52, 1);
    expect(result.volatility).toBeCloseTo(0.05999, 4);
  });

  it("widens the deviation and moves nothing else across an empty rating period", () => {
    const idle = updateRating({ rating: 1500, deviation: 200, volatility: 0.06 }, []);
    expect(idle.rating).toBe(1500);
    expect(idle.deviation).toBeGreaterThan(200);
    expect(idle.volatility).toBe(0.06);
  });
});

describe("what one result is worth", () => {
  it("moves a new learner far and an established one barely, from the deviation alone", () => {
    const newcomer = updateRating(UNRATED, [{ rating: 1500, deviation: 50, score: 1 }]);
    const established = updateRating({ rating: 1500, deviation: 60, volatility: 0.06 }, [{ rating: 1500, deviation: 50, score: 1 }]);
    expect(newcomer.rating - 1500).toBeGreaterThan(4 * (established.rating - 1500));
  });

  it("pays more for beating a harder problem than an easier one", () => {
    const hard = updateRating(UNRATED, [{ rating: 1900, deviation: 50, score: 1 }]);
    const easy = updateRating(UNRATED, [{ rating: 1100, deviation: 50, score: 1 }]);
    expect(hard.rating).toBeGreaterThan(easy.rating);
  });

  /* The failure this replaces could not do: the old rating was a mean of ability
     proficiencies, and no single attempt could lower it. */
  it("falls on a failure, and falls hardest on an easy one", () => {
    const easy = updateRating(UNRATED, [{ rating: 1100, deviation: 50, score: 0 }]);
    const hard = updateRating(UNRATED, [{ rating: 2100, deviation: 50, score: 0 }]);
    expect(easy.rating).toBeLessThan(1500);
    expect(easy.rating).toBeLessThan(hard.rating);
  });

  it("discounts a result against an item whose own rating is a guess", () => {
    const firm = updateRating(UNRATED, [{ rating: 1800, deviation: 50, score: 1 }]);
    const vague = updateRating(UNRATED, [{ rating: 1800, deviation: 250, score: 1 }]);
    expect(firm.rating).toBeGreaterThan(vague.rating);
  });

  it("never issues a rating below the floor, however the run of results goes", () => {
    let rating = UNRATED;
    for (let attempt = 0; attempt < 60; attempt += 1) rating = updateRating(rating, [{ rating: 800, deviation: 50, score: 0 }]);
    expect(rating.rating).toBe(RATING_FLOOR);
  });

  it("never claims more precision than a fresh rating has", () => {
    let rating = UNRATED;
    for (let attempt = 0; attempt < 40; attempt += 1) rating = updateRating(rating, []);
    expect(rating.deviation).toBe(INITIAL_DEVIATION);
  });
});

describe("the scale's one falsifiable claim", () => {
  /* This is why the rating is on the Codeforces scale rather than a span of
     Spar's own choosing: a Codeforces problem rating is *defined* as the rating
     at which a solver is even money, so the number means something checkable. */
  it("puts a learner at even money against a problem of their own rating", () => {
    expect(solveProbability({ rating: 1600, deviation: 60, volatility: 0.06 }, 1600)).toBeCloseTo(0.5, 6);
  });

  it("follows the logistic curve a 400-point gap implies", () => {
    const certain = { rating: 1600, deviation: 0, volatility: 0.06 };
    expect(solveProbability(certain, 1200)).toBeCloseTo(10 / 11, 2);
    expect(solveProbability(certain, 2000)).toBeCloseTo(1 / 11, 2);
  });

  it("pulls the estimate toward even money while the rating is still uncertain", () => {
    const unsure = solveProbability({ rating: 1600, deviation: 350, volatility: 0.06 }, 1200);
    const sure = solveProbability({ rating: 1600, deviation: 30, volatility: 0.06 }, 1200);
    expect(unsure).toBeLessThan(sure);
    expect(unsure).toBeGreaterThan(0.5);
  });

  it("inverts exactly, so choosing a problem and scoring it cannot disagree", () => {
    const learner = { rating: 1480, deviation: 90, volatility: 0.06 };
    for (const probability of [0.2, 0.35, 0.5, 0.7, 0.9]) {
      expect(solveProbability(learner, itemRatingFor(learner, probability))).toBeCloseTo(probability, 6);
    }
  });

  it("asks for an easier problem for a lower learner, at the same target", () => {
    const target = 0.6;
    expect(itemRatingFor({ rating: 1200, deviation: 90, volatility: 0.06 }, target))
      .toBeLessThan(itemRatingFor({ rating: 1900, deviation: 90, volatility: 0.06 }, target));
  });

  /* The property problem selection leans on: when Spar does not know where
     somebody is, the band of problems worth setting is wider, because more of
     them are plausibly the right one. */
  it("spans a wider band of problems while the rating is still uncertain", () => {
    const span = (deviation: number) => {
      const learner = { rating: 1500, deviation, volatility: 0.06 };
      return itemRatingFor(learner, 0.35) - itemRatingFor(learner, 0.75);
    };
    expect(span(350)).toBeGreaterThan(span(80));
  });
});

describe("inactivity", () => {
  it("widens the deviation over elapsed time rather than at a rating period boundary", () => {
    const rating = { rating: 1700, deviation: 60, volatility: 0.06 };
    expect(decay(rating, 0).deviation).toBe(60);
    expect(decay(rating, 180).deviation).toBeGreaterThan(60);
    expect(decay(rating, 180).rating).toBe(1700);
  });

  it("stops widening at the deviation of a learner nobody has ever rated", () => {
    expect(decay({ rating: 1700, deviation: 300, volatility: 0.4 }, 5000).deviation).toBe(INITIAL_DEVIATION);
  });

  it("leaves a rating provisional until the deviation says otherwise", () => {
    expect(UNRATED.deviation).toBeGreaterThan(ESTABLISHED_DEVIATION);
    let rating = UNRATED;
    for (let attempt = 0; attempt < 20; attempt += 1) rating = updateRating(rating, [{ rating: 1500, deviation: 50, score: attempt % 2 }]);
    expect(rating.deviation).toBeLessThan(ESTABLISHED_DEVIATION);
  });
});

describe("what a challenge is worth as an opponent", () => {
  it("uses the number Codeforces published, because it is already this scale", () => {
    expect(itemRating({ source: "codeforces", difficulty: "medium", sourceRating: 1737 })).toBe(1737);
    expect(itemDeviation({ source: "codeforces", sourceRating: 1737 })).toBe(50);
  });

  it("falls back to the band, and says so by widening the item's deviation", () => {
    expect(itemRating({ source: "codeforces", difficulty: "hard", sourceRating: null })).toBe(2200);
    expect(itemDeviation({ source: "codeforces", sourceRating: null })).toBeGreaterThan(itemDeviation({ source: "codeforces", sourceRating: 1737 }));
  });

  it("bands LeetCode, which publishes no per-problem rating", () => {
    expect(itemRating({ source: "leetcode", difficulty: "easy" })).toBeLessThan(itemRating({ source: "leetcode", difficulty: "medium" }));
    expect(itemRating({ source: "leetcode", difficulty: "medium" })).toBeLessThan(itemRating({ source: "leetcode", difficulty: "hard" }));
  });

  it("bands a Spar-authored challenge by its difficulty word, and trusts it least", () => {
    expect(generatedItemRating("foundation")).toBeLessThan(generatedItemRating("developing"));
    expect(generatedItemRating("developing")).toBeLessThan(generatedItemRating("proficient"));
    expect(generatedItemRating("proficient")).toBeLessThan(generatedItemRating("advanced"));
    expect(itemDeviation({ source: null })).toBeGreaterThan(itemDeviation({ source: "leetcode" }));
  });

  /* The regression that produced a 2044 out of fourteen solves, and the reason
     an item's difficulty may never be a function of the learner's rating. The
     first cut priced a generated challenge at `learnerRating + offset`, so each
     solve raised the rating, which raised the price of the next challenge, which
     raised the rating again — fourteen solves of one warm-up reached 2700. With
     an absolute band the same run converges instead of climbing. */
  it("converges rather than ratcheting when the same challenge is solved over and over", () => {
    let rating = UNRATED;
    for (let solve = 0; solve < 40; solve += 1) {
      rating = updateRating(rating, [{ rating: generatedItemRating("developing"), deviation: ITEM_DEVIATION.generated, score: 1 }]);
    }
    /* It settles somewhere above the band it keeps beating — which is what a
       long unbeaten run against 1200-rated work means — and nowhere near the
       2700 the relative pricing reached on fourteen. */
    expect(rating.rating).toBeGreaterThan(generatedItemRating("developing"));
    expect(rating.rating).toBeLessThan(2100);
    const further = updateRating(rating, [{ rating: generatedItemRating("developing"), deviation: ITEM_DEVIATION.generated, score: 1 }]);
    expect(further.rating - rating.rating).toBeLessThan(12);
  });
});

/**
 * The number on the problem and the number it is scored against are one number.
 * These are the tests that keep it that way: each case pins what
 * `challengeItemRating` returns to the pricing rule it is standing in for, so a
 * change to either half fails here rather than quietly showing the learner one
 * figure and rating them against another.
 */
describe("what a challenge is worth, once", () => {
  const sourced = { source: "codeforces", difficulty: "medium", sourceRating: 1737 } as const;

  it("takes a published Codeforces rating as the rating, at the tightest deviation", () => {
    expect(challengeItemRating({ difficulty: "proficient", source: sourced })).toEqual({
      rating: 1737,
      deviation: ITEM_DEVIATION.rated,
      basis: "published",
    });
  });

  it("bands a sourced problem that published no rating of its own", () => {
    const leetcode = { source: "leetcode", difficulty: "hard" } as const;
    expect(challengeItemRating({ difficulty: "advanced", source: leetcode })).toEqual({
      rating: itemRating(leetcode),
      deviation: itemDeviation(leetcode),
      basis: "band",
    });
  });

  it("prices a challenge Spar wrote by its difficulty word, at the widest deviation", () => {
    expect(challengeItemRating({ difficulty: "developing", source: null })).toEqual({
      rating: generatedItemRating("developing"),
      deviation: ITEM_DEVIATION.generated,
      basis: "generated",
    });
  });

  it("ignores the Spar difficulty word once the problem carries a source", () => {
    /* A sourced problem's own difficulty is the source's, so the word Spar filed
       it under must not move what it is worth — otherwise the same Codeforces
       problem is two different opponents depending on who it was set for. */
    const foundation = challengeItemRating({ difficulty: "foundation", source: sourced });
    const advanced = challengeItemRating({ difficulty: "advanced", source: sourced });
    expect(foundation).toEqual(advanced);
  });
});

describe("an attempt as a score", () => {
  it("scores a clean solve as a win and a failure as a loss", () => {
    expect(outcomeScore("passed")).toBe(1);
    expect(outcomeScore("failed")).toBe(0);
  });

  it("scores a hinted solve as a draw, between giving up and clearing it unaided", () => {
    expect(outcomeScore("passed", { assisted: true })).toBe(0.5);
  });

  it("scores conceding as a loss, because the attempt only ends two ways", () => {
    expect(outcomeScore("abandoned")).toBe(0);
  });

  it("does not rate the agent's own replacement of a challenge as a result", () => {
    expect(outcomeScore("replaced")).toBeNull();
    expect(outcomeScore("open")).toBeNull();
    expect(outcomeScore(null)).toBeNull();
  });
});
