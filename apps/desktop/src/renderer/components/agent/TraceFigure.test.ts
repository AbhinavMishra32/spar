import { describe, expect, it } from "vitest";
import type { Snapshot } from "@spar/visualizer";
import { subjectsFor } from "./TraceFigure";

/** The frame the bug was found in: two heap objects, four locals, two of which
 *  point at those objects. */
const frame: Snapshot = {
  line: 6,
  event: "return",
  function: "choose_winner",
  locals: { counts: { ref: "n1" }, order: { ref: "n2" }, best: "juice", value: "juice" },
  heap: {
    n1: { id: "n1", type: "dict", kind: "dict", entries: [["tea", 2], ["coffee", 2], ["juice", 3]] },
    n2: { id: "n2", type: "list", kind: "array", items: ["tea", "coffee", "juice"] },
  },
  stack: [],
  output: "",
};

describe("what a figure draws", () => {
  /* The bug this file exists for: the card drew `counts` and `@n1` as two boxes
     of identical contents, then `order` and `@n2` as two more — one object
     reached the figure by two routes and was drawn once per route. */
  it("draws an object once however many ways it was named", () => {
    const subjects = subjectsFor(frame, ["counts", "@n1", "order", "@n2"]);
    expect(subjects.map((subject) => subject.key)).toEqual(["n1", "n2"]);
  });

  it("labels an object with every local pointing at it", () => {
    const aliased: Snapshot = { ...frame, locals: { ...frame.locals, alias: { ref: "n2" } } };
    const [subject] = subjectsFor(aliased, ["order"]);
    expect(subject?.kind === "object" && subject.names).toEqual(["order", "alias"]);
  });

  it("resolves a spotlight by name or by identity", () => {
    expect(subjectsFor(frame, ["@n2"])[0]?.key).toBe("n2");
    expect(subjectsFor(frame, ["order"])[0]?.key).toBe("n2");
  });

  it("keeps scalars, which are usually the point of the step", () => {
    const [subject] = subjectsFor(frame, ["best"]);
    expect(subject).toMatchObject({ kind: "scalar", name: "best", value: "juice" });
  });

  /* A spotlight is the agent narrowing the picture. One that matches nothing
     should leave the picture alone, not delete it. */
  it("falls back to the whole scope rather than drawing nothing", () => {
    expect(subjectsFor(frame, ["nonexistent"]).map((subject) => subject.key)).toEqual(["n1", "n2", "=best", "=value"]);
    expect(subjectsFor(frame, []).length).toBe(4);
  });

  /* A view stored before steps carried `focus` still has to draw: the row is a
     persistence format, and it outlives the build that wrote it. This is the
     crash that took the whole transcript down with it. */
  it("draws the whole frame when a stored step has no spotlight", () => {
    const subjects = subjectsFor(frame, undefined as unknown as string[]);
    expect(subjects.map((subject) => subject.key)).toEqual(["n1", "n2", "=best", "=value"]);
  });

  it("draws the whole frame when the spotlight names nothing in it", () => {
    expect(subjectsFor(frame, ["gone", "   "]).map((subject) => subject.key)).toEqual(["n1", "n2", "=best", "=value"]);
  });
});
