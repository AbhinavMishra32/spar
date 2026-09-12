import { describe, expect, it } from "vitest";
import { digestTrace, findMoments, frameReport, hydrateView, sliceView } from "./explain.js";
import type { Snapshot, Trace } from "./trace.js";

/** A binary search that overshoots: the window closes and the answer is -1. The
 *  point of using a real shape is that the assertions below are the questions a
 *  learner actually asks about it. */
const frame = (line: number, locals: Snapshot["locals"], extra: Partial<Snapshot> = {}): Snapshot => ({
  line, event: "step", function: "search", locals, heap: {}, stack: [], output: "", ...extra,
});

const trace: Trace = {
  frames: [
    frame(1, { lo: 0, hi: 3, target: 9 }, { event: "call" }),
    frame(2, { lo: 0, hi: 3, target: 9 }, { condition: { expression: "lo <= hi", result: true, kind: "while", branch: "Enter loop" } }),
    frame(3, { lo: 0, hi: 3, target: 9, mid: 1 }),
    frame(2, { lo: 2, hi: 3, target: 9, mid: 1 }, { condition: { expression: "lo <= hi", result: true, kind: "while", branch: "Enter loop" } }),
    frame(3, { lo: 2, hi: 3, target: 9, mid: 2 }),
    frame(2, { lo: 3, hi: 2, target: 9, mid: 2 }, { condition: { expression: "lo <= hi", result: false, kind: "while", branch: "Exit loop" } }),
    frame(7, { lo: 3, hi: 2, target: 9, mid: 2 }, { event: "return", result: -1 }),
  ],
  output: "",
  error: null,
  truncated: false,
  notes: {
    "1": { kind: "FunctionDef", text: "def search(values, target):", targets: [] },
    "2": { kind: "While", text: "while lo <= hi:", targets: [] },
    "3": { kind: "Assign", text: "mid = (lo + hi) // 2", targets: ["mid"] },
    "7": { kind: "Return", text: "return -1", targets: [] },
  },
  durationMs: 4,
};

describe("the shape of a run", () => {
  it("counts what each line did rather than listing every step", () => {
    const digest = digestTrace(trace, "python");
    expect(digest.steps).toBe(7);
    expect(digest.lines.find((line) => line.line === 2)).toMatchObject({ visits: 3, kind: "While", source: "while lo <= hi:" });
    expect(digest.returned).toBe("-1");
  });

  /* The one listing a learner cannot reconstruct from the source: which way each
     test actually went, in order. */
  it("keeps every branch decision with the step it was made on", () => {
    expect(digestTrace(trace, "python").decisions).toEqual([
      { step: 1, line: 2, expression: "lo <= hi", result: true, kind: "while", branch: "Enter loop" },
      { step: 3, line: 2, expression: "lo <= hi", result: true, kind: "while", branch: "Enter loop" },
      { step: 5, line: 2, expression: "lo <= hi", result: false, kind: "while", branch: "Exit loop" },
    ]);
  });

  it("ranks variables by how much they moved, not by name", () => {
    const [busiest] = digestTrace(trace, "python").variables;
    expect(busiest?.name).toBe("lo");
    expect(busiest?.first).toBe("0");
    expect(busiest?.last).toBe("3");
  });
});

describe("one instant", () => {
  it("says what the step before it was not", () => {
    const report = frameReport(trace, 3, "python");
    expect(report.line).toBe(2);
    expect(report.source).toBe("while lo <= hi:");
    expect(report.changed).toEqual(["lo: 0 → 2"]);
    expect(report.condition?.result).toBe(true);
  });

  it("reports the first step as changing nothing rather than as changing everything", () => {
    expect(frameReport(trace, 0, "python").changed).toEqual([]);
  });

  it("clamps a step past the end instead of failing the call", () => {
    expect(frameReport(trace, 999, "python").step).toBe(6);
  });
});

describe("finding the moment", () => {
  /* Coming into scope counts as a moment. "where does `lo` get its value" and
     "where does `lo` change" are the same question to whoever is asking it, and
     a search that skipped the assignment would answer the wrong one. */
  it("finds where a variable moved, and says what it moved to", () => {
    const found = findMoments(trace, { variable: "lo" }, "python");
    expect(found.moments.map((moment) => moment.step)).toEqual([0, 3, 5]);
    expect(found.moments[0]?.why).toBe("lo = 0 first appears");
    expect(found.moments[1]?.why).toBe("lo: 0 → 2");
  });

  it("finds the branch that ended the loop", () => {
    const found = findMoments(trace, { branch: false }, "python");
    expect(found.moments).toHaveLength(1);
    expect(found.moments[0]).toMatchObject({ step: 5, why: "lo <= hi was false — Exit loop" });
  });

  /* A filter matching nothing has to come back as a fact, not as an empty list
     the agent can read as "the run never did that" or as "the tool broke". */
  it("says plainly when nothing matches", () => {
    const found = findMoments(trace, { variable: "nope" }, "python");
    expect(found.total).toBe(0);
    expect(found.note).toContain("Nothing in this run matches");
  });

  it("requires every filter to hold at once", () => {
    expect(findMoments(trace, { variable: "lo", line: 3 }, "python").total).toBe(0);
    expect(findMoments(trace, { variable: "lo", line: 2 }, "python").total).toBe(2);
  });
});

describe("the steps an explanation is built from", () => {
  it("pairs each chosen step with the one before it, so the canvas can colour what moved", () => {
    const view = sliceView(trace, "python", "…", "Why it returns -1", [{ step: 5, caption: "The window closed." }]);
    expect(view.steps[0]?.previous?.line).toBe(3);
    expect(view.steps[0]?.source).toBe("while lo <= hi:");
  });

  it("plays the steps in run order however they were named", () => {
    const view = sliceView(trace, "python", "…", "t", [{ step: 5, caption: "b" }, { step: 1, caption: "a" }]);
    expect(view.steps.map((step) => step.caption)).toEqual(["a", "b"]);
  });
});

describe("reading a stored view back", () => {
  const frame = { line: 1, event: "line", function: "f", locals: { lo: 0 }, heap: {}, stack: [], output: "" };

  /* The shape written before steps were directed: no focus, no hold, no autoplay. */
  it("fills in fields a older build never wrote", () => {
    const view = hydrateView({ language: "python", code: "x = 1", title: "Old", steps: [{ step: 0, caption: "start", frame }] });
    expect(view?.steps[0]?.focus).toEqual([]);
    expect(view?.steps[0]?.hold).toBeGreaterThan(0);
    expect(view?.autoplay).toBe(false);
  });

  it("keeps what a current build wrote", () => {
    const view = hydrateView({ language: "python", code: "x = 1", title: "New", autoplay: true,
      steps: [{ step: 0, caption: "a", focus: ["lo"], hold: 2, frame }, { step: 1, caption: "b", focus: [], hold: 2, frame }] });
    expect(view?.steps[0]?.focus).toEqual(["lo"]);
    expect(view?.autoplay).toBe(true);
  });

  it("drops a step whose snapshot is gone rather than the whole view", () => {
    const view = hydrateView({ steps: [{ step: 0, caption: "a", frame }, { step: 1, caption: "b" }] });
    expect(view?.steps).toHaveLength(1);
  });

  it("returns nothing for a row it cannot draw at all", () => {
    expect(hydrateView(null)).toBeNull();
    expect(hydrateView({ steps: [] })).toBeNull();
    expect(hydrateView("{}")).toBeNull();
  });
});
