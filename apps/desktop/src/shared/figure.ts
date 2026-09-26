import { z } from "zod";

/**
 * Figures: the pictures a challenge statement carries, as data.
 *
 * The agent never draws. It writes a ```figure fence holding one of the specs
 * below — a tree as its level-order array, a list as its values, a graph as its
 * edges — and this module turns that into an SVG. Two consequences are the point
 * of doing it this way rather than letting a model write SVG or DOT:
 *
 * - The picture and the example cannot disagree. `root = [3,9,20,null,null,15,7]`
 *   in the statement and `"values": [3,9,20,null,null,15,7]` in the figure are
 *   the same serialisation, so a figure is checked by parsing, not by looking.
 * - The agent cannot see what it drew, and here it does not have to: layout is
 *   this module's job, so a figure either validates and looks right or is
 *   refused with a reason the agent can act on.
 *
 * Colours are CSS variables (`--fig-*`, defined in theme.css) so one SVG follows
 * the app between light and dark. Graph layout is Graphviz's, injected as
 * `layoutGraph` so this file stays free of WASM and runs in either process.
 */

const label = z.union([z.number(), z.string().min(1).max(12)]);
const index = z.number().int().min(0);
/** Tones a node or cell can take. `mark` is "look here", `good` a route or an
 *  answer, `bad` something removed or wrong, `info` a region or pointer. */
const tones = { mark: z.array(z.union([index, z.string()])).optional(), good: z.array(z.union([index, z.string()])).optional(), bad: z.array(z.union([index, z.string()])).optional(), info: z.array(z.union([index, z.string()])).optional() };

const treeSpec = z.object({
  type: z.literal("tree"),
  /** LeetCode's level-order serialisation, nulls included. */
  values: z.array(label.nullable()).min(1).max(63),
  /** Level-order indexes (into `values`) drawn faded and dashed. */
  removed: z.array(index).optional(),
  /** Level-order indexes whose connecting edges are drawn as a route. */
  path: z.array(index).optional(),
  ...tones,
}).strict();

const listSpec = z.object({
  type: z.literal("list"),
  values: z.array(label).min(1).max(12),
  /** Index the tail points back to, LeetCode's `pos`. */
  cycle: index.optional(),
  /** Short names above nodes, by index: `{"0": "head"}`. */
  labels: z.record(z.string().regex(/^\d+$/), z.string().min(1).max(10)).optional(),
  ...tones,
}).strict();

const graphSpec = z.object({
  type: z.literal("graph"),
  directed: z.boolean().optional(),
  /** Isolated nodes, or to fix the order nodes are declared in. */
  nodes: z.array(label).max(24).optional(),
  /** `[from, to]` or `[from, to, weight]`. */
  edges: z.array(z.union([z.tuple([label, label]), z.tuple([label, label, label])])).min(1).max(40),
  /** A walk through the graph, drawn as a route. Consecutive pairs must be edges. */
  path: z.array(label).optional(),
  ...tones,
}).strict();

const gridSpec = z.object({
  type: z.literal("grid"),
  cells: z.array(z.array(label)).min(1).max(12),
  /** The cell value drawn as a solid wall. */
  wall: label.optional(),
  /** Cell value → tone, e.g. `{"1": "info"}` for land. */
  fill: z.record(z.string(), z.enum(["mark", "good", "bad", "info"])).optional(),
  /** `[row, col]` cells in order; drawn green with S and E at the ends. */
  path: z.array(z.tuple([index, index])).optional(),
  showValues: z.boolean().optional(),
}).strict();

const arraySpec = z.object({
  type: z.literal("array"),
  values: z.array(label).min(1).max(16),
  /** Inclusive `[from, to]` drawn as a shaded window. */
  window: z.tuple([index, index]).optional(),
  /** Name → index, drawn as arrows under the cells. */
  pointers: z.record(z.string().min(1).max(8), index).optional(),
  ...tones,
}).strict();

type Leaf = z.infer<typeof treeSpec> | z.infer<typeof listSpec> | z.infer<typeof graphSpec> | z.infer<typeof gridSpec> | z.infer<typeof arraySpec>;
const leafSpec = z.discriminatedUnion("type", [treeSpec, listSpec, graphSpec, gridSpec, arraySpec]);

const rowSpec = z.object({
  type: z.literal("row"),
  /** Two or three figures side by side, usually before → after. */
  items: z.array(leafSpec).min(2).max(3),
  captions: z.array(z.string().max(24)).optional(),
  /** Draw arrows between the items. Defaults to true. */
  arrows: z.boolean().optional(),
}).strict();

export const figureSpecSchema = z.union([leafSpec, rowSpec]);
export type FigureSpec = z.infer<typeof figureSpecSchema>;
export type FigureType = FigureSpec["type"];

/** Positions Graphviz gave each node, in points with y growing downward. */
export type GraphLayout = (spec: GraphSpec) => { width: number; height: number; nodes: Record<string, { x: number; y: number }> };
type GraphSpec = z.infer<typeof graphSpec>;

export type FigureCheck = { ok: true; spec: FigureSpec } | { ok: false; error: string };

/**
 * Parses a fence body and checks it means something, not just that it has the
 * right shape: indexes inside their arrays, paths along real edges, grids that
 * are rectangles. Every refusal names the field, because the reader is an agent
 * that will fix it from this sentence alone.
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
  const problem = parsed.data.type === "row" ? parsed.data.items.map(meaning).find(Boolean) : meaning(parsed.data);
  return problem ? { ok: false, error: problem } : { ok: true, spec: parsed.data };
}

function meaning(spec: Leaf): string | null {
  const within = (name: string, values: readonly number[] | undefined, size: number) =>
    values?.find((value) => value >= size) !== undefined ? `${name} has an index past the end (${size} items).` : null;
  switch (spec.type) {
    case "tree": {
      if (spec.values[0] === null) return "tree.values: the root cannot be null.";
      return within("tree.removed", spec.removed, spec.values.length) ?? within("tree.path", spec.path, spec.values.length);
    }
    case "list": {
      if (spec.cycle !== undefined && spec.cycle >= spec.values.length) return `list.cycle is ${spec.cycle} but the list has ${spec.values.length} nodes.`;
      return within("list.labels", Object.keys(spec.labels ?? {}).map(Number), spec.values.length);
    }
    case "graph": {
      const pairs = new Set(spec.edges.flatMap(([from, to]) => spec.directed ? [`${from}>${to}`] : [`${from}>${to}`, `${to}>${from}`]));
      for (let step = 0; step + 1 < (spec.path?.length ?? 0); step++) {
        const [from, to] = [spec.path![step], spec.path![step + 1]];
        if (!pairs.has(`${from}>${to}`)) return `graph.path goes ${from} → ${to}, but there is no such edge.`;
      }
      return null;
    }
    case "grid": {
      const width = spec.cells[0]!.length;
      if (spec.cells.some((row) => row.length !== width)) return "grid.cells: every row must have the same length.";
      const outside = spec.path?.find(([row, col]) => row >= spec.cells.length || col >= width);
      if (outside) return `grid.path has [${outside.join(",")}], outside a ${spec.cells.length}×${width} grid.`;
      for (let step = 1; step < (spec.path?.length ?? 0); step++) {
        const [a, b] = [spec.path![step - 1]!, spec.path![step]!];
        if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) return `grid.path jumps from [${a.join(",")}] to [${b.join(",")}]; each step must move to a neighbouring cell.`;
      }
      return null;
    }
    case "array": {
      if (spec.window && (spec.window[0] > spec.window[1] || spec.window[1] >= spec.values.length)) return `array.window [${spec.window.join(",")}] is not inside ${spec.values.length} values.`;
      return within("array.pointers", Object.values(spec.pointers ?? {}), spec.values.length);
    }
  }
}

/* ------------------------------------------------------------------ drawing - */

const R = 19;
const TONE = { none: "var(--fig-node)", mark: "var(--fig-mark)", good: "var(--fig-good)", bad: "var(--fig-bad)", info: "var(--fig-info)" } as const;
const INK = { none: "var(--fig-ink)", mark: "var(--fig-mark-ink)", good: "var(--fig-good-ink)", bad: "var(--fig-bad-ink)", info: "var(--fig-info-ink)" } as const;
type Tone = keyof typeof TONE;
type Drawn = { body: string; w: number; h: number };

const esc = (value: unknown) => String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
const n = (value: number) => Math.round(value * 10) / 10;

function text(x: number, y: number, value: unknown, { size = 13.5, fill = "var(--fig-ink)", weight = 500 } = {}) {
  return `<text x="${n(x)}" y="${n(y)}" text-anchor="middle" dominant-baseline="central" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(value)}</text>`;
}
function circle(x: number, y: number, value: unknown, tone: Tone, ghost = false) {
  return `<g${ghost ? ' opacity="0.38"' : ""}><circle cx="${n(x)}" cy="${n(y)}" r="${R}" fill="${TONE[tone]}" stroke="${INK[tone]}" stroke-width="1.6"${ghost ? ' stroke-dasharray="3.5 3"' : ""}/>${text(x, y, value, { fill: INK[tone] })}</g>`;
}
function toneOf(spec: { [tone in Exclude<Tone, "none">]?: (number | string)[] | undefined }, key: number | string): Tone {
  for (const tone of ["mark", "good", "bad", "info"] as const) if (spec[tone]?.some((entry) => String(entry) === String(key))) return tone;
  return "none";
}
const MARKERS = `<defs>${(["ink", "muted", "good-ink", "bad-ink", "info-ink"] as const).map((name) =>
  `<marker id="fig-${name}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="var(--fig-${name})"/></marker>`).join("")}</defs>`;

type TreeNode = { v: unknown; i: number; d: number; l?: TreeNode; r?: TreeNode; parent?: TreeNode; rel: number; x: number; px: number; py: number };

/**
 * A tidy tree: each subtree is laid out alone, then siblings are pushed apart
 * just far enough that their contours never come closer than one node gap. A
 * lone child sits to its own side, which is the whole reason a tree figure
 * exists — `[1,null,2]` and `[1,2]` are different trees.
 */
function drawTree(spec: z.infer<typeof treeSpec>, ox = 0, oy = 0): Drawn {
  const values = spec.values;
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
  const SEP = 46, LONE = 30;
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
  const pad = R + 3, dy = 60;
  for (const node of nodes) { node.px = ox + pad + node.x - minX; node.py = oy + pad + node.d * dy; }
  const removed = new Set(spec.removed), path = new Set(spec.path);
  let edges = "", circles = "";
  for (const node of nodes) {
    const ghost = removed.has(node.i);
    if (node.parent) {
      const p = node.parent, angle = Math.atan2(node.py - p.py, node.px - p.px), route = path.has(node.i) && path.has(p.i);
      edges += `<line x1="${n(p.px + Math.cos(angle) * R)}" y1="${n(p.py + Math.sin(angle) * R)}" x2="${n(node.px - Math.cos(angle) * R)}" y2="${n(node.py - Math.sin(angle) * R)}" stroke="${route ? "var(--fig-good-ink)" : "var(--fig-ink)"}" stroke-width="${route ? 2.6 : 1.6}"${ghost ? ' opacity="0.32" stroke-dasharray="3.5 3"' : ""}/>`;
    }
    circles += circle(node.px, node.py, node.v, ghost && toneOf(spec, node.i) === "none" ? "bad" : toneOf(spec, node.i), ghost);
  }
  return { body: edges + circles, w: pad * 2 + maxX - minX, h: pad * 2 + Math.max(...nodes.map((node) => node.d)) * dy };
}

function drawList(spec: z.infer<typeof listSpec>): Drawn {
  const bw = 42, bh = 34, gap = 36, pad = 8, top = spec.labels ? 26 : 8;
  let body = "";
  spec.values.forEach((value, k) => {
    const x = pad + k * (bw + gap), tone = toneOf(spec, k);
    body += `<rect x="${x}" y="${top}" width="${bw}" height="${bh}" rx="8" fill="${TONE[tone]}" stroke="${INK[tone]}" stroke-width="1.6"/>` + text(x + bw / 2, top + bh / 2, value, { fill: INK[tone] });
    const name = spec.labels?.[String(k)];
    if (name) body += text(x + bw / 2, top - 14, name, { size: 11, fill: "var(--fig-info-ink)", weight: 600 });
    if (k < spec.values.length - 1) body += `<line x1="${x + bw + 2}" y1="${top + bh / 2}" x2="${x + bw + gap - 3}" y2="${top + bh / 2}" stroke="var(--fig-ink)" stroke-width="1.6" marker-end="url(#fig-ink)"/>`;
    else if (spec.cycle === undefined) body += text(x + bw + 26, top + bh / 2, "null", { size: 12, fill: "var(--fig-muted)", weight: 400 });
  });
  let h = top + bh + 8;
  const w = pad * 2 + spec.values.length * (bw + gap) - gap + (spec.cycle === undefined ? 44 : 0);
  if (spec.cycle !== undefined) {
    const from = pad + (spec.values.length - 1) * (bw + gap) + bw / 2, to = pad + spec.cycle * (bw + gap) + bw / 2, y = top + bh;
    body += `<path d="M${from},${y + 1} C${from},${y + 44} ${to},${y + 44} ${to},${y + 4}" fill="none" stroke="var(--fig-bad-ink)" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#fig-bad-ink)"/>`;
    h = y + 46;
  }
  return { body, w, h };
}

function drawGraph(spec: GraphSpec, layoutGraph: GraphLayout | undefined): Drawn {
  if (!layoutGraph) throw new Error("graph figures need a layout engine");
  const ids = graphNodes(spec);
  const layout = layoutGraph(spec);
  const pad = 6;
  const pos = (id: string | number) => { const at = layout.nodes[String(id)]!; return { x: at.x + pad, y: at.y + pad }; };
  const route = new Set<string>();
  for (let step = 0; step + 1 < (spec.path?.length ?? 0); step++) {
    route.add(`${spec.path![step]}>${spec.path![step + 1]}`);
    if (!spec.directed) route.add(`${spec.path![step + 1]}>${spec.path![step]}`);
  }
  let edges = "", weights = "";
  for (const [from, to, weight] of spec.edges) {
    const p = pos(from), q = pos(to), dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy) || 1, hot = route.has(`${from}>${to}`);
    const end = R + (spec.directed ? 2 : 0);
    edges += `<line x1="${n(p.x + (dx / length) * R)}" y1="${n(p.y + (dy / length) * R)}" x2="${n(q.x - (dx / length) * end)}" y2="${n(q.y - (dy / length) * end)}" stroke="${hot ? "var(--fig-good-ink)" : "var(--fig-ink)"}" stroke-width="${hot ? 2.6 : 1.6}"${spec.directed ? ` marker-end="url(#fig-${hot ? "good-ink" : "ink"})"` : ""}/>`;
    if (weight !== undefined) {
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, wide = Math.max(22, String(weight).length * 7 + 10);
      weights += `<rect x="${n(mx - wide / 2)}" y="${n(my - 9)}" width="${wide}" height="18" rx="9" fill="var(--fig-bg)"/>` + text(mx, my, weight, { size: 11.5, fill: hot ? "var(--fig-good-ink)" : "var(--fig-muted)", weight: hot ? 650 : 500 });
    }
  }
  const circles = ids.map((id) => { const at = pos(id); return circle(at.x, at.y, id, toneOf(spec, id)); }).join("");
  return { body: edges + weights + circles, w: layout.width + pad * 2, h: layout.height + pad * 2 };
}

export function graphNodes(spec: GraphSpec): (string | number)[] {
  const seen = new Map<string, string | number>();
  for (const id of [...(spec.nodes ?? []), ...spec.edges.flatMap(([from, to]) => [from, to])]) if (!seen.has(String(id))) seen.set(String(id), id);
  return [...seen.values()];
}

/** The DOT a graph spec is laid out from. Labels are left off on purpose:
 *  Graphviz only places the nodes; Spar draws them. */
export function graphDot(spec: GraphSpec): string {
  const quote = (id: string | number) => `"${String(id).replace(/"/g, '\\"')}"`;
  const arrow = spec.directed ? "->" : "--";
  return `${spec.directed ? "digraph" : "graph"} { graph [rankdir=LR, nodesep=0.5, ranksep=0.75]; node [shape=circle, width=${(R * 2) / 72}, fixedsize=true, label=""];
  ${graphNodes(spec).map(quote).join("; ")};
  ${spec.edges.map(([from, to, weight]) => `${quote(from)} ${arrow} ${quote(to)}${weight !== undefined ? ` [label="${String(weight).replace(/"/g, "")}", fontsize=11]` : ""}`).join("; ")} }`;
}

function drawGrid(spec: z.infer<typeof gridSpec>): Drawn {
  const rows = spec.cells.length, cols = spec.cells[0]!.length, c = 36, g = 3, pad = 2;
  const route = new Set((spec.path ?? []).map(([row, col]) => `${row},${col}`));
  let body = "";
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const value = spec.cells[row]![col]!, x = pad + col * (c + g), y = pad + row * (c + g);
    const wall = spec.wall !== undefined && String(value) === String(spec.wall);
    const tone: Tone = wall ? "none" : spec.fill?.[String(value)] ?? (route.has(`${row},${col}`) ? "good" : "none");
    const bg = wall ? "var(--fig-wall)" : tone === "none" ? "var(--fig-cell)" : TONE[tone];
    body += `<rect x="${x}" y="${y}" width="${c}" height="${c}" rx="6" fill="${bg}"${tone !== "none" ? ` stroke="${INK[tone]}" stroke-opacity=".45" stroke-width="1.2"` : ""}/>`;
    if (spec.showValues !== false && !wall) body += text(x + c / 2, y + c / 2, value, { size: 12.5, fill: tone === "none" ? "var(--fig-muted)" : INK[tone] });
  }
  /* A route is its cells; its ends are named rather than drawn as a line over
     them, which read as noise on anything bigger than a few cells. */
  if (spec.showValues === false) for (const [name, at] of [["S", spec.path?.[0]], ["E", spec.path?.at(-1)]] as const) if (at) {
    body += text(pad + at[1] * (c + g) + c / 2, pad + at[0] * (c + g) + c / 2, name, { size: 12, fill: "var(--fig-good-ink)", weight: 700 });
  }
  return { body, w: pad * 2 + cols * (c + g) - g, h: pad * 2 + rows * (c + g) - g };
}

function drawArray(spec: z.infer<typeof arraySpec>): Drawn {
  const c = 38, g = 4, pad = 4, top = 4;
  const pointers = Object.entries(spec.pointers ?? {});
  let body = "";
  spec.values.forEach((value, i) => {
    const x = pad + i * (c + g), tone = toneOf(spec, i);
    const inside = spec.window ? i >= spec.window[0] && i <= spec.window[1] : false;
    const fill = tone !== "none" ? TONE[tone] : inside ? "var(--fig-info)" : "var(--fig-cell)";
    const stroke = tone !== "none" ? INK[tone] : inside ? "var(--fig-info-ink)" : "";
    body += `<rect x="${x}" y="${top}" width="${c}" height="${c}" rx="7" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="1.4"` : ""}/>`;
    body += text(x + c / 2, top + c / 2, value, { fill: tone !== "none" ? INK[tone] : "var(--fig-ink)" });
    body += text(x + c / 2, top + c + 11, i, { size: 10, fill: "var(--fig-muted)", weight: 400 });
  });
  const byIndex = new Map<number, string[]>();
  for (const [name, i] of pointers) byIndex.set(i, [...(byIndex.get(i) ?? []), name]);
  for (const [i, names] of byIndex) {
    const x = pad + i * (c + g) + c / 2;
    body += `<line x1="${x}" y1="${top + c + 40}" x2="${x}" y2="${top + c + 22}" stroke="var(--fig-info-ink)" stroke-width="1.6" marker-end="url(#fig-info-ink)"/>`;
    body += text(x, top + c + 50, names.join(", "), { size: 12, fill: "var(--fig-info-ink)", weight: 650 });
  }
  return { body, w: pad * 2 + spec.values.length * (c + g) - g, h: top + c + (pointers.length ? 60 : 18) };
}

function drawLeaf(spec: Leaf, layoutGraph: GraphLayout | undefined): Drawn {
  switch (spec.type) {
    case "tree": return drawTree(spec);
    case "list": return drawList(spec);
    case "graph": return drawGraph(spec, layoutGraph);
    case "grid": return drawGrid(spec);
    case "array": return drawArray(spec);
  }
}

function drawRow(spec: z.infer<typeof rowSpec>, layoutGraph: GraphLayout | undefined): Drawn {
  const parts = spec.items.map((item) => drawLeaf(item, layoutGraph));
  const cap = spec.captions?.length ? 24 : 0, gap = 64;
  const h = Math.max(...parts.map((part) => part.h)) + cap;
  let x = 0, body = "";
  parts.forEach((part, k) => {
    const top = cap + (h - cap - part.h) / 2;
    body += `<g transform="translate(${n(x)},${n(top)})">${part.body}</g>`;
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

/** Whether drawing this spec needs Graphviz, so a caller can skip loading it. */
export function figureNeedsLayout(spec: FigureSpec): boolean {
  return spec.type === "graph" || (spec.type === "row" && spec.items.some((item) => item.type === "graph"));
}

/** A checked spec as a standalone SVG string. Every label is escaped. */
export function renderFigure(spec: FigureSpec, layoutGraph?: GraphLayout): string {
  const drawn = spec.type === "row" ? drawRow(spec, layoutGraph) : drawLeaf(spec, layoutGraph);
  const w = Math.ceil(drawn.w), h = Math.ceil(drawn.h);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="figure-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="var(--fig-font)" role="img">${MARKERS}${drawn.body}</svg>`;
}

/** Graphviz's JSON output, read into the layout `renderFigure` wants. Shared so
 *  both processes parse it the same way. */
export function readGraphvizLayout(json: string): ReturnType<GraphLayout> {
  const out = JSON.parse(json) as { bb: string; objects?: { name: string; pos?: string }[] };
  const [, , width, height] = out.bb.split(",").map(Number) as [number, number, number, number];
  const nodes: Record<string, { x: number; y: number }> = {};
  for (const object of out.objects ?? []) {
    if (!object.pos) continue;
    const [x, y] = object.pos.split(",").map(Number) as [number, number];
    nodes[object.name] = { x, y: height - y };
  }
  return { width, height, nodes };
}
