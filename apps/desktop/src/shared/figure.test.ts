import { describe, expect, it } from "vitest";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { checkFigure, graphDot, readGraphvizLayout, renderFigure, type FigureSpec } from "./figure.js";

const ok = (spec: unknown) => {
  const result = checkFigure(JSON.stringify(spec));
  if (!result.ok) throw new Error(result.error);
  return result.spec;
};
const refused = (spec: unknown) => {
  const result = checkFigure(typeof spec === "string" ? spec : JSON.stringify(spec));
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.error;
};

describe("checkFigure", () => {
  it("accepts each figure type", () => {
    ok({ type: "tree", values: [3, 9, 20, null, null, 15, 7] });
    ok({ type: "list", values: [3, 2, 0, -4], cycle: 1, labels: { "0": "head" } });
    ok({ type: "graph", edges: [["A", "B", 4], ["B", "C", 2]], path: ["A", "B", "C"] });
    ok({ type: "grid", cells: [[0, 1], [0, 0]], wall: 1, path: [[0, 0], [1, 0], [1, 1]] });
    ok({ type: "array", values: [1, 2, 3], window: [0, 1], pointers: { l: 0, r: 2 } });
    ok({ type: "row", items: [{ type: "tree", values: [1, 2] }, { type: "tree", values: [1, null, 2] }], captions: ["before", "after"] });
  });

  it("names the field when the shape is wrong", () => {
    expect(refused("{not json")).toMatch(/not valid JSON/);
    expect(refused({ type: "tree", values: [1], colour: "red" })).toMatch(/Unrecognized key/);
    expect(refused({ type: "hexagon" })).toMatch(/type|Invalid/);
  });

  it("refuses figures whose indexes and paths mean nothing", () => {
    expect(refused({ type: "tree", values: [null, 1] })).toMatch(/root cannot be null/);
    expect(refused({ type: "list", values: [1, 2], cycle: 2 })).toMatch(/cycle is 2/);
    expect(refused({ type: "graph", edges: [["A", "B"]], path: ["B", "A"], directed: true })).toMatch(/B → A/);
    expect(refused({ type: "grid", cells: [[0, 0], [0]] })).toMatch(/same length/);
    expect(refused({ type: "grid", cells: [[0, 0], [0, 0]], path: [[0, 0], [1, 1]] })).toMatch(/jumps/);
    expect(refused({ type: "array", values: [1, 2], pointers: { r: 5 } })).toMatch(/past the end/);
  });

  it("walks an undirected path either way along an edge", () => {
    ok({ type: "graph", edges: [["A", "B"]], path: ["B", "A"] });
  });
});

describe("renderFigure", () => {
  it("puts a lone child on its own side", () => {
    const x = (svg: string) => [...svg.matchAll(/<circle cx="([\d.]+)"/g)].map((match) => Number(match[1]));
    const [leftRoot, leftChild] = x(renderFigure(ok({ type: "tree", values: [1, 2] })));
    const [rightRoot, rightChild] = x(renderFigure(ok({ type: "tree", values: [1, null, 2] })));
    expect(leftChild!).toBeLessThan(leftRoot!);
    expect(rightChild!).toBeGreaterThan(rightRoot!);
  });

  it("escapes labels", () => {
    const svg = renderFigure(ok({ type: "array", values: ["<b>", "a&b"] }));
    expect(svg).toContain("&lt;b&gt;");
    expect(svg).toContain("a&amp;b");
    expect(svg).not.toContain("<b>");
  });

  it("lays a graph out with Graphviz and draws every node", async () => {
    const graphviz = await Graphviz.load();
    const spec = ok({ type: "graph", edges: [["A", "B", 4], ["A", "C", 2], ["C", "B", 1]], path: ["A", "C", "B"] }) as Extract<FigureSpec, { type: "graph" }>;
    const svg = renderFigure(spec, (graph) => readGraphvizLayout(graphviz.layout(graphDot(graph), "json", "dot")));
    expect(svg.match(/<circle/g)).toHaveLength(3);
    expect(svg).toContain("var(--fig-good-ink)");
  });
});
