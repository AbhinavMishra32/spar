import { describe, expect, it } from "vitest";
import { markDots, markRadius } from "./Mark";

/**
 * The mark's geometry is copied from the desktop app's icon renderer, and it is
 * copied by hand — there is no shared package between an Electron renderer and
 * this site. So the numbers that make it the same mark are pinned here: get one
 * of them wrong and the logo is subtly not the logo, which is the kind of thing
 * that survives review and then ships.
 */
describe("the mark's grid", () => {
  it("is five by five", () => {
    expect(markDots).toHaveLength(25);
  });

  it("fills its 100-unit box exactly, inset by one radius", () => {
    const first = markDots[0];
    const last = markDots[24];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(first!.cx - markRadius).toBeCloseTo(0, 6);
    expect(last!.cx + markRadius).toBeCloseTo(100, 6);
    // Square: the last dot sits at the same distance down as it does across.
    expect(last!.cy).toBeCloseTo(last!.cx, 6);
  });

  it("keeps the leading diagonal at full size and tapers off it", () => {
    const diagonal = markDots.filter((dot, index) => Math.floor(index / 5) === index % 5);
    expect(diagonal).toHaveLength(5);
    for (const dot of diagonal) expect(dot.rest).toBeCloseTo(1, 6);

    // The two off-corners are the furthest from the diagonal, so they are the
    // smallest and the faintest — 0.55 of taper, from the icon renderer.
    expect(markDots[4]!.rest).toBeCloseTo(0.45, 6);
    expect(markDots[20]!.rest).toBeCloseTo(0.45, 6);
    for (const dot of markDots) expect(dot.tone).toBeCloseTo(0.45 + 0.55 * dot.rest, 6);
  });

  it("runs the delay track from corner to corner", () => {
    expect(markDots[0]!.along).toBe(0);
    expect(markDots[24]!.along).toBe(1);
    // Top-right and bottom-left are the same distance along, which is what makes
    // the band travel as a diagonal front rather than a sweep.
    expect(markDots[4]!.along).toBeCloseTo(markDots[20]!.along, 6);
  });
});
