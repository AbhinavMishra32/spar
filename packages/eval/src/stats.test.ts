import { describe, expect, it } from "vitest";
import { flakiness, mcnemar, mean, mulberry32, pairedBootstrap, passAtK, percentile, rate, stdev, wilson } from "./stats.js";

describe("the interval a rate is reported with", () => {
  /* The reason this is Wilson and not the textbook normal interval. A perfect
     score on five runs is encouraging and it is not certainty, and the normal
     interval reports it as certainty — zero width, both bounds at 1.0. */
  it("refuses to claim certainty from five perfect runs", () => {
    const interval = wilson(5, 5);
    expect(interval.high).toBe(1);
    expect(interval.low).toBeGreaterThan(0.5);
    expect(interval.low).toBeLessThan(0.6);
  });

  it("stays inside the unit interval where the normal approximation does not", () => {
    const interval = wilson(0, 4);
    expect(interval.low).toBe(0);
    expect(interval.high).toBeLessThan(0.55);
  });

  it("narrows as the sample grows at the same rate", () => {
    const width = (passes: number, total: number) => { const { low, high } = wilson(passes, total); return high - low; };
    expect(width(70, 100)).toBeLessThan(width(7, 10));
  });

  it("says nothing at all when there is nothing to say", () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it("carries the denominator beside the rate", () => {
    expect(rate([true, true, false])).toMatchObject({ passed: 2, total: 3 });
  });
});

describe("pass@k", () => {
  it("is the observed rate at k = 1", () => {
    expect(passAtK([true, false, false, false, false, false, false, false, false, false], 1)).toBeCloseTo(0.1, 12);
  });

  /* The combinatorial estimator, against the closed form: with one success in
     ten, two draws miss when both come from the nine failures. */
  it("estimates two draws without re-running anything", () => {
    const samples = [true, ...Array<boolean>(9).fill(false)];
    expect(passAtK(samples, 2)).toBeCloseTo(1 - 36 / 45, 12);
  });

  it("is one when there are more successes than the draw can miss", () => {
    expect(passAtK([true, true, false], 2)).toBe(1);
  });

  it("refuses to estimate more draws than it has samples for", () => {
    expect(() => passAtK([true, false], 3)).toThrow(/at least 3/);
  });
});

describe("comparing two arms on the same scenarios", () => {
  /* The whole reason for pairing: five scenarios that the change fixed and none
     it broke is a real signal from five runs. Comparing 0/5 against 5/5 as two
     independent rates would not reach the same confidence. */
  it("reads five clean improvements as unlikely to be chance", () => {
    const pairs = Array.from({ length: 5 }, () => ({ baseline: false, candidate: true }));
    expect(mcnemar(pairs)).toMatchObject({ improved: 5, regressed: 0, unchanged: 0 });
    expect(mcnemar(pairs).pValue).toBeCloseTo(2 / 32, 12);
  });

  it("ignores the runs where both arms agreed", () => {
    const result = mcnemar([
      { baseline: true, candidate: true },
      { baseline: false, candidate: false },
      { baseline: false, candidate: true },
    ]);
    expect(result).toMatchObject({ pairs: 3, unchanged: 2, improved: 1, regressed: 0 });
  });

  it("finds nothing to say when nothing disagreed", () => {
    expect(mcnemar([{ baseline: true, candidate: true }]).pValue).toBe(1);
  });

  it("is symmetric: a regression is as significant as the improvement would have been", () => {
    const improved = mcnemar(Array.from({ length: 6 }, () => ({ baseline: false, candidate: true })));
    const regressed = mcnemar(Array.from({ length: 6 }, () => ({ baseline: true, candidate: false })));
    expect(regressed.pValue).toBeCloseTo(improved.pValue, 12);
    expect(regressed.regressed).toBe(6);
  });
});

describe("intervals on measurements rather than verdicts", () => {
  it("brackets a difference that is there", () => {
    const pairs = Array.from({ length: 20 }, (_, index) => ({ baseline: 100 + index, candidate: 80 + index }));
    const { difference, interval } = pairedBootstrap(pairs, { seed: 7 });
    expect(difference).toBeCloseTo(-20, 9);
    expect(interval.low).toBeLessThanOrEqual(-20);
    expect(interval.high).toBeGreaterThanOrEqual(-20);
  });

  it("brackets zero when the two arms are the same", () => {
    const pairs = [12, 40, 9, 31, 22, 18, 27, 15].map((value) => ({ baseline: value, candidate: value }));
    const { interval } = pairedBootstrap(pairs, { seed: 3 });
    expect(interval.low).toBe(0);
    expect(interval.high).toBe(0);
  });

  /* A report whose confidence interval moves between two readings of the same
     data is not one anybody can cite. */
  it("gives the same interval twice for the same seed", () => {
    const pairs = [3, 9, 4, 11, 6].map((value, index) => ({ baseline: value, candidate: value + index }));
    expect(pairedBootstrap(pairs, { seed: 11 })).toEqual(pairedBootstrap(pairs, { seed: 11 }));
  });
});

describe("how much the number moves on its own", () => {
  /* Same scenario, same seed, same arm, different outcome: the only thing that
     varied was the run, so the check is nondeterministic and cannot gate
     anything at any threshold. */
  it("names a check that disagrees with itself", () => {
    const result = flakiness([
      { key: "window/seed-1", passed: true },
      { key: "window/seed-1", passed: false },
      { key: "window/seed-2", passed: true },
      { key: "window/seed-2", passed: true },
    ]);
    expect(result).toMatchObject({ groups: 2, unstable: 1, rate: 0.5 });
    expect(result.unstableKeys).toEqual(["window/seed-1"]);
  });

  /* A run that happened once is not evidence that it is reproducible, and
     counting it as stable is the usual way this number gets inflated. */
  it("does not count a group of one as stable", () => {
    expect(flakiness([{ key: "only-once", passed: true }])).toMatchObject({ groups: 0, unstable: 0, rate: 0 });
  });
});

describe("the primitives the rest of it rests on", () => {
  it("summarises a sample", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stdev([2, 4, 6])).toBeCloseTo(2, 9);
    expect(stdev([5])).toBe(0);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
  });

  it("draws the same sequence from the same seed and a different one otherwise", () => {
    const take = (seed: number) => { const next = mulberry32(seed); return [next(), next(), next()]; };
    expect(take(42)).toEqual(take(42));
    expect(take(42)).not.toEqual(take(43));
    expect(take(42).every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
