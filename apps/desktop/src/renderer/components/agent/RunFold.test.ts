import { describe, expect, it } from "vitest";
import { aMoment, workedFor } from "./RunFold";

/* The figure exists to answer one question — has this been going four seconds
   or four minutes — and a decimal answers it no better while reading worse. */
describe("how long the turn took", () => {
  it("counts in whole seconds under a minute", () => {
    expect(workedFor(4_280)).toBe("4s");
    expect(workedFor(999)).toBe("0s");
  });

  it("says minutes and seconds, then hours, then days", () => {
    expect(workedFor(80_000)).toBe("1m 20s");
    expect(workedFor(3_725_000)).toBe("1h 2m");
    expect(workedFor(90_000_000)).toBe("1d 1h 0m");
  });

  it("never counts backwards", () => {
    expect(workedFor(-5_000)).toBe("0s");
  });
});

/* The comparison stands in for the number under half a minute, so it has to be
   the same comparison every time that turn is drawn — a transcript whose jokes
   rewrite themselves on scroll is one you cannot trust about anything else. */
describe("what a short turn says instead of a number", () => {
  it("says the same thing for the same turn", () => {
    expect(aMoment(4_280)).toBe(aMoment(4_280));
  });

  it("does not say the same thing for every turn", () => {
    const said = new Set([1_204, 3_881, 7_002, 9_530, 12_117, 14_998].map(aMoment));
    expect(said.size).toBeGreaterThan(1);
  });

  it("stays short enough to sit on the fold's one line", () => {
    for (const ms of [0, 999, 5_000, 29_999, 1_234_567]) {
      expect(aMoment(ms).length).toBeLessThanOrEqual(28);
    }
  });
});
