import { describe, expect, it } from "vitest";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { checkFigure, figureProblems, graphDot, readGraphvizLayout, renderFigure, type FigureSpec } from "./figure.js";

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

  it("accepts the annotation vocabulary on every structure", () => {
    ok({ type: "tree", values: [5, 4, 8, 11, null, 13, 4], path: [0, 1, 3], mark: [3], labels: { "3": "sum 20" }, edgeTones: { bad: [[0, 2]] }, caption: "The route." });
    ok({ type: "tree", values: [1, 2, 3, 4, 5], path: [3, 1, 4] });
    ok({ type: "list", values: [1, 2, 3, 4], reversed: [0], cut: [1], pointers: { prev: 1, cur: 2 }, links: [[3, 0, "mark"]], removed: [3] });
    ok({ type: "graph", directed: true, layout: "TB", shape: "box", edges: [["a", "b", "x"], ["b", "b", "loop"], ["b", "a"]], names: { a: "fib(2)" }, labels: { b: "d=1" }, edgeTones: { good: [["a", "b"]] }, removed: ["a"] });
    ok({ type: "grid", rows: ["", "a"], cols: ["", "b"], cells: [[0, 0], [0, 1]], arrows: [[[0, 0], [1, 1], "good"]], mark: [[1, 1]], labels: { "1,1": "+1" } });
    ok({ type: "array", values: [3, 1, 2], bars: true, ranges: [{ from: 0, to: 1, label: "sum 4" }], arrows: [[1, 2]], removed: [0], labels: { "2": "max" } });
    ok({ type: "stack", values: [] });
    ok({ type: "stack", values: [1, 2], mark: [1], labels: { "1": "top" } });
    ok({ type: "intervals", items: [[1, 3], [2, 6]], packed: true, markers: { t: 2 }, good: [0] });
    ok({ type: "table", columns: ["i", "sum"], rows: [[0, 1], [1, 3]], good: [1], mark: [[0, 1]] });
    ok({ type: "column", items: [{ type: "stack", values: [1] }, { type: "stack", values: [1, 2] }], captions: ["push 1", "push 2"] });
  });

  it("refuses a highlight that would land on nothing", () => {
    expect(refused({ type: "tree", values: [1, null, 2], good: [1] })).toMatch(/tree.good: index 1 is null/);
    expect(refused({ type: "tree", values: [1, 2, 3], good: [9] })).toMatch(/past the end/);
    expect(refused({ type: "tree", values: [1, 2, 3], path: [1, 2] })).toMatch(/not parent and child/);
    expect(refused({ type: "tree", values: [1, null, 2, null, null, 3] })).toMatch(/no parent to hang from/);
    expect(refused({ type: "tree", values: [1, 2, 3], edgeTones: { good: [[1, 2]] } })).toMatch(/no edge between 1 and 2/);
    expect(refused({ type: "graph", edges: [["A", "B"]], good: ["C"] })).toMatch(/"C" is not a node/);
    expect(refused({ type: "graph", edges: [["A", "B"], ["B", "C"]], edgeTones: { good: [["A", "C"]] } })).toMatch(/no edge between "A" and "C"/);
    expect(refused({ type: "graph", edges: [["A", "B"], ["B", "A"]] })).toMatch(/twice/);
    expect(refused({ type: "array", values: [1, 2], good: [0], bad: [0] })).toMatch(/already in good/);
    expect(refused({ type: "array", values: ["a"], bars: true })).toMatch(/must be a number/);
    expect(refused({ type: "grid", cells: [[1, 2]], mark: [[1, 0]] })).toMatch(/outside a 1×2 grid/);
    expect(refused({ type: "grid", cells: [[1, 2]], cols: ["a"] })).toMatch(/1 headers for 2 columns/);
    expect(refused({ type: "list", values: [1, 2], reversed: [1] })).toMatch(/last node/);
    expect(refused({ type: "intervals", items: [[3, 1]] })).toMatch(/after the end/);
    expect(refused({ type: "table", rows: [[1, 2]], good: [[0, 5]] })).toMatch(/outside a table/);
    expect(refused({ type: "row", items: [{ type: "array", values: [1] }, { type: "array", values: [1], good: [4] }] })).toMatch(/^items.1: array.good/);
  });

  it("walks an undirected path either way along an edge", () => {
    ok({ type: "graph", edges: [["A", "B"]], path: ["B", "A"] });
  });
});

describe("figureProblems", () => {
  it("names each broken fence in a piece of markdown", () => {
    const markdown = "Look:\n\n```figure\n{\"type\":\"array\",\"values\":[1]}\n```\n\nand\n\n```figure\n{\"type\":\"array\",\"values\":[1],\"good\":[3]}\n```\n";
    expect(figureProblems(markdown)).toEqual([expect.stringMatching(/^Figure 2: array.good/)]);
    expect(figureProblems("no figures here")).toEqual([]);
  });
});

describe("renderFigure", () => {
  it("draws a tree route's nodes, not only its edges", () => {
    const svg = renderFigure(ok({ type: "tree", values: [5, 4, 8, 11, null, 13, 4, 7, 2], path: [0, 1, 3, 7] }));
    expect(svg.match(/fill="var\(--fig-good\)"/g)).toHaveLength(4);
    expect(svg.match(/stroke="var\(--fig-good-ink\)" stroke-width="2.6"/g)).toHaveLength(3);
  });

  it("lets an explicit tone win over the route", () => {
    const svg = renderFigure(ok({ type: "tree", values: [1, 2, 3], path: [0, 1], mark: [1] }));
    expect(svg).toContain('fill="var(--fig-mark)"');
    expect(svg.match(/fill="var\(--fig-good\)"/g)).toHaveLength(1);
  });

  it("draws every new structure and its caption", () => {
    for (const spec of [
      { type: "stack", values: [] }, { type: "intervals", items: [[0, 30], [5, 10]], packed: true }, { type: "table", rows: [["a"]] },
      { type: "array", values: [0, 2, 1], bars: true }, { type: "list", values: [1, 2], links: [[1, 0]] },
    ]) expect(renderFigure(ok({ ...spec, caption: "what to see" }))).toContain("what to see");
  });

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

  it("draws Graphviz's routes on the edges they belong to", async () => {
    const graphviz = await Graphviz.load();
    const spec = ok({ type: "graph", directed: true, layout: "TB", edges: [["r", "c", "c"], ["c", "ca", "a"], ["ca", "cat", "t"], ["r", "d", "d"], ["q", "q", "loop"]] }) as Extract<FigureSpec, { type: "graph" }>;
    const layout = readGraphvizLayout(graphviz.layout(graphDot(spec), "json", "dot"));
    expect(Object.keys(layout.edges ?? {}).sort()).toEqual(["c>ca", "ca>cat", "q>q", "r>c", "r>d"]);
    /* The label "d" belongs on r → d: nearer d than c. */
    const at = layout.edges!["r>d"]!.label!, d = layout.nodes.d!, c = layout.nodes.c!;
    expect(Math.hypot(at.x - d.x, at.y - d.y)).toBeLessThan(Math.hypot(at.x - c.x, at.y - c.y));
    expect(renderFigure(spec, () => layout)).toContain("<path");
  });
});
