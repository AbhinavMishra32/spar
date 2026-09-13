import { describe, expect, it } from "vitest";
import { columnsFor, FRONT_MS, phaseFor, pulseFor, revealDelay, SPREAD } from "./CaseDots";

const phases = (count: number) => {
  const phase = phaseFor(count, columnsFor(count));
  return Array.from({ length: count }, (_, index) => phase(index));
};

/**
 * The wave has one job at every suite size: cross the dots that are on screen.
 * Every bug it has had was a normalisation against something other than the grid
 * actually drawn — the nominal column count, a fixed dot count — which is
 * invisible at twenty-five cases and obvious at three.
 */
describe("phaseFor", () => {
  it("spreads a short row across the wave rather than bunching it at the start", () => {
    // Three cases draw one row of three, whose diagonal is two steps long, so
    // the near dot is at the start of the spread and the far one at its end.
    expect(phases(3)).toEqual([0, SPREAD / 2, SPREAD]);
  });

  it("reaches the same far end whatever the count", () => {
    for (const count of [2, 3, 5, 10, 25, 40]) {
      const all = phases(count);
      expect(Math.min(...all)).toBe(0);
      expect(Math.max(...all)).toBeCloseTo(SPREAD, 2);
    }
  });

  it("advances monotonically along the diagonal", () => {
    const phase = phaseFor(25, 5);
    // Down one row and right one column are the same step along the wave.
    expect(phase(5)).toBeCloseTo(phase(1));
    expect(phase(6)).toBeGreaterThan(phase(5));
  });

  it("leaves a lone dot at rest instead of dividing by nothing", () => {
    expect(phases(1)).toEqual([0]);
  });

  it("spans exactly half a cycle, so the band travels one way", () => {
    // A full cycle would put the two ends of the grid in phase and the wave
    // would read as a flicker between its own mirror images.
    expect(SPREAD).toBeLessThanOrEqual(0.5);
    expect(Math.max(...phases(25))).toBeCloseTo(0.5, 2);
  });
});

/**
 * The verdicts arrive as a front crossing the grid, and it has to be the front
 * that was already crossing it. A colour wave running the other way, or at a
 * different speed, is two effects rather than one motion.
 */
describe("revealDelay", () => {
  it("releases the far end of the diagonal first, in step with the dip", () => {
    // A dot is at the bottom of its dip when elapsed/RUN + phase ≡ 0.5, so the
    // larger the phase the sooner the wave reaches it — and the sooner its
    // verdict does.
    expect(revealDelay(SPREAD)).toBe(0);
    expect(revealDelay(0)).toBeGreaterThan(revealDelay(SPREAD / 2));
    expect(revealDelay(SPREAD / 2)).toBeGreaterThan(revealDelay(SPREAD));
  });

  it("crosses the grid in exactly one pass of the wave's front", () => {
    const phase = phaseFor(25, 5);
    const all = Array.from({ length: 25 }, (_, index) => revealDelay(phase(index)));
    expect(Math.min(...all)).toBe(0);
    // The near corner waits one front-crossing, no more: the reveal is the same
    // ripple, not a slower one drawn over it.
    expect(Math.max(...all)).toBeCloseTo(FRONT_MS, 6);
  });
});

describe("the all-passed wave", () => {
  it("starts and ends with every dot at rest, whatever the suite", () => {
    for (const [count, across] of [[3, 5], [39, 7], [212, 15]] as const) {
      const swell = pulseFor(count, across);
      for (let index = 0; index < count; index += 1) {
        expect(swell(index, 0)).toBeCloseTo(0, 6);
        expect(swell(index, 1)).toBeCloseTo(0, 6);
      }
    }
  });

  it("crosses the grid: the near corner crests before the far one", () => {
    const swell = pulseFor(49, 7);
    const middle = 0; // top-left, where the wave starts
    const corner = 48; // bottom-right, the last diagonal it reaches
    const peak = (index: number) => {
      let best = 0;
      let at = 0;
      for (let step = 0; step <= 100; step += 1) {
        const value = swell(index, step / 100);
        if (value > best) { best = value; at = step / 100; }
      }
      return { best, at };
    };
    expect(peak(middle).at).toBeLessThan(peak(corner).at);
    expect(peak(middle).best).toBeGreaterThan(0.2);
    expect(peak(corner).best).toBeGreaterThan(0.2);
  });

  it("keeps the swell subtle — the grid still reads as the same grid", () => {
    const swell = pulseFor(39, 7);
    for (let index = 0; index < 39; index += 1) {
      for (let step = 0; step <= 60; step += 1) {
        expect(swell(index, step / 60)).toBeLessThanOrEqual(0.42);
      }
    }
  });
});
