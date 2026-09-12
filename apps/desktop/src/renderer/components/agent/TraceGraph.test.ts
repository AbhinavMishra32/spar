import { describe, expect, it } from "vitest";
import type { Snapshot } from "@spar/visualizer";
import { layoutLinked, linksOf } from "./TraceGraph";

/** A three-level binary tree, shaped the way the Python tracer emits one: each
 *  node a dict, children as refs, absent children as null. */
const node = (id: string, value: string, left: string | null, right: string | null) => ({
  id, type: "dict", kind: "tree" as const,
  entries: [
    ["value", value],
    ["left", left ? { ref: left } : null],
    ["right", right ? { ref: right } : null],
  ] as [unknown, unknown][],
});

const frame = {
  line: 2, event: "call", function: "walk",
  locals: { node: { ref: "n3" } },
  stack: [{ name: "main", line: 9, locals: { tree: { ref: "n1" } } }],
  heap: {
    n1: node("n1", "A", "n2", "n5"),
    n2: node("n2", "B", "n3", "n4"),
    n3: node("n3", "D", null, null),
    n4: node("n4", "E", null, null),
    n5: node("n5", "C", null, null),
  },
  output: "",
} as unknown as Snapshot;

describe("drawing a structure as a structure", () => {
  it("turns references into edges and leaves the payload in the node", () => {
    expect(linksOf("python", frame.heap.n1!)).toEqual([{ label: "left", ref: "n2" }, { label: "right", ref: "n5" }]);
  });

  it("reaches the whole tree from its root", () => {
    const layout = layoutLinked("python", frame, ["n1"]);
    expect(layout?.nodes.map((entry) => entry.label).sort()).toEqual(["A", "B", "C", "D", "E"]);
    expect(layout?.edges).toHaveLength(4);
  });

  it("puts depth on the row and centres a parent over its children", () => {
    const layout = layoutLinked("python", frame, ["n1"]);
    const at = (id: string) => layout?.nodes.find((entry) => entry.id === id);
    expect(at("n1")?.depth).toBe(0);
    expect(at("n3")?.depth).toBe(2);
    expect(at("n2")?.x).toBeGreaterThan(at("n3")!.x);
    expect(at("n2")?.x).toBeLessThan(at("n4")!.x);
  });

  it("draws nothing when nothing points at anything", () => {
    const flat = { ...frame, heap: { n1: { id: "n1", type: "list", kind: "array", items: [1, 2, 3] } } } as unknown as Snapshot;
    expect(layoutLinked("python", flat, ["n1"])).toBeNull();
  });

  /* A cycle is followed once. Drawing it any other way is an infinite loop, and
     a back edge is how a person draws one anyway. */
  it("follows a cycle once and marks the edge that closes it", () => {
    const ring = {
      ...frame,
      heap: {
        a: { id: "a", type: "Node", kind: "linked", fields: { value: 1, next: { ref: "b" } } },
        b: { id: "b", type: "Node", kind: "linked", fields: { value: 2, next: { ref: "a" } } },
      },
    } as unknown as Snapshot;
    const layout = layoutLinked("python", ring, ["a"]);
    expect(layout?.nodes).toHaveLength(2);
    expect(layout?.edges.filter((edge) => edge.back)).toHaveLength(1);
  });
});
