import { describe, expect, it } from "vitest";
import { workedFor } from "./RunFold";

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
