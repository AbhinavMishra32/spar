import { z } from "zod";

/**
 * Figures: pictures the agent puts in a statement or a reply, as data.
 *
 * The agent never draws. It writes a ```figure fence holding one of the specs
 * below — a tree as its level-order array, a list as its values, a graph as its
 * edges, a DP table as its cells — and this module turns that into an SVG. Two
 * consequences are the point of doing it this way rather than letting a model
 * write SVG or DOT:
 *
 * - The picture and the example cannot disagree. `root = [3,9,20,null,null,15,7]`
 *   in the statement and `"values": [3,9,20,null,null,15,7]` in the figure are
 *   the same serialisation, so a figure is checked by parsing, not by looking.
 * - The agent cannot see what it drew, and here it does not have to: layout is
 *   this module's job, so a figure either validates and looks right or is
 *   refused with a reason the agent can act on.
 *
 * Every structure takes the same annotation vocabulary, so what the agent learns
 * on one carries to the rest: four tones (`mark`, `good`, `bad`, `info`) for the
 * elements themselves, `labels` for a few words beside one, `removed` for what
 * is gone, `edgeTones` where there are edges, and a `caption` under the whole.
 * Every key those fields name is checked against the structure, so a highlight
 * can never silently land on nothing.
 *
 * Colours are CSS variables (`--fig-*`, defined in theme.css) so one SVG follows
 * the app between light and dark. Graph layout is Graphviz's, injected as
 * `layoutGraph` so this file stays free of WASM and runs in either process.
 */

const label = z.union([z.number(), z.string().min(1).max(16)]);
/** A header may be blank, like the corner of a DP table. */
const header = z.union([z.number(), z.string().max(16)]);
const id = z.union([z.number(), z.string().min(1).max(24)]);
const index = z.number().int().min(0);
/** An index, also accepted as its digits so `"3"` and `3` mean the same node. */
const indexKey = z.union([index, z.string().regex(/^\d+$/)]);
const cell = z.tuple([index, index]);
const note = z.string().min(1).max(28);
const caption = z.string().min(1).max(200).optional();
const TONE_NAMES = ["mark", "good", "bad", "info"] as const;
type ToneName = typeof TONE_NAMES[number];
const toneName = z.enum(TONE_NAMES);

/** Tones an element can take. `mark` is "look here", `good` a route or an
 *  answer, `bad` something removed or wrong, `info` a region or pointer. */
function tonesOf<T extends z.ZodTypeAny>(key: T) {
  return { mark: z.array(key).optional(), good: z.array(key).optional(), bad: z.array(key).optional(), info: z.array(key).optional() };
}
/** The same four tones for edges, each a list of `[from, to]` pairs. */
function edgeTonesOf<T extends z.ZodTypeAny>(key: T) {
  return z.object(tonesOf(z.tuple([key, key]))).strict().optional();
}
const indexNotes = z.record(z.string().regex(/^\d+$/, "keys are indexes, like \"0\""), note).optional();

const treeSpec = z.object({
  type: z.literal("tree"),
  /** LeetCode's level-order serialisation, nulls included. */
  values: z.array(label.nullable()).min(1).max(127),
  /** Level-order indexes (into `values`) drawn faded and dashed. */
  removed: z.array(indexKey).optional(),
  /** Level-order indexes in walking order, each the parent or child of the
   *  one before; its nodes and edges are drawn as the route. */
  path: z.array(indexKey).optional(),
  /** A few words under a node, by index: `{"3": "sum 20"}`. */
  labels: indexNotes,
  /** Edges by the two node indexes they join. */
  edgeTones: edgeTonesOf(indexKey),
  ...tonesOf(indexKey),
  caption,
}).strict();

const listSpec = z.object({
  type: z.literal("list"),
  values: z.array(label).min(1).max(16),
  /** Index the tail points back to, LeetCode's `pos`. */
  cycle: index.optional(),
  /** Short names above nodes, by index: `{"0": "head"}`. */
  labels: indexNotes,
  /** Name → index, drawn as arrows pointing down at the node: `slow`, `fast`, `prev`. */
  pointers: z.record(z.string().min(1).max(10), index).optional(),
  /** Indexes whose link to the next node points backward instead, for a list mid-reversal. */
  reversed: z.array(index).optional(),
  /** Indexes whose link to the next node is cut. */
  cut: z.array(index).optional(),
  /** Extra links drawn under the list, `[from, to]` or `[from, to, tone]`: a random pointer, a splice. */
  links: z.array(z.union([z.tuple([index, index]), z.tuple([index, index, toneName])])).max(16).optional(),
  removed: z.array(index).optional(),
  ...tonesOf(indexKey),
  caption,
}).strict();

const graphSpec = z.object({
  type: z.literal("graph"),
  directed: z.boolean().optional(),
  /** Isolated nodes, or to fix the order nodes are declared in. */
  nodes: z.array(id).max(40).optional(),
  /** `[from, to]` or `[from, to, label]` — the label a weight, a character, a condition. */
  edges: z.array(z.union([z.tuple([id, id]), z.tuple([id, id, label.or(z.string().min(1).max(24))])])).min(1).max(80),
  /** A walk through the graph, drawn as a route. Consecutive pairs must be edges. */
  path: z.array(id).optional(),
  /** Text drawn inside a node in place of its id, so two nodes can read the same: `{"n4": "fib(2)"}`. */
  names: z.record(z.string(), z.string().min(1).max(24)).optional(),
  /** A few words above a node: a distance, a colour, a visit order. */
  labels: z.record(z.string(), note).optional(),
  /** Which way the graph grows: left to right, or top to bottom for trees of any arity. */
  layout: z.enum(["LR", "TB"]).optional(),
  /** `box` draws every node as a rounded box, for states or longer names. */
  shape: z.enum(["circle", "box"]).optional(),
  removed: z.array(id).optional(),
  edgeTones: edgeTonesOf(id),
  ...tonesOf(id),
  caption,
}).strict();

const gridSpec = z.object({
  type: z.literal("grid"),
  cells: z.array(z.array(label).min(1).max(20)).min(1).max(20),
  /** The cell value drawn as a solid wall. */
  wall: label.optional(),
  /** Cell value → tone, e.g. `{"1": "info"}` for land. */
  fill: z.record(z.string(), toneName).optional(),
  /** `[row, col]` cells in order, each a neighbour of the one before; drawn green. */
  path: z.array(cell).optional(),
  showValues: z.boolean().optional(),
  /** Headers along the left and the top, for a DP table over two strings, say. */
  rows: z.array(header).optional(),
  cols: z.array(header).optional(),
  /** A few words in a cell's corner, keyed `"row,col"`. */
  labels: z.record(z.string().regex(/^\d+,\d+$/, "keys are \"row,col\""), note).optional(),
  /** Arrows from cell to cell, `[[r,c],[r,c]]` or with a tone third: what a DP cell is built from. */
  arrows: z.array(z.union([z.tuple([cell, cell]), z.tuple([cell, cell, toneName])])).max(40).optional(),
  ...tonesOf(cell),
  caption,
}).strict();

const arraySpec = z.object({
  type: z.literal("array"),
  values: z.array(label).min(1).max(32),
  /** Inclusive `[from, to]` drawn as a shaded window. */
  window: z.tuple([index, index]).optional(),
  /** Name → index, drawn as arrows under the cells. */
  pointers: z.record(z.string().min(1).max(10), index).optional(),
  /** A few words above a cell, by index. */
  labels: indexNotes,
  /** Inclusive spans bracketed under the cells, each with an optional label and tone. */
  ranges: z.array(z.object({ from: index, to: index, label: note.optional(), tone: toneName.optional() }).strict()).max(8).optional(),
  /** Arcs over the cells from one index to another, `[from, to]` or with a tone: a jump, a swap, a next-greater link. */
  arrows: z.array(z.union([z.tuple([index, index]), z.tuple([index, index, toneName])])).max(16).optional(),
  /** Draw the values as bars, for heights and histograms. Every value must be a number. */
  bars: z.boolean().optional(),
  /** Show indexes under the cells. Defaults to true. */
  indexes: z.boolean().optional(),
  removed: z.array(index).optional(),
  ...tonesOf(indexKey),
  caption,
}).strict();

const stackSpec = z.object({
  type: z.literal("stack"),
  /** Bottom first; the last value is the top. Empty is allowed. */
  values: z.array(label).max(16),
  /** A few words beside an entry, by index from the bottom. */
  labels: indexNotes,
  removed: z.array(index).optional(),
  ...tonesOf(indexKey),
  caption,
}).strict();

const intervalsSpec = z.object({
  type: z.literal("intervals"),
  /** `[start, end]` pairs, drawn on a shared number line. */
  items: z.array(z.tuple([z.number(), z.number()])).min(1).max(20),
  /** Text on an interval in place of `[start,end]`, by index. */
  labels: indexNotes,
  /** Name → position, drawn as a dashed line across every interval: a sweep line, a query point. */
  markers: z.record(z.string().min(1).max(12), z.number()).optional(),
  /** Share lanes between intervals that do not overlap, instead of one lane each. */
  packed: z.boolean().optional(),
  removed: z.array(index).optional(),
  ...tonesOf(indexKey),
  caption,
}).strict();

const tableSpec = z.object({
  type: z.literal("table"),
  /** Header row. */
  columns: z.array(z.union([z.number(), z.string().min(1).max(32)])).optional(),
  rows: z.array(z.array(z.union([z.number(), z.string().max(40)])).min(1).max(12)).min(1).max(24),
  /** Tones take `[row, col]` for one cell or a row number for the whole row. */
  ...tonesOf(z.union([cell, index])),
  caption,
}).strict();

type TreeSpec = z.infer<typeof treeSpec>;
type ListSpec = z.infer<typeof listSpec>;
type GraphSpec = z.infer<typeof graphSpec>;
type GridSpec = z.infer<typeof gridSpec>;
type ArraySpec = z.infer<typeof arraySpec>;
type StackSpec = z.infer<typeof stackSpec>;
type IntervalsSpec = z.infer<typeof intervalsSpec>;
type TableSpec = z.infer<typeof tableSpec>;
type Leaf = TreeSpec | ListSpec | GraphSpec | GridSpec | ArraySpec | StackSpec | IntervalsSpec | TableSpec;
const leafSpec = z.discriminatedUnion("type", [treeSpec, listSpec, graphSpec, gridSpec, arraySpec, stackSpec, intervalsSpec, tableSpec]);

const sequence = {
  /** Two to four figures in order: before → after, or the steps of an algorithm. */
  items: z.array(leafSpec).min(2).max(4),
  captions: z.array(z.string().max(40)).optional(),
  /** Draw arrows between the items. Defaults to true. */
  arrows: z.boolean().optional(),
  caption,
};
const rowSpec = z.object({ type: z.literal("row"), ...sequence }).strict();
const columnSpec = z.object({ type: z.literal("column"), ...sequence }).strict();

export const figureSpecSchema = z.union([leafSpec, rowSpec, columnSpec]);
export type FigureSpec = z.infer<typeof figureSpecSchema>;
export type FigureType = FigureSpec["type"];

/* Positions are in points with y growing downward. */
type Point = { x: number; y: number };
/** Where Graphviz put each node and, when it routed them, each edge, keyed
 *  `"from>to"`: a cubic Bézier chain, the arrow's tip for a directed edge, and
 *  where the edge's label sits. */
export type GraphLayout = (spec: GraphSpec) => { width: number; height: number; nodes: Record<string, Point>; edges?: Record<string, { points: Point[]; end?: Point; label?: Point }> };

export type FigureCheck = { ok: true; spec: FigureSpec } | { ok: false; error: string };

/**
 * Parses a fence body and checks it means something, not just that it has the
 * right shape: every index inside its structure, every tone on a real element,
 * paths along real edges, grids that are rectangles. Every refusal names the
 * field, because the reader is an agent that will fix it from this sentence alone.
 */
export function checkFigure(source: string): FigureCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    return { ok: false, error: `The figure is not valid JSON: ${(error as Error).message}` };
  }
  const parsed = figureSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, error: `${issue.path.join(".") || "figure"}: ${issue.message}` };
  }
  const spec = parsed.data;
  const problem = spec.type === "row" || spec.type === "column"
    ? spec.items.map((item, k) => { const found = meaning(item); return found ? `items.${k}: ${found}` : null; }).find(Boolean)
    : meaning(spec);
  return problem ? { ok: false, error: problem } : { ok: true, spec };
}

/** Each ```figure fence in a piece of markdown that does not check, as one
 *  sentence naming which figure it is. */
export function figureProblems(markdown: string): string[] {
  const problems: string[] = [];
  const fence = /^[ \t]*```figure[ \t]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  let count = 0;
  for (const match of markdown.matchAll(fence)) {
    count += 1;
    const result = checkFigure(match[1]!.trim());
    if (!result.ok) problems.push(`Figure ${count}: ${result.error}`);
  }
  return problems;
}

const keyOf = (key: unknown) => Array.isArray(key) ? key.join(",") : String(key);

/** The first tone field that puts a key in two tones, or names a key `has` refuses. */
function tonesProblem(type: string, spec: Partial<Record<ToneName, readonly unknown[] | undefined>>, has: (key: unknown) => string | null): string | null {
  const seen = new Map<string, ToneName>();
  for (const tone of TONE_NAMES) for (const key of spec[tone] ?? []) {
    const wrong = has(key);
    if (wrong) return `${type}.${tone}: ${wrong}`;
    const before = seen.get(keyOf(key));
    if (before) return `${type}.${tone}: ${JSON.stringify(key)} is already in ${before}; give each element one tone.`;
    seen.set(keyOf(key), tone);
  }
  return null;
}
function edgeTonesProblem(type: string, tones: Partial<Record<ToneName, readonly (readonly [unknown, unknown])[] | undefined>> | undefined, has: (from: unknown, to: unknown) => boolean): string | null {
  for (const tone of TONE_NAMES) for (const [from, to] of tones?.[tone] ?? []) {
    if (!has(from, to)) return `${type}.edgeTones.${tone}: there is no edge between ${JSON.stringify(from)} and ${JSON.stringify(to)}.`;
  }
  return null;
}
const first = (...checks: (() => string | null)[]) => { for (const check of checks) { const found = check(); if (found) return found; } return null; };

function meaning(spec: Leaf): string | null {
  const inRange = (size: number, what: string) => (key: unknown) => {
    const at = Number(key);
    return at < size ? null : `${JSON.stringify(key)} is past the end (${size} ${what}, counting from 0).`;
  };
  const each = (field: string, keys: readonly unknown[] | undefined, has: (key: unknown) => string | null) => () => {
    for (const key of keys ?? []) { const wrong = has(key); if (wrong) return `${field}: ${wrong}`; }
    return null;
  };
  switch (spec.type) {
    case "tree": {
      if (spec.values[0] === null) return "tree.values: the root cannot be null.";
      const { nodes, stray } = treeNodes(spec.values);
      if (stray !== null) return `tree.values: the entry at index ${stray} has no parent to hang from. In LeetCode's order a null has no children, so nothing is listed for them — drop the placeholder entries after a null.`;
      const byIndex = new Map(nodes.map((node) => [node.i, node]));
      const node = (key: unknown) => {
        const at = Number(key);
        if (at >= spec.values.length) return `${JSON.stringify(key)} is past the end of values (${spec.values.length} entries, counting nulls).`;
        return byIndex.has(at) ? null : `index ${at} is null in values, so there is no node there.`;
      };
      const joined = (a: unknown, b: unknown) => { const x = byIndex.get(Number(a)), y = byIndex.get(Number(b)); return Boolean(x && y && (x.parent === y || y.parent === x)); };
      return first(
        each("tree.removed", spec.removed, node),
        each("tree.path", spec.path, node),
        () => {
          for (let step = 1; step < (spec.path?.length ?? 0); step++) if (!joined(spec.path![step - 1], spec.path![step])) return `tree.path goes from index ${spec.path![step - 1]} to ${spec.path![step]}, which are not parent and child. List every node the route passes through, in order.`;
          return null;
        },
        each("tree.labels", Object.keys(spec.labels ?? {}), node),
        () => edgeTonesProblem("tree", spec.edgeTones, joined),
        () => tonesProblem("tree", spec, node),
      );
    }
    case "list": {
      const size = spec.values.length;
      const at = inRange(size, "nodes");
      const link = (key: unknown) => Number(key) < size - 1 ? null : `${key} is the last node, which has no next link.`;
      return first(
        () => spec.cycle !== undefined && spec.cycle >= size ? `list.cycle is ${spec.cycle} but the list has ${size} nodes.` : null,
        each("list.labels", Object.keys(spec.labels ?? {}), at),
        each("list.pointers", Object.values(spec.pointers ?? {}), at),
        each("list.removed", spec.removed, at),
        each("list.reversed", spec.reversed, link),
        each("list.cut", spec.cut, link),
        each("list.links", spec.links?.flatMap(([from, to]) => [from, to]), at),
        () => tonesProblem("list", spec, at),
      );
    }
    case "graph": {
      const ids = new Set(graphNodes(spec).map(String));
      const node = (key: unknown) => ids.has(String(key)) ? null : `${JSON.stringify(key)} is not a node of the graph.`;
      const pairs = new Set(spec.edges.flatMap(([from, to]) => spec.directed ? [`${from}>${to}`] : [`${from}>${to}`, `${to}>${from}`]));
      const edge = (from: unknown, to: unknown) => pairs.has(`${from}>${to}`);
      return first(
        () => {
          const seen = new Set<string>();
          for (const [from, to] of spec.edges) {
            const key = spec.directed ? `${from}>${to}` : [String(from), String(to)].sort().join(">");
            if (seen.has(key)) return `graph.edges lists ${from} → ${to} twice; merge them into one edge.`;
            seen.add(key);
          }
          return null;
        },
        () => {
          for (let step = 0; step + 1 < (spec.path?.length ?? 0); step++) {
            const [from, to] = [spec.path![step], spec.path![step + 1]];
            if (!edge(from, to)) return `graph.path goes ${from} → ${to}, but there is no such edge.`;
          }
          return null;
        },
        each("graph.path", spec.path, node),
        each("graph.names", Object.keys(spec.names ?? {}), node),
        each("graph.labels", Object.keys(spec.labels ?? {}), node),
        each("graph.removed", spec.removed, node),
        () => edgeTonesProblem("graph", spec.edgeTones, edge),
        () => tonesProblem("graph", spec, node),
      );
    }
    case "grid": {
      const height = spec.cells.length, width = spec.cells[0]!.length;
      const inside = (key: unknown) => {
        const [row, col] = Array.isArray(key) ? key as number[] : String(key).split(",").map(Number);
        return row! < height && col! < width ? null : `[${row},${col}] is outside a ${height}×${width} grid (rows and columns count from 0).`;
      };
      return first(
        () => spec.cells.some((row) => row.length !== width) ? "grid.cells: every row must have the same length." : null,
        () => spec.rows && spec.rows.length !== height ? `grid.rows has ${spec.rows.length} headers for ${height} rows.` : null,
        () => spec.cols && spec.cols.length !== width ? `grid.cols has ${spec.cols.length} headers for ${width} columns.` : null,
        each("grid.path", spec.path, inside),
        () => {
          for (let step = 1; step < (spec.path?.length ?? 0); step++) {
            const [a, b] = [spec.path![step - 1]!, spec.path![step]!];
            if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) return `grid.path jumps from [${a.join(",")}] to [${b.join(",")}]; each step must move to a neighbouring cell.`;
          }
          return null;
        },
        each("grid.labels", Object.keys(spec.labels ?? {}), inside),
        each("grid.arrows", spec.arrows?.flatMap(([from, to]) => [from, to]), inside),
        () => spec.arrows?.some(([from, to]) => keyOf(from) === keyOf(to)) ? "grid.arrows: an arrow must go between two different cells." : null,
        () => tonesProblem("grid", spec, inside),
      );
    }
    case "array": {
      const size = spec.values.length;
      const at = inRange(size, "values");
      return first(
        () => spec.window && (spec.window[0] > spec.window[1] || spec.window[1] >= size) ? `array.window [${spec.window.join(",")}] is not inside ${size} values.` : null,
        each("array.pointers", Object.values(spec.pointers ?? {}), at),
        each("array.labels", Object.keys(spec.labels ?? {}), at),
        each("array.removed", spec.removed, at),
        () => {
          for (const range of spec.ranges ?? []) if (range.from > range.to || range.to >= size) return `array.ranges: {from: ${range.from}, to: ${range.to}} is not inside ${size} values.`;
          return null;
        },
        each("array.arrows", spec.arrows?.flatMap(([from, to]) => [from, to]), at),
        () => spec.arrows?.some(([from, to]) => from === to) ? "array.arrows: an arrow must go between two different indexes." : null,
        () => spec.bars && spec.values.some((value) => typeof value !== "number") ? "array.bars: every value must be a number to draw it as a bar." : null,
        () => tonesProblem("array", spec, at),
      );
    }
    case "stack": {
      const at = inRange(spec.values.length, "entries");
      return first(each("stack.labels", Object.keys(spec.labels ?? {}), at), each("stack.removed", spec.removed, at), () => tonesProblem("stack", spec, at));
    }
    case "intervals": {
      const at = inRange(spec.items.length, "intervals");
      return first(
        () => { const bad = spec.items.findIndex(([start, end]) => start > end); return bad >= 0 ? `intervals.items.${bad}: the start ${spec.items[bad]![0]} is after the end ${spec.items[bad]![1]}.` : null; },
        each("intervals.labels", Object.keys(spec.labels ?? {}), at),
        each("intervals.removed", spec.removed, at),
        () => tonesProblem("intervals", spec, at),
      );
    }
    case "table": {
      const width = spec.rows[0]!.length;
      const inside = (key: unknown) => {
        if (typeof key === "number") return key < spec.rows.length ? null : `row ${key} is past the end (${spec.rows.length} rows, counting from 0, header not counted).`;
        const [row, col] = key as number[];
        return row! < spec.rows.length && col! < width ? null : `[${row},${col}] is outside a table of ${spec.rows.length} rows and ${width} columns (counting from 0, header not counted).`;
      };
      return first(
        () => spec.rows.some((row) => row.length !== width) ? "table.rows: every row must have the same number of cells." : null,
        () => spec.columns && spec.columns.length !== width ? `table.columns has ${spec.columns.length} headers for ${width} columns.` : null,
        () => tonesProblem("table", spec, inside),
      );
    }
  }
}

/* ------------------------------------------------------------------ drawing - */

const R = 19;
const TONE = { none: "var(--fig-node)", mark: "var(--fig-mark)", good: "var(--fig-good)", bad: "var(--fig-bad)", info: "var(--fig-info)" } as const;
const INK = { none: "var(--fig-ink)", mark: "var(--fig-mark-ink)", good: "var(--fig-good-ink)", bad: "var(--fig-bad-ink)", info: "var(--fig-info-ink)" } as const;
const MARKER = { none: "ink", mark: "mark-ink", good: "good-ink", bad: "bad-ink", info: "info-ink" } as const;
type Tone = keyof typeof TONE;
type Drawn = { body: string; w: number; h: number };

const esc = (value: unknown) => String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
const n = (value: number) => Math.round(value * 10) / 10;

/** A width for a label in the figure font, close enough to size boxes by. */
export function textWidth(value: unknown, size = 13.5): number {
  let units = 0;
  for (const char of String(value)) units += /[il.,:;|!'1()[\]{} ]/.test(char) ? 0.36 : /[mwMW@]/.test(char) ? 0.88 : /[A-Z0-9#$%&=+<>?]/.test(char) ? 0.66 : 0.56;
  return units * size;
}
function text(x: number, y: number, value: unknown, { size = 13.5, fill = "var(--fig-ink)", weight = 500, anchor = "middle" } = {}) {
  return `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" dominant-baseline="central" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(value)}</text>`;
}
/** A note on the figure: a few words on a backing that keeps them legible over lines. */
function pill(x: number, y: number, value: unknown, ink: string = INK.info) {
  const w = textWidth(value, 11) + 10;
  return `<rect x="${n(x - w / 2)}" y="${n(y - 8.5)}" width="${n(w)}" height="17" rx="8.5" fill="var(--fig-bg)" fill-opacity=".9"/>${text(x, y, value, { size: 11, fill: ink, weight: 600 })}`;
}
const pillWidth = (value: unknown) => textWidth(value, 11) + 10;
function ghostly(body: string, ghost: boolean) { return ghost ? `<g opacity="0.38">${body}</g>` : body; }
function circle(x: number, y: number, value: unknown, tone: Tone, ghost = false) {
  return ghostly(`<circle cx="${n(x)}" cy="${n(y)}" r="${R}" fill="${TONE[tone]}" stroke="${INK[tone]}" stroke-width="1.6"${ghost ? ' stroke-dasharray="3.5 3"' : ""}/>${text(x, y, value, { fill: INK[tone] })}`, ghost);
}
function box(x: number, y: number, w: number, h: number, value: unknown, tone: Tone, ghost = false, rx = 9) {
  return ghostly(`<rect x="${n(x - w / 2)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="${rx}" fill="${TONE[tone]}" stroke="${INK[tone]}" stroke-width="1.6"${ghost ? ' stroke-dasharray="3.5 3"' : ""}/>${text(x, y, value, { fill: INK[tone] })}`, ghost);
}
function line(x1: number, y1: number, x2: number, y2: number, tone: Tone, { hot = tone !== "none", arrow = false, ghost = false, dashed = false } = {}) {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${INK[tone]}" stroke-width="${hot ? 2.6 : 1.6}"${arrow ? ` marker-end="url(#fig-${MARKER[tone]})"` : ""}${ghost ? ' opacity="0.32"' : ""}${ghost || dashed ? ' stroke-dasharray="3.5 3"' : ""}/>`;
}
/** Key → tone, from the four tone fields. Checked specs never repeat a key. */
function toneMap(spec: Partial<Record<ToneName, readonly unknown[] | undefined>>): Map<string, ToneName> {
  const map = new Map<string, ToneName>();
  for (const tone of TONE_NAMES) for (const key of spec[tone] ?? []) if (!map.has(keyOf(key))) map.set(keyOf(key), tone);
  return map;
}
function edgeToneMap(tones: Partial<Record<ToneName, readonly (readonly [unknown, unknown])[] | undefined>> | undefined, directed: boolean): Map<string, ToneName> {
  const map = new Map<string, ToneName>();
  for (const tone of TONE_NAMES) for (const [from, to] of tones?.[tone] ?? []) {
    map.set(`${from}>${to}`, tone);
    if (!directed) map.set(`${to}>${from}`, tone);
  }
  return map;
}
const MARKERS = `<defs>${(["ink", "muted", "mark-ink", "good-ink", "bad-ink", "info-ink"] as const).map((name) =>
  `<marker id="fig-${name}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="var(--fig-${name})"/></marker>`).join("")}</defs>`;

/* -- tree -- */

type TreeNode = { v: unknown; i: number; d: number; l?: TreeNode; r?: TreeNode; parent?: TreeNode; rel: number; x: number; px: number; py: number };

/** The nodes a level-order array describes, and the first non-null entry left
 *  over with no parent slot, which means the array is not LeetCode's order. */
function treeNodes(values: readonly unknown[]): { nodes: TreeNode[]; stray: number | null } {
  const root: TreeNode = { v: values[0], i: 0, d: 0, rel: 0, x: 0, px: 0, py: 0 };
  const nodes = [root];
  const queue = [root];
  let at = 1;
  while (queue.length && at < values.length) {
    const parent = queue.shift()!;
    for (const side of ["l", "r"] as const) {
      const value = values[at];
      if (at < values.length && value !== null && value !== undefined) {
        const child: TreeNode = { v: value, i: at, d: parent.d + 1, parent, rel: 0, x: 0, px: 0, py: 0 };
        parent[side] = child; nodes.push(child); queue.push(child);
      }
      at++;
    }
  }
  let stray: number | null = null;
  for (let k = at; k < values.length; k++) if (values[k] !== null && values[k] !== undefined) { stray = k; break; }
  return { nodes, stray };
}

/**
 * A tidy tree: each subtree is laid out alone, then siblings are pushed apart
 * just far enough that their contours never come closer than one node gap. A
 * lone child sits to its own side, which is the whole reason a tree figure
 * exists — `[1,null,2]` and `[1,2]` are different trees.
 */
function drawTree(spec: TreeSpec): Drawn {
  const { nodes } = treeNodes(spec.values);
  const root = nodes[0]!;
  const labels = spec.labels ?? {};
  const widest = Math.max(0, ...Object.values(labels).map(pillWidth));
  const SEP = Math.max(46, widest + 8), LONE = 30;
  const lay = (node: TreeNode): { L: number[]; R: number[] } => {
    const kids = [node.l, node.r].filter((kid): kid is TreeNode => Boolean(kid)).map((kid) => ({ kid, c: lay(kid) }));
    if (!kids.length) return { L: [0], R: [0] };
    if (kids.length === 1) kids[0]!.kid.rel = node.l ? -LONE : LONE;
    else {
      const [a, b] = kids as [typeof kids[0], typeof kids[0]];
      let need = 0;
      for (let depth = 0; depth < Math.min(a.c.R.length, b.c.L.length); depth++) need = Math.max(need, a.c.R[depth]! - b.c.L[depth]! + SEP);
      a.kid.rel = -need / 2; b.kid.rel = need / 2;
    }
    const L = [0], Rr = [0];
    for (const { kid, c } of kids) c.L.forEach((value, depth) => {
      L[depth + 1] = Math.min(L[depth + 1] ?? Infinity, value + kid.rel);
      Rr[depth + 1] = Math.max(Rr[depth + 1] ?? -Infinity, c.R[depth]! + kid.rel);
    });
    return { L, R: Rr };
  };
  lay(root);
  const place = (node: TreeNode, x: number) => { node.x = x; for (const kid of [node.l, node.r]) if (kid) place(kid, x + kid.rel); };
  place(root, 0);
  const minX = Math.min(...nodes.map((node) => node.x)), maxX = Math.max(...nodes.map((node) => node.x));
  const padX = Math.max(R + 3, widest / 2 + 3), padY = R + 3, dy = widest ? 78 : 60, below = widest ? 22 : 0;
  for (const node of nodes) { node.px = padX + node.x - minX; node.py = padY + node.d * dy; }
  const removed = new Set((spec.removed ?? []).map(Number));
  const onPath = new Set((spec.path ?? []).map(Number));
  const route = new Set<string>();
  for (let step = 1; step < (spec.path?.length ?? 0); step++) { route.add(`${spec.path![step - 1]}>${spec.path![step]}`); route.add(`${spec.path![step]}>${spec.path![step - 1]}`); }
  const tones = toneMap(spec), edgeTones = edgeToneMap(spec.edgeTones, false);
  let edges = "", circles = "", notes = "";
  for (const node of nodes) {
    const ghost = removed.has(node.i);
    if (node.parent) {
      const p = node.parent, angle = Math.atan2(node.py - p.py, node.px - p.px);
      const tone: Tone = edgeTones.get(`${p.i}>${node.i}`) ?? (route.has(`${p.i}>${node.i}`) ? "good" : "none");
      edges += line(p.px + Math.cos(angle) * R, p.py + Math.sin(angle) * R, node.px - Math.cos(angle) * R, node.py - Math.sin(angle) * R, tone, { ghost });
    }
    const tone: Tone = tones.get(String(node.i)) ?? (onPath.has(node.i) ? "good" : ghost ? "bad" : "none");
    circles += circle(node.px, node.py, node.v, tone, ghost);
    const words = labels[String(node.i)];
    if (words) notes += pill(node.px, node.py + R + 12, words, tone === "none" ? INK.info : INK[tone]);
  }
  return { body: edges + circles + notes, w: padX * 2 + maxX - minX, h: padY * 2 + Math.max(...nodes.map((node) => node.d)) * dy + below };
}

/* -- list -- */

function drawList(spec: ListSpec): Drawn {
  const bw = Math.max(42, ...spec.values.map((value) => textWidth(value) + 16)), bh = 34, gap = 36, pad = 8;
  const pointerAt = new Map<number, string[]>();
  for (const [name, at] of Object.entries(spec.pointers ?? {})) pointerAt.set(at, [...(pointerAt.get(at) ?? []), name]);
  const labelH = spec.labels ? 20 : 0, pointerH = pointerAt.size ? 34 : 0;
  const top = pad + pointerH + labelH;
  const tones = toneMap(spec), removed = new Set(spec.removed), reversed = new Set(spec.reversed), cut = new Set(spec.cut);
  const xAt = (k: number) => pad + k * (bw + gap);
  let body = "";
  spec.values.forEach((value, k) => {
    const x = xAt(k), ghost = removed.has(k), tone: Tone = tones.get(String(k)) ?? (ghost ? "bad" : "none");
    body += box(x + bw / 2, top + bh / 2, bw, bh, value, tone, ghost, 8);
    const name = spec.labels?.[String(k)];
    if (name) body += text(x + bw / 2, top - 11, name, { size: 11, fill: INK.info, weight: 600 });
    const names = pointerAt.get(k);
    if (names) {
      body += text(x + bw / 2, pad + 7, names.join(", "), { size: 11.5, fill: INK.mark, weight: 650 });
      body += `<line x1="${x + bw / 2}" y1="${pad + 15}" x2="${x + bw / 2}" y2="${top - labelH - 3}" stroke="${INK.mark}" stroke-width="1.6" marker-end="url(#fig-mark-ink)"/>`;
    }
    const y = top + bh / 2;
    if (k < spec.values.length - 1) {
      if (cut.has(k)) body += text(x + bw + gap / 2, y, "×", { size: 15, fill: INK.bad, weight: 600 });
      else if (reversed.has(k)) body += `<line x1="${x + bw + gap - 2}" y1="${y}" x2="${x + bw + 3}" y2="${y}" stroke="${INK.mark}" stroke-width="2" marker-end="url(#fig-mark-ink)"/>`;
      else body += `<line x1="${x + bw + 2}" y1="${y}" x2="${x + bw + gap - 3}" y2="${y}" stroke="var(--fig-ink)" stroke-width="1.6" marker-end="url(#fig-ink)"/>`;
    } else if (spec.cycle === undefined) body += text(x + bw + 26, y, "null", { size: 12, fill: "var(--fig-muted)", weight: 400 });
  });
  /* Arcs under the row, each as deep as it is long, so a short link nests
     inside a long one instead of crossing it. */
  const arcs: { from: number; to: number; tone: Tone; dashed: boolean }[] = [];
  if (spec.cycle !== undefined) arcs.push({ from: spec.values.length - 1, to: spec.cycle, tone: "bad", dashed: true });
  for (const [from, to, tone] of spec.links ?? []) arcs.push({ from, to, tone: tone ?? "info", dashed: false });
  let depth = 0;
  arcs.forEach((arc) => {
    const y = top + bh, drop = 26 + Math.abs(arc.to - arc.from) * 13;
    const from = xAt(arc.from) + bw / 2 + (arc.from === arc.to ? -8 : 0), to = xAt(arc.to) + bw / 2 + (arc.from === arc.to ? 8 : 0);
    body += `<path d="M${n(from)},${y + 1} C${n(from)},${y + drop} ${n(to)},${y + drop} ${n(to)},${y + 4}" fill="none" stroke="${INK[arc.tone]}" stroke-width="1.6"${arc.dashed ? ' stroke-dasharray="5 4"' : ""} marker-end="url(#fig-${MARKER[arc.tone]})"/>`;
    depth = Math.max(depth, drop);
  });
  const w = pad * 2 + spec.values.length * (bw + gap) - gap + (spec.cycle === undefined ? 44 : 0);
  return { body, w, h: top + bh + (arcs.length ? depth * 0.78 + 6 : 8) };
}

/* -- graph -- */

export function graphNodes(spec: GraphSpec): (string | number)[] {
  const seen = new Map<string, string | number>();
  for (const node of [...(spec.nodes ?? []), ...spec.edges.flatMap(([from, to]) => [from, to])]) if (!seen.has(String(node))) seen.set(String(node), node);
  return [...seen.values()];
}

/** How big a node is drawn: a circle while its text fits one, else a box. */
function graphNodeSize(spec: GraphSpec, node: string | number): { w: number; h: number; round: boolean } {
  const shown = spec.names?.[String(node)] ?? node;
  const wide = textWidth(shown) + 18;
  if (spec.shape !== "box" && wide <= R * 2 + 2) return { w: R * 2, h: R * 2, round: true };
  return { w: Math.max(R * 2 + 6, wide), h: 32, round: false };
}

/** The DOT a graph spec is laid out from. Node labels are left off on
 *  purpose: Graphviz places nodes at the size Spar will draw them and routes
 *  edges around them, and Spar draws the rest. */
export function graphDot(spec: GraphSpec): string {
  const quote = (node: string | number) => `"${String(node).replace(/"/g, '\\"')}"`;
  const arrow = spec.directed ? "->" : "--";
  const spaced = spec.labels ? { nodesep: 0.8, ranksep: 1 } : { nodesep: 0.5, ranksep: 0.75 };
  const nodes = graphNodes(spec).map((node) => {
    const size = graphNodeSize(spec, node);
    return `${quote(node)} [shape=${size.round ? "circle" : "box"}, width=${Math.round(size.w / 72 * 100) / 100}, height=${Math.round(size.h / 72 * 100) / 100}]`;
  });
  return `${spec.directed ? "digraph" : "graph"} { graph [rankdir=${spec.layout ?? "LR"}, nodesep=${spaced.nodesep}, ranksep=${spaced.ranksep}]; node [fixedsize=true, label=""];
  ${nodes.join("; ")};
  ${spec.edges.map(([from, to, weight]) => `${quote(from)} ${arrow} ${quote(to)}${weight !== undefined ? ` [label="${String(weight).replace(/"/g, "")}", fontsize=11]` : ""}`).join("; ")} }`;
}

/** Where a line from a node's centre toward (dx, dy) leaves its outline. */
function rim(size: { w: number; h: number; round: boolean }, dx: number, dy: number, extra = 0) {
  const length = Math.hypot(dx, dy) || 1;
  if (size.round) return { x: (dx / length) * (R + extra), y: (dy / length) * (R + extra) };
  const scale = Math.min(Math.abs(dx) > 1e-6 ? (size.w / 2) / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? (size.h / 2) / Math.abs(dy) : Infinity);
  return { x: dx * scale + (dx / length) * extra, y: dy * scale + (dy / length) * extra };
}

function drawGraph(spec: GraphSpec, layoutGraph: GraphLayout | undefined): Drawn {
  if (!layoutGraph) throw new Error("graph figures need a layout engine");
  const ids = graphNodes(spec);
  const layout = layoutGraph(spec);
  const loops = spec.edges.some(([from, to]) => String(from) === String(to));
  const notesWide = Math.max(0, ...Object.values(spec.labels ?? {}).map(pillWidth));
  const pad = 6 + (spec.labels && spec.layout !== "TB" ? 16 : 0), padRight = pad + (spec.labels && spec.layout === "TB" ? notesWide + 4 : 0) + (loops && !layout.edges ? 44 : 0);
  const pos = (node: string | number) => { const at = layout.nodes[String(node)]!; return { x: at.x + pad, y: at.y + pad }; };
  const size = new Map(ids.map((node) => [String(node), graphNodeSize(spec, node)]));
  const directed = Boolean(spec.directed);
  const route = new Set<string>();
  for (let step = 0; step + 1 < (spec.path?.length ?? 0); step++) {
    route.add(`${spec.path![step]}>${spec.path![step + 1]}`);
    if (!directed) route.add(`${spec.path![step + 1]}>${spec.path![step]}`);
  }
  const edgeTones = edgeToneMap(spec.edgeTones, directed), tones = toneMap(spec);
  const removed = new Set((spec.removed ?? []).map(String)), onPath = new Set((spec.path ?? []).map(String));
  const both = new Set(spec.edges.map(([from, to]) => `${from}>${to}`));
  let edges = "", weights = "";
  const shift = (point: Point) => ({ x: point.x + pad, y: point.y + pad });
  spec.edges.forEach(([from, to, weight]) => {
    const tone: Tone = edgeTones.get(`${from}>${to}`) ?? (route.has(`${from}>${to}`) ? "good" : "none");
    const ghost = removed.has(String(from)) || removed.has(String(to));
    const stroke = `stroke="${INK[tone]}" stroke-width="${tone !== "none" ? 2.6 : 1.6}"${directed ? ` marker-end="url(#fig-${MARKER[tone]})"` : ""}${ghost ? ' opacity="0.32" stroke-dasharray="3.5 3"' : ""}`;
    const p = pos(from), q = pos(to), sp = size.get(String(from))!, sq = size.get(String(to))!;
    let mid: { x: number; y: number };
    const routed = layout.edges?.[`${from}>${to}`];
    if (routed && routed.points.length >= 4 && !(directed && both.has(`${to}>${from}`) && String(from) !== String(to))) {
      /* Graphviz's own route: it knows where every node and label sits, so its
         curves go around them, loops included. */
      const [start, ...rest] = routed.points.map(shift);
      let d = `M${n(start!.x)},${n(start!.y)}`;
      for (let at = 0; at + 2 < rest.length; at += 3) d += ` C${n(rest[at]!.x)},${n(rest[at]!.y)} ${n(rest[at + 1]!.x)},${n(rest[at + 1]!.y)} ${n(rest[at + 2]!.x)},${n(rest[at + 2]!.y)}`;
      if (routed.end) { const tip = shift(routed.end); d += ` L${n(tip.x)},${n(tip.y)}`; }
      edges += `<path d="${d}" fill="none" ${stroke}/>`;
      const middle = routed.points.length >= 4 ? shift(routed.points[Math.floor(routed.points.length / 2)]!) : shift(routed.points[0]!);
      mid = routed.label ? shift(routed.label) : middle;
    } else if (String(from) === String(to)) {
      /* A self-loop sits on the node's right, where Graphviz left it room. */
      const x = p.x + sp.w / 2 - 3;
      edges += `<path d="M${n(x)},${n(p.y - 8)} C${n(x + 40)},${n(p.y - 34)} ${n(x + 40)},${n(p.y + 34)} ${n(x + 1)},${n(p.y + 9)}" fill="none" ${stroke}/>`;
      mid = { x: x + 38, y: p.y };
    } else if (directed && both.has(`${to}>${from}`)) {
      /* Two edges between the same pair, one each way: bow both out so they
         read as two, rather than one line with two heads. */
      const dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy) || 1, bend = 22;
      const cx = (p.x + q.x) / 2 + (dy / length) * bend, cy = (p.y + q.y) / 2 - (dx / length) * bend;
      const a = rim(sp, cx - p.x, cy - p.y), b = rim(sq, cx - q.x, cy - q.y, 2);
      edges += `<path d="M${n(p.x + a.x)},${n(p.y + a.y)} Q${n(cx)},${n(cy)} ${n(q.x + b.x)},${n(q.y + b.y)}" fill="none" ${stroke}/>`;
      mid = { x: (p.x + q.x) / 4 + cx / 2, y: (p.y + q.y) / 4 + cy / 2 };
    } else {
      const a = rim(sp, q.x - p.x, q.y - p.y), b = rim(sq, p.x - q.x, p.y - q.y, directed ? 2 : 0);
      edges += `<line x1="${n(p.x + a.x)}" y1="${n(p.y + a.y)}" x2="${n(q.x + b.x)}" y2="${n(q.y + b.y)}" ${stroke}/>`;
      mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    }
    if (weight !== undefined) {
      const wide = Math.max(22, textWidth(weight, 11.5) + 12);
      weights += `<rect x="${n(mid.x - wide / 2)}" y="${n(mid.y - 9)}" width="${n(wide)}" height="18" rx="9" fill="var(--fig-bg)"/>` + text(mid.x, mid.y, weight, { size: 11.5, fill: tone !== "none" ? INK[tone] : "var(--fig-muted)", weight: tone !== "none" ? 650 : 500 });
    }
  });
  let nodes = "", notes = "";
  for (const node of ids) {
    const at = pos(node), s = size.get(String(node))!, ghost = removed.has(String(node));
    const tone: Tone = tones.get(String(node)) ?? (onPath.has(String(node)) ? "good" : ghost ? "bad" : "none");
    const shown = spec.names?.[String(node)] ?? node;
    nodes += s.round ? circle(at.x, at.y, shown, tone, ghost) : box(at.x, at.y, s.w, s.h, shown, tone, ghost);
    const words = spec.labels?.[String(node)];
    /* Above a node when edges run sideways; beside it when they run down,
       where above is where its parent's edge comes in. */
    if (words) notes += spec.layout === "TB"
      ? pill(at.x + s.w / 2 + 4 + pillWidth(words) / 2, at.y, words, tone === "none" ? INK.info : INK[tone])
      : pill(at.x, at.y - s.h / 2 - 11, words, tone === "none" ? INK.info : INK[tone]);
  }
  return { body: edges + weights + nodes + notes, w: layout.width + pad + padRight, h: layout.height + pad * 2 };
}

/* -- grid -- */

function drawGrid(spec: GridSpec): Drawn {
  const rows = spec.cells.length, cols = spec.cells[0]!.length, g = 3;
  const c = spec.showValues === false ? 36 : Math.max(36, ...spec.cells.flat().map((value) => textWidth(value, 12.5) + 12));
  const left = spec.rows ? Math.max(...spec.rows.map((value) => textWidth(value, 12))) + 14 : 0;
  const top = spec.cols ? 24 : 0, pad = 2;
  const cx = (col: number) => pad + left + col * (c + g), cy = (row: number) => pad + top + row * (c + g);
  const route = new Set((spec.path ?? []).map(keyOf));
  const tones = toneMap(spec);
  let body = "";
  spec.cols?.forEach((value, col) => { body += text(cx(col) + c / 2, pad + 10, value, { size: 12, fill: "var(--fig-muted)", weight: 650 }); });
  spec.rows?.forEach((value, row) => { body += text(pad + left - 10, cy(row) + c / 2, value, { size: 12, fill: "var(--fig-muted)", weight: 650, anchor: "end" }); });
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const value = spec.cells[row]![col]!, x = cx(col), y = cy(row), key = `${row},${col}`;
    const wall = spec.wall !== undefined && String(value) === String(spec.wall);
    const tone: Tone = wall ? "none" : tones.get(key) ?? spec.fill?.[String(value)] ?? (route.has(key) ? "good" : "none");
    const bg = wall ? "var(--fig-wall)" : tone === "none" ? "var(--fig-cell)" : TONE[tone];
    const strong = tones.has(key);
    body += `<rect x="${n(x)}" y="${n(y)}" width="${n(c)}" height="${c}" rx="6" fill="${bg}"${tone !== "none" ? ` stroke="${INK[tone]}" stroke-opacity="${strong ? 1 : 0.45}" stroke-width="${strong ? 1.8 : 1.2}"` : ""}/>`;
    if (spec.showValues !== false && !wall) body += text(x + c / 2, y + c / 2, value, { size: 12.5, fill: tone === "none" ? "var(--fig-muted)" : INK[tone], weight: strong ? 650 : 500 });
  }
  /* Notes go in the cell's corner, or its middle when values are hidden. A
     route is its cells; with values hidden its ends are named S and E. */
  const notes: Record<string, string> = { ...(spec.labels ?? {}) };
  if (spec.showValues === false && spec.path?.length) {
    notes[keyOf(spec.path[0])] ??= "S";
    if (spec.path.length > 1) notes[keyOf(spec.path.at(-1))] ??= "E";
  }
  for (const [key, words] of Object.entries(notes)) {
    const [row, col] = key.split(",").map(Number) as [number, number];
    const tone = tones.get(key) ?? (route.has(key) ? "good" : "info");
    body += spec.showValues === false
      ? text(cx(col) + c / 2, cy(row) + c / 2, words, { size: 11.5, fill: INK[tone], weight: 700 })
      : text(cx(col) + 3.5, cy(row) + 7.5, words, { size: 8.5, fill: INK[tone], weight: 650, anchor: "start" });
  }
  for (const [from, to, tone = "info"] of spec.arrows ?? []) {
    const x1 = cx(from[1]) + c / 2, y1 = cy(from[0]) + c / 2, x2 = cx(to[1]) + c / 2, y2 = cy(to[0]) + c / 2;
    /* Edge to edge, so the arrow crosses the gap between cells and never
       sits on a value. */
    const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy) || 1, trim = c / 2 - 7;
    body += `<line x1="${n(x1 + (dx / length) * trim)}" y1="${n(y1 + (dy / length) * trim)}" x2="${n(x2 - (dx / length) * trim)}" y2="${n(y2 - (dy / length) * trim)}" stroke="${INK[tone]}" stroke-width="1.8" marker-end="url(#fig-${MARKER[tone]})"/>`;
  }
  return { body, w: pad * 2 + left + cols * (c + g) - g, h: pad * 2 + top + rows * (c + g) - g };
}

/* -- array -- */

/** Lanes for spans so that no two overlapping spans share one. */
function lanes<T extends { from: number; to: number }>(spans: T[], touching = true): (T & { lane: number })[] {
  const ends: number[] = [];
  return [...spans].map((span, order) => ({ span, order })).sort((a, b) => a.span.from - b.span.from || a.order - b.order).map(({ span, order }) => {
    let lane = ends.findIndex((end) => touching ? end < span.from : end <= span.from);
    if (lane < 0) { lane = ends.length; ends.push(span.to); } else ends[lane] = span.to;
    return { ...span, lane, order };
  }).sort((a, b) => a.order - b.order);
}

function drawArray(spec: ArraySpec): Drawn {
  const c = Math.max(38, ...spec.values.map((value) => textWidth(value) + 14)), g = 4, pad = 4;
  const tones = toneMap(spec), removed = new Set(spec.removed);
  const xAt = (i: number) => pad + i * (c + g);
  const arcRise = (from: number, to: number) => Math.min(46, 14 + Math.abs(to - from) * 7);
  const arcsH = spec.arrows?.length ? Math.max(...spec.arrows.map(([from, to]) => arcRise(from, to))) * 0.78 + 6 : 0;
  const labelsH = spec.labels ? 20 : 0;
  const numbers = spec.bars ? spec.values.map(Number) : [];
  const low = Math.min(0, ...numbers), high = Math.max(0, ...numbers);
  const barH = spec.bars ? 120 : 0;
  const cellTop = pad + arcsH + labelsH + (spec.bars ? 16 : 0);
  const cellBottom = cellTop + (spec.bars ? barH : c);
  let body = "";
  spec.values.forEach((value, i) => {
    const x = xAt(i), ghost = removed.has(i);
    const tone: Tone = tones.get(String(i)) ?? (ghost ? "bad" : "none");
    const inside = spec.window ? i >= spec.window[0] && i <= spec.window[1] : false;
    const fill = tone !== "none" ? TONE[tone] : inside ? "var(--fig-info)" : "var(--fig-cell)";
    const stroke = tone !== "none" ? INK[tone] : inside ? "var(--fig-info-ink)" : "";
    let cellBody: string;
    if (spec.bars) {
      const span = high - low || 1, zero = cellTop + (high / span) * barH, v = numbers[i]!;
      const y = v >= 0 ? zero - (v / span) * barH : zero, h = Math.max(2, Math.abs(v / span) * barH);
      cellBody = `<rect x="${n(x + 3)}" y="${n(y)}" width="${n(c - 6)}" height="${n(h)}" rx="4" fill="${fill === "var(--fig-cell)" ? "var(--fig-wall)" : fill}"${stroke ? ` stroke="${stroke}" stroke-width="1.4"` : ""}${fill === "var(--fig-cell)" ? ' fill-opacity=".28"' : ""}/>`
        + text(x + c / 2, v >= 0 ? y - 9 : y + h + 9, value, { size: 11.5, fill: tone !== "none" ? INK[tone] : "var(--fig-ink)" });
    } else {
      cellBody = `<rect x="${n(x)}" y="${n(cellTop)}" width="${n(c)}" height="${n(c)}" rx="7" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="1.4"` : ""}${ghost ? ' stroke-dasharray="3.5 3"' : ""}/>`
        + text(x + c / 2, cellTop + c / 2, value, { fill: tone !== "none" ? INK[tone] : "var(--fig-ink)" });
    }
    body += ghostly(cellBody, ghost);
    if (ghost && !spec.bars) body += `<line x1="${n(x + 6)}" y1="${n(cellTop + c - 6)}" x2="${n(x + c - 6)}" y2="${n(cellTop + 6)}" stroke="${INK.bad}" stroke-width="1.6" opacity=".7"/>`;
    const words = spec.labels?.[String(i)];
    if (words) body += text(x + c / 2, cellTop - (spec.bars ? 26 : 10), words, { size: 11, fill: tone === "none" ? INK.info : INK[tone], weight: 600 });
    if (spec.indexes !== false) body += text(x + c / 2, cellBottom + 11, i, { size: 10, fill: "var(--fig-muted)", weight: 400 });
  });
  if (spec.bars) body += `<line x1="${pad}" y1="${n(cellTop + (high / ((high - low) || 1)) * barH)}" x2="${n(xAt(spec.values.length) - g)}" y2="${n(cellTop + (high / ((high - low) || 1)) * barH)}" stroke="var(--fig-muted)" stroke-width="1"/>`;
  for (const [from, to, tone = "info"] of spec.arrows ?? []) {
    const x1 = xAt(from) + c / 2 + (to > from ? 4 : -4), x2 = xAt(to) + c / 2 + (to > from ? -4 : 4), y = cellTop - labelsH - 2, rise = arcRise(from, to);
    body += `<path d="M${n(x1)},${n(y)} C${n(x1)},${n(y - rise)} ${n(x2)},${n(y - rise)} ${n(x2)},${n(y - 1)}" fill="none" stroke="${INK[tone]}" stroke-width="1.7" marker-end="url(#fig-${MARKER[tone]})"/>`;
  }
  let y = cellBottom + (spec.indexes !== false ? 22 : 8);
  const ranged = lanes((spec.ranges ?? []).map((range) => ({ ...range })));
  const rangeLanes = ranged.length ? Math.max(...ranged.map((range) => range.lane)) + 1 : 0;
  for (const range of ranged) {
    const ry = y + range.lane * 30, tone: Tone = range.tone ?? "info", x1 = xAt(range.from) + 2, x2 = xAt(range.to) + c - 2;
    body += `<path d="M${n(x1)},${n(ry)} L${n(x1)},${n(ry + 6)} L${n(x2)},${n(ry + 6)} L${n(x2)},${n(ry)}" fill="none" stroke="${INK[tone]}" stroke-width="1.6"/>`;
    if (range.label) body += text((x1 + x2) / 2, ry + 17, range.label, { size: 11, fill: INK[tone], weight: 600 });
  }
  y += rangeLanes * 30;
  const byIndex = new Map<number, string[]>();
  for (const [name, i] of Object.entries(spec.pointers ?? {})) byIndex.set(i, [...(byIndex.get(i) ?? []), name]);
  for (const [i, names] of byIndex) {
    const x = xAt(i) + c / 2;
    body += `<line x1="${n(x)}" y1="${n(y + 20)}" x2="${n(x)}" y2="${n(y + 2)}" stroke="var(--fig-info-ink)" stroke-width="1.6" marker-end="url(#fig-info-ink)"/>`;
    body += text(x, y + 30, names.join(", "), { size: 12, fill: "var(--fig-info-ink)", weight: 650 });
  }
  if (byIndex.size) y += 40;
  const w = Math.max(pad * 2 + spec.values.length * (c + g) - g, ...[...byIndex.entries()].map(([i, names]) => xAt(i) + c / 2 + textWidth(names.join(", "), 12) / 2 + pad));
  return { body, w, h: y };
}

/* -- stack -- */

function drawStack(spec: StackSpec): Drawn {
  const w = Math.max(64, ...spec.values.map((value) => textWidth(value) + 28)), h = 30, g = 3, left = 38, pad = 4;
  const notesW = Math.max(0, ...Object.values(spec.labels ?? {}).map((words) => textWidth(words, 11) + 12));
  const tones = toneMap(spec), removed = new Set(spec.removed);
  const count = spec.values.length, height = Math.max(1, count) * (h + g) + 10;
  let body = "";
  const yAt = (k: number) => pad + (count - 1 - k) * (h + g);
  spec.values.forEach((value, k) => {
    const ghost = removed.has(k), tone: Tone = tones.get(String(k)) ?? (ghost ? "bad" : "none");
    body += box(left + w / 2, yAt(k) + h / 2, w, h, value, tone === "none" ? "none" : tone, ghost, 6);
    const words = spec.labels?.[String(k)];
    if (words) body += text(left + w + 10, yAt(k) + h / 2, words, { size: 11, fill: tone === "none" ? INK.info : INK[tone], weight: 600, anchor: "start" });
  });
  if (count) body += text(left - 26, yAt(count - 1) + h / 2, "top", { size: 11, fill: INK.mark, weight: 650 }) + `<line x1="${left - 13}" y1="${yAt(count - 1) + h / 2}" x2="${left - 3}" y2="${yAt(count - 1) + h / 2}" stroke="${INK.mark}" stroke-width="1.6" marker-end="url(#fig-mark-ink)"/>`;
  else body += text(left + w / 2, pad + h / 2, "empty", { size: 12, fill: "var(--fig-muted)", weight: 400 });
  const base = pad + Math.max(1, count) * (h + g) + 2;
  body += `<path d="M${left - 6},${pad + 2} L${left - 6},${base} L${left + w + 6},${base} L${left + w + 6},${pad + 2}" fill="none" stroke="var(--fig-muted)" stroke-width="1.4"/>`;
  return { body, w: left + w + 8 + notesW + pad, h: Math.max(height, base + 4) };
}

/* -- intervals -- */

function niceStep(span: number): number {
  const rough = span / 10, power = 10 ** Math.floor(Math.log10(rough || 1));
  return [1, 2, 5, 10].map((k) => k * power).find((step) => step >= rough) ?? power * 10;
}

function drawIntervals(spec: IntervalsSpec): Drawn {
  const markers = Object.entries(spec.markers ?? {});
  const points = [...spec.items.flat(), ...markers.map(([, at]) => at)];
  const low = Math.min(...points), high = Math.max(...points), span = high - low;
  /* Wide enough that each interval's own text fits inside it, where that
     does not stretch the line past a readable width; text that still does not
     fit goes beside its bar. */
  const fitted = Math.max(0, ...spec.items.map(([from, to], k) => to > from ? (textWidth(spec.labels?.[String(k)] ?? `[${from},${to}]`, 11) + 12) / (to - from) : 0));
  const unit = span ? Math.min(Math.max(6, 560 / span, Math.min(fitted, 900 / span)), Math.max(48, 560 / span)) : 40;
  const pad = 14, laneH = 26, top = markers.length ? 22 : 4;
  const xAt = (value: number) => pad + (value - low) * unit;
  const tones = toneMap(spec), removed = new Set(spec.removed);
  const spans = spec.items.map(([from, to]) => ({ from, to }));
  const placed = spec.packed ? lanes(spans) : spans.map((item, k) => ({ ...item, lane: k }));
  const laneCount = Math.max(...placed.map((item) => item.lane)) + 1;
  let body = "", right = xAt(high);
  placed.forEach((item, k) => {
    const ghost = removed.has(k), tone: Tone = tones.get(String(k)) ?? (ghost ? "bad" : "none");
    const x1 = xAt(item.from), x2 = Math.max(xAt(item.to), x1 + 10), y = top + item.lane * laneH;
    const words = spec.labels?.[String(k)] ?? `[${item.from},${item.to}]`;
    const fits = textWidth(words, 11) + 10 <= x2 - x1;
    const bar = `<rect x="${n(x1)}" y="${n(y)}" width="${n(x2 - x1)}" height="${laneH - 8}" rx="6" fill="${tone === "none" ? "var(--fig-cell)" : TONE[tone]}" stroke="${tone === "none" ? "var(--fig-muted)" : INK[tone]}" stroke-width="1.4"${ghost ? ' stroke-dasharray="3.5 3"' : ""}/>`;
    const label = fits
      ? text((x1 + x2) / 2, y + (laneH - 8) / 2, words, { size: 11, fill: tone === "none" ? "var(--fig-ink)" : INK[tone], weight: 600 })
      : text(x2 + 6, y + (laneH - 8) / 2, words, { size: 11, fill: tone === "none" ? "var(--fig-muted)" : INK[tone], weight: 600, anchor: "start" });
    body += ghostly(bar + label, ghost);
    if (!fits) right = Math.max(right, x2 + 6 + textWidth(words, 11));
  });
  const axis = top + laneCount * laneH + 6;
  body += `<line x1="${pad - 6}" y1="${axis}" x2="${n(xAt(high) + 6)}" y2="${axis}" stroke="var(--fig-muted)" stroke-width="1.2"/>`;
  const step = niceStep(span || 1);
  for (let tick = Math.ceil(low / step) * step; tick <= high + 1e-9; tick += step) {
    const x = xAt(tick);
    body += `<line x1="${n(x)}" y1="${axis}" x2="${n(x)}" y2="${axis + 4}" stroke="var(--fig-muted)" stroke-width="1.2"/>` + text(x, axis + 14, n(tick), { size: 10, fill: "var(--fig-muted)", weight: 400 });
  }
  for (const [name, at] of markers) {
    const x = xAt(at);
    body += `<line x1="${n(x)}" y1="${top - 4}" x2="${n(x)}" y2="${axis}" stroke="${INK.mark}" stroke-width="1.5" stroke-dasharray="4 3"/>` + text(x, 9, name, { size: 11, fill: INK.mark, weight: 650 });
  }
  return { body, w: Math.max(right, xAt(high)) + pad, h: axis + 24 };
}

/* -- table -- */

function drawTable(spec: TableSpec): Drawn {
  const width = spec.rows[0]!.length, rowH = 28, g = 2, pad = 2;
  const colW = Array.from({ length: width }, (_, col) => Math.max(36, textWidth(spec.columns?.[col] ?? "", 12) + 20, ...spec.rows.map((row) => textWidth(row[col] ?? "", 12.5) + 20)));
  const xs = colW.reduce<number[]>((acc, w, col) => [...acc, acc[col]! + w + g], [pad]);
  const top = spec.columns ? rowH : 0;
  const tones = toneMap(spec);
  let body = "";
  spec.columns?.forEach((value, col) => { body += text(xs[col]! + colW[col]! / 2, pad + rowH / 2, value, { size: 12, fill: "var(--fig-muted)", weight: 650 }); });
  spec.rows.forEach((row, r) => row.forEach((value, col) => {
    const tone: Tone = tones.get(`${r},${col}`) ?? tones.get(String(r)) ?? "none";
    const x = xs[col]!, y = pad + top + r * (rowH + g);
    body += `<rect x="${n(x)}" y="${n(y)}" width="${n(colW[col]!)}" height="${rowH}" rx="5" fill="${tone === "none" ? "var(--fig-cell)" : TONE[tone]}"${tone !== "none" ? ` stroke="${INK[tone]}" stroke-opacity=".6" stroke-width="1.2"` : ""}/>`;
    if (value !== "") body += text(x + colW[col]! / 2, y + rowH / 2, value, { size: 12.5, fill: tone === "none" ? "var(--fig-ink)" : INK[tone] });
  }));
  return { body, w: xs[width]! - g + pad, h: pad * 2 + top + spec.rows.length * (rowH + g) - g };
}

/* -- composition -- */

function drawLeaf(spec: Leaf, layoutGraph: GraphLayout | undefined): Drawn {
  switch (spec.type) {
    case "tree": return drawTree(spec);
    case "list": return drawList(spec);
    case "graph": return drawGraph(spec, layoutGraph);
    case "grid": return drawGrid(spec);
    case "array": return drawArray(spec);
    case "stack": return drawStack(spec);
    case "intervals": return drawIntervals(spec);
    case "table": return drawTable(spec);
  }
}

function withCaption(drawn: Drawn, words: string | undefined): Drawn {
  if (!words) return drawn;
  const lines = wrap(words, Math.max(drawn.w, 320));
  const w = Math.max(drawn.w, ...lines.map((entry) => textWidth(entry, 12) + 4));
  const shift = (w - drawn.w) / 2;
  const body = (shift ? `<g transform="translate(${n(shift)},0)">${drawn.body}</g>` : drawn.body)
    + lines.map((entry, k) => text(w / 2, drawn.h + 18 + k * 16, entry, { size: 12, fill: "var(--fig-muted)", weight: 500 })).join("");
  return { body, w, h: drawn.h + 12 + lines.length * 16 };
}
function wrap(words: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (current && textWidth(next, 12) > width) { lines.push(current); current = word; } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

function drawSequence(spec: z.infer<typeof rowSpec> | z.infer<typeof columnSpec>, layoutGraph: GraphLayout | undefined): Drawn {
  const parts = spec.items.map((item) => withCaption(drawLeaf(item, layoutGraph), item.caption));
  const cap = spec.captions?.length ? 24 : 0, gap = spec.type === "row" ? 64 : 44;
  let body = "";
  if (spec.type === "row") {
    const h = Math.max(...parts.map((part) => part.h)) + cap;
    let x = 0;
    parts.forEach((part, k) => {
      body += `<g transform="translate(${n(x)},${n(cap + (h - cap - part.h) / 2)})">${part.body}</g>`;
      const caption = spec.captions?.[k];
      if (caption) body += text(x + part.w / 2, 8, caption, { size: 11.5, fill: "var(--fig-muted)", weight: 600 });
      x += part.w;
      if (k < parts.length - 1) {
        if (spec.arrows !== false) body += `<line x1="${x + 14}" y1="${n(cap + (h - cap) / 2)}" x2="${x + gap - 14}" y2="${n(cap + (h - cap) / 2)}" stroke="var(--fig-muted)" stroke-width="1.6" marker-end="url(#fig-muted)"/>`;
        x += gap;
      }
    });
    return { body, w: x, h };
  }
  const w = Math.max(...parts.map((part) => part.w), ...(spec.captions ?? []).map((caption) => textWidth(caption, 11.5) + 8));
  let y = 0;
  parts.forEach((part, k) => {
    const caption = spec.captions?.[k];
    if (caption) { body += text(w / 2, y + 8, caption, { size: 11.5, fill: "var(--fig-muted)", weight: 600 }); y += cap; }
    body += `<g transform="translate(${n((w - part.w) / 2)},${n(y)})">${part.body}</g>`;
    y += part.h;
    if (k < parts.length - 1) {
      if (spec.arrows !== false) body += `<line x1="${n(w / 2)}" y1="${y + 10}" x2="${n(w / 2)}" y2="${y + gap - 10}" stroke="var(--fig-muted)" stroke-width="1.6" marker-end="url(#fig-muted)"/>`;
      y += gap;
    }
  });
  return { body, w, h: y };
}

/** Whether drawing this spec needs Graphviz, so a caller can skip loading it. */
export function figureNeedsLayout(spec: FigureSpec): boolean {
  return spec.type === "graph" || ((spec.type === "row" || spec.type === "column") && spec.items.some((item) => item.type === "graph"));
}

/** A checked spec as a standalone SVG string. Every label is escaped. */
export function renderFigure(spec: FigureSpec, layoutGraph?: GraphLayout): string {
  const drawn = withCaption(spec.type === "row" || spec.type === "column" ? drawSequence(spec, layoutGraph) : drawLeaf(spec, layoutGraph), spec.caption);
  const w = Math.ceil(drawn.w), h = Math.ceil(drawn.h);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="figure-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="var(--fig-font)" role="img"${spec.caption ? ` aria-label="${esc(spec.caption)}"` : ""}>${MARKERS}${drawn.body}</svg>`;
}

/** Graphviz's JSON output, read into the layout `renderFigure` wants. Shared so
 *  both processes parse it the same way. */
export function readGraphvizLayout(json: string): ReturnType<GraphLayout> {
  const out = JSON.parse(json) as { bb: string; objects?: { name: string; pos?: string }[]; edges?: { tail: number; head: number; pos?: string; lp?: string }[] };
  const [, , width, height] = out.bb.split(",").map(Number) as [number, number, number, number];
  const point = (pair: string): Point => { const [x, y] = pair.split(",").map(Number) as [number, number]; return { x, y: height - y }; };
  const nodes: Record<string, Point> = {};
  for (const object of out.objects ?? []) if (object.pos) nodes[object.name] = point(object.pos);
  /* An edge's pos is "e,x,y" for the arrow tip (and "s,x,y" for a tail
     arrow, unused here), then the Bézier points. Edges come back grouped by
     node, not in the order declared, so they are keyed by their ends. */
  const edges: NonNullable<ReturnType<GraphLayout>["edges"]> = {};
  for (const edge of out.edges ?? []) {
    const tail = out.objects?.[edge.tail]?.name, head = out.objects?.[edge.head]?.name;
    if (!edge.pos || tail === undefined || head === undefined) continue;
    let end: Point | undefined;
    const points: Point[] = [];
    for (const token of edge.pos.trim().split(/\s+/)) {
      if (token.startsWith("e,")) end = point(token.slice(2));
      else if (!token.startsWith("s,")) points.push(point(token));
    }
    edges[`${tail}>${head}`] = { points, ...(end ? { end } : {}), ...(edge.lp ? { label: point(edge.lp) } : {}) };
  }
  return { width, height, nodes, edges };
}
