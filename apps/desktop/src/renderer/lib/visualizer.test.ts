import { describe, expect, it } from "vitest";
import { canvasFrame, dragTo, isDrag, placeNodes } from "./visualizer";

/**
 * The arithmetic behind dragging a node.
 *
 * The wiring is a few pointer handlers and is obvious on inspection; these three
 * are the parts that are silently wrong rather than visibly broken — a drag that
 * tracks the cursor at one pane width and drifts at another, or a canvas that
 * grows to the right but not to the left.
 */
describe("canvasFrame", () => {
  it("keeps a floor so an empty canvas is not a sliver", () => {
    expect(canvasFrame([])).toEqual({ left: 0, top: 0, width: 760, height: 320 });
  });

  it("grows up and left, not only down and right", () => {
    // The bug this is here for: a node dragged above and to the left of the
    // origin is outside a viewBox that starts at 0,0 and simply disappears.
    const frame = canvasFrame([{ x: -240, y: -160 }]);
    expect(frame.left).toBe(-330);
    expect(frame.top).toBe(-250);
    expect(frame.left + frame.width).toBeGreaterThanOrEqual(760);
  });

  it("grows to hold a node dragged past the right edge", () => {
    const frame = canvasFrame([{ x: 1400, y: 900 }]);
    expect(frame.width).toBe(1490);
    expect(frame.height).toBe(1005);
  });
});

describe("placeNodes", () => {
  it("adds an offset to the layout rather than replacing it", () => {
    const placed = placeNodes({ n1: { x: 100, y: 50 }, n2: { x: 200, y: 50 } }, { n1: { x: 30, y: -10 } });
    expect(placed.n1).toEqual({ x: 130, y: 40 });
    // Untouched nodes stay exactly where the layout put them, which is what
    // lets the layout keep changing underneath an arrangement.
    expect(placed.n2).toEqual({ x: 200, y: 50 });
  });

  it("ignores an offset for a node that is no longer on the heap", () => {
    expect(placeNodes({ n1: { x: 10, y: 10 } }, { n9: { x: 500, y: 500 } })).toEqual({ n1: { x: 10, y: 10 } });
  });
});

describe("dragTo", () => {
  it("converts pointer pixels into viewBox units", () => {
    // A canvas declared 1520 wide rendered into 760px: every pixel of pointer
    // travel is two units of canvas. Ignoring this is a drag that lags the
    // cursor by half its distance.
    const moved = dragTo({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 150, y: 80 }, 2);
    expect(moved).toEqual({ x: 100, y: -40 });
  });

  it("continues from where the node already was, so a second drag does not jump", () => {
    expect(dragTo({ x: 40, y: 40 }, { x: 0, y: 0 }, { x: 10, y: 10 }, 1)).toEqual({ x: 50, y: 50 });
  });
});

describe("isDrag", () => {
  it("treats a couple of pixels as a click, not a move", () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true);
  });

  it("measures from where the drag started, so a slow drag still counts", () => {
    // Measured step to step, twenty one-unit moves would each read as a click.
    expect(isDrag({ x: 0, y: 0 }, { x: 20, y: 0 })).toBe(true);
  });
});
