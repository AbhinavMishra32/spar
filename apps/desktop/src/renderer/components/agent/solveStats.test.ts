import { describe, expect, it } from "vitest";
import { solveStats, spentOn } from "./solveStats";

const stats = {
  events: 90,
  runs: 5,
  submissions: 2,
  saves: 11,
  elapsedMs: 1_440_000,
  casesTracked: 42,
  neverPassed: 4,
  regressions: 1,
  longestGapMs: 60_000,
  outcome: "passed",
  submittedBlind: false,
};

describe("solveStats", () => {
  it("reads the numbers out of a payload that fit", () => {
    expect(solveStats(JSON.stringify({ stats, filters: null, report: "SOLVE REPLAY" }, null, 2))).toMatchObject({
      runs: 5,
      submissions: 2,
      casesTracked: 42,
      neverPassed: 4,
      regressions: 1,
      outcome: "passed",
    });
  });

  /* The report is what overruns the payload cap, and a long attempt's report
     always will — so the numbers have to survive being cut off mid-log. */
  it("carves the numbers out of a payload whose report was truncated", () => {
    const whole = JSON.stringify({ stats, filters: null, report: "x".repeat(400) }, null, 2);
    const cut = `${whole.slice(0, whole.length - 120)}\n… truncated (120 more characters)`;
    expect(() => JSON.parse(cut)).toThrow();
    expect(solveStats(cut)?.casesTracked).toBe(42);
  });

  it("has nothing to say about a replay that recorded nothing", () => {
    expect(solveStats(JSON.stringify({ stats: null, report: "no events" }))).toBeNull();
    expect(solveStats("")).toBeNull();
  });

  it("ignores an outcome it does not recognise", () => {
    expect(solveStats(JSON.stringify({ stats: { ...stats, outcome: "sideways" } }))?.outcome).toBe("");
  });
});

describe("spentOn", () => {
  it("names the span at the resolution it deserves", () => {
    expect(spentOn(24_000)).toBe("24s");
    expect(spentOn(1_440_000)).toBe("24m");
    expect(spentOn(4_320_000)).toBe("1h 12m");
    expect(spentOn(7_200_000)).toBe("2h");
  });
});
