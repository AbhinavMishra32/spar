import { motion } from "motion/react";
import type { Language } from "@spar/domain";
import { formatIn, isRef, type HeapObject, type Snapshot, type Value } from "@spar/visualizer";
import { cn } from "@/lib/utils";
import { colorFor } from "@/lib/visualizer";

/**
 * Structures that point at each other, drawn as the shape they are.
 *
 * A tree node is a dict; a linked-list node is a dict; so is a graph vertex. A
 * figure that only knows how to draw objects draws all three as a box of
 * `"left" → None, "right" → None` — technically every fact about the node, and
 * useless for the one question the learner asked, which was what the tree looks
 * like. You cannot see a traversal in a column of key/value rows.
 *
 * So links are followed instead of printed. Any value in an object that is a
 * reference to another object stops being a row and becomes an edge, labelled
 * with the field it came from, and the objects it reaches are laid out by depth.
 * What is left inside a node — the payload — is what a person would write in the
 * circle if they drew it on paper.
 *
 * The layout is a tidy tree: leaves take the next free column, a parent centres
 * over its children, depth is the row. It is not general graph layout and does
 * not pretend to be — a cycle is followed once and then drawn as an edge back to
 * a node already placed, which is exactly how a person draws a cycle too.
 */

const NODE_W = 68;
const NODE_H = 46;
const COL_GAP = 20;
const ROW_GAP = 40;
const MAX_NODES = 40;

export type GraphNode = {
  id: string;
  depth: number;
  x: number;
  y: number;
  names: string[];
  label: string;
  type: string;
  object: HeapObject;
};
export type GraphEdge = { key: string; from: string; to: string; label: string; back: boolean };
export type GraphLayout = { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number; truncated: boolean };

/** Every reference out of an object, with the name it was reached by: a dict
 *  key, a field, or a list index. This is the whole definition of an edge. */
export function linksOf(language: Language, object: HeapObject): { label: string; ref: string }[] {
  const out: { label: string; ref: string }[] = [];
  const take = (label: string, value: Value) => { if (isRef(value)) out.push({ label, ref: value.ref }); };
  for (const [key, value] of object.entries ?? []) take(formatIn(language, key).replace(/^["']|["']$/g, ""), value);
  for (const [field, value] of Object.entries(object.fields ?? {})) take(field, value);
  (object.items ?? []).forEach((value, index) => take(String(index), value));
  return out;
}

/** What goes inside the node. The payload keys a learner would actually write:
 *  the value the node carries, not its wiring. */
/** Whether nothing in the structure branches — a list, a chain, a path. */
function nodes_branchless(children: Map<string, string[]>, placed: Set<string>): boolean {
  let links = 0;
  for (const id of placed) {
    const kids = children.get(id) ?? [];
    if (kids.length > 1) return false;
    links += kids.length;
  }
  return links >= 2;
}

function labelOf(language: Language, object: HeapObject): string {
  const scalars: [string, Value][] = [
    ...(object.entries ?? []).map(([key, value]) => [formatIn(language, key).replace(/^["']|["']$/g, ""), value] as [string, Value]),
    ...Object.entries(object.fields ?? {}),
  ].filter(([, value]) => !isRef(value));
  const preferred = ["value", "val", "data", "key", "item", "char", "name", "id"];
  const picked = scalars.find(([key]) => preferred.includes(key.toLowerCase())) ?? scalars[0];
  /* Unquoted inside the node. A tree of `"A"`, `"B"`, `"C"` reads as a tree of
     quote marks; on a node the string-ness is not the point, the letter is. */
  if (picked) return formatIn(language, picked[1]).replace(/^["'](.*)["']$/s, "$1");
  const inline = (object.items ?? []).filter((value) => !isRef(value));
  return inline.length ? inline.map((value) => formatIn(language, value)).join(", ").slice(0, 12) : `@${object.id}`;
}

/**
 * The linked structure reachable from these objects, laid out — or nothing.
 *
 * Returning nothing is the common case and the important one: most frames have
 * no pointers in them at all, and a figure that forced every list into a graph
 * would be worse than the boxes it replaced. Two connected nodes is the
 * threshold, because one node with no edges is just an object.
 */
export function layoutLinked(language: Language, frame: Snapshot, ids: readonly string[]): GraphLayout | null {
  /* Reach everything first, so a root handed in halfway down a list still draws
     the part below it, and so "is there a structure here" is answered by the
     whole reachable set rather than by the one object that was named. */
  const reached = new Map<string, HeapObject>();
  const queue = [...ids];
  let truncated = false;
  while (queue.length) {
    const id = queue.shift();
    if (!id || reached.has(id)) continue;
    const object = frame.heap[id];
    if (!object) continue;
    if (reached.size >= MAX_NODES) { truncated = true; break; }
    reached.set(id, object);
    for (const link of linksOf(language, object)) queue.push(link.ref);
  }
  const edges: GraphEdge[] = [];
  for (const [id, object] of reached) {
    for (const link of linksOf(language, object)) {
      if (reached.has(link.ref)) edges.push({ key: `${id}->${link.ref}:${link.label}`, from: id, to: link.ref, label: link.label, back: false });
    }
  }
  if (edges.length === 0 || reached.size < 2) return null;

  /* Only what is wired into the picture. An array of scalars reached from the
     same frame is not part of the structure, and drawing it as a node with no
     edges puts a box of commas next to the tree and shoves the tree off centre.
     It is dropped here and drawn as the card it is. */
  const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  for (const id of [...reached.keys()]) if (!connected.has(id)) reached.delete(id);

  /* Roots are what nothing points at. A structure that is all cycle has none, so
     the first object named falls back to being the root — a ring has to be drawn
     starting somewhere, and where the agent pointed is the honest choice. */
  const targeted = new Set(edges.map((edge) => edge.to));
  const roots = [...reached.keys()].filter((id) => !targeted.has(id));
  const starts = roots.length ? roots : [ids.find((id) => reached.has(id)) ?? [...reached.keys()][0]!];
  if (!starts.length) return null;

  const depth = new Map<string, number>();
  const children = new Map<string, string[]>();
  const placed = new Set<string>();
  const walk = (id: string, level: number) => {
    if (placed.has(id)) return;
    placed.add(id);
    depth.set(id, level);
    const kids = edges.filter((edge) => edge.from === id && !placed.has(edge.to)).map((edge) => edge.to);
    children.set(id, kids);
    for (const kid of kids) walk(kid, level + 1);
  };
  for (const start of starts) walk(start, 0);
  // Anything the walk never reached (a node only inside a cycle) still gets a row.
  for (const id of reached.keys()) if (!placed.has(id)) walk(id, 0);
  /* An edge to a node already placed is drawn differently — it is the cycle, the
     back-pointer, the second parent — and saying so is most of what makes a
     doubly linked list readable. */
  for (const edge of edges) edge.back = (depth.get(edge.to) ?? 0) <= (depth.get(edge.from) ?? 0);

  /**
   * A chain is drawn along the page, not down it.
   *
   * Depth is the right axis for a tree and the wrong one for a linked list: ten
   * nodes of `next` become a column ten rows tall inside a card that is four
   * rows high, and the whole thing shrinks to nothing to fit. Nobody draws a
   * linked list downwards either. So a structure where nothing branches is laid
   * out left to right, and the same code does both by swapping which of the two
   * coordinates depth feeds.
   */
  const chain = nodes_branchless(children, placed);

  let column = 0;
  const x = new Map<string, number>();
  const assign = (id: string): number => {
    const kids = children.get(id) ?? [];
    if (!kids.length) { const own = column; column += 1; x.set(id, own); return own; }
    const spans = kids.map(assign);
    const centre = (Math.min(...spans) + Math.max(...spans)) / 2;
    x.set(id, centre);
    return centre;
  };
  for (const id of [...placed].filter((id) => (depth.get(id) ?? 0) === 0)) assign(id);
  for (const id of placed) if (!x.has(id)) x.set(id, column++);

  const nodes: GraphNode[] = [...placed].map((id) => {
    const object = reached.get(id)!;
    const level = depth.get(id) ?? 0;
    const slot = x.get(id) ?? 0;
    return {
      id,
      depth: level,
      x: chain ? level * (NODE_W + COL_GAP + 18) : slot * (NODE_W + COL_GAP),
      y: chain ? slot * (NODE_H + ROW_GAP) : level * (NODE_H + ROW_GAP),
      names: Object.entries(frame.locals).flatMap(([name, value]) => (isRef(value) && value.ref === id ? [name] : [])),
      label: labelOf(language, object),
      type: object.type,
      object,
    };
  });
  return {
    nodes,
    edges,
    width: Math.max(...nodes.map((node) => node.x)) + NODE_W,
    height: Math.max(...nodes.map((node) => node.y)) + NODE_H,
    truncated,
  };
}

/**
 * The structure, drawn.
 *
 * Absolute positions inside a box of known size, which is safe here and was not
 * safe in the debugger's canvas: nothing is dragged, nothing enters or leaves
 * with an animation, and the size is computed from the layout rather than from
 * the room available. The card scales the whole thing to fit.
 */
export function TraceGraph({ changed, layout, names }: {
  changed: ReadonlySet<string>;
  layout: GraphLayout;
  names: string[];
}) {
  return (
    <div className="relative" style={{ height: layout.height, width: layout.width }}>
      <svg className="absolute inset-0 overflow-visible" height={layout.height} width={layout.width}>
        {layout.edges.map((edge) => {
          const from = layout.nodes.find((node) => node.id === edge.from);
          const to = layout.nodes.find((node) => node.id === edge.to);
          if (!from || !to) return null;
          /* An edge leaves the side its child is on. Down for a tree, across for
             a chain — the same rule, read off the layout rather than assumed. */
          const across = to.x !== from.x && to.y === from.y;
          const x1 = across ? from.x + NODE_W : from.x + NODE_W / 2;
          const y1 = across ? from.y + NODE_H / 2 : from.y + NODE_H;
          const x2 = across ? to.x : to.x + NODE_W / 2;
          const y2 = across ? to.y + NODE_H / 2 : to.y;
          const mid = across ? (x1 + x2) / 2 : (y1 + y2) / 2;
          return (
            <g key={edge.key}>
              <motion.path
                animate={{ pathLength: 1, opacity: 1 }}
                d={edge.back
                  /* A back edge arcs clear of the rows rather than cutting
                     through the nodes between its ends. */
                  ? `M ${x1} ${from.y + NODE_H / 2} C ${x1 + 60} ${from.y - 34}, ${x2 - 60} ${to.y - 34}, ${x2} ${to.y + NODE_H / 2}`
                  : across
                    ? `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
                    : `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
                fill="none"
                initial={{ pathLength: 0, opacity: 0 }}
                stroke="var(--transcript-step-mark)"
                strokeDasharray={edge.back ? "3 3" : undefined}
                strokeWidth={1.25}
                transition={{ duration: 0.35, ease: "easeOut" }}
              />
              {/* Unlabelled when the label is a list index, which the position
                  already says, and labelled when it is `left`, `next`, `parent`
                  — the words the learner is reasoning in. */}
              {!/^\d+$/.test(edge.label) && !edge.back && (
                <text
                  className="fill-[var(--transcript-step-mark)] font-mono"
                  fontSize="9"
                  textAnchor="middle"
                  /* Anchored at the child end rather than the parent's. Both
                     labels crowd into the same inch under a parent; at the
                     child they are as far apart as the children are, which is
                     also where you look to ask which branch this was. */
                  x={across ? mid : x2 + (x2 === x1 ? 0 : x2 > x1 ? -16 : 16)}
                  y={across ? y1 - 7 : y2 - 8}
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {layout.nodes.map((node) => (
        <Node changed={changed.has(node.id)} key={node.id} names={names} node={node} />
      ))}
    </div>
  );
}

function Node({ changed, names, node }: { changed: boolean; names: string[]; node: GraphNode }) {
  return (
    <motion.div
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "absolute flex flex-col items-center justify-center rounded-xl border bg-card transition-colors duration-300",
        changed ? "border-[var(--trace-change)]/60" : "border-border",
      )}
      initial={{ opacity: 0, scale: 0.92 }}
      style={{ height: NODE_H, left: node.x, top: node.y, width: NODE_W }}
      transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
    >
      <span className={cn("font-mono text-thread tabular-nums", changed ? "text-[var(--trace-change)]" : "text-foreground")}>
        {node.label}
      </span>
      {/* The name a local gives this node rides on the node, because "we are at
          `node` now" is the sentence the caption is usually making. */}
      {node.names.length > 0 && (
        <span className="absolute -top-2 flex gap-1 rounded-full bg-card px-1.5 font-mono text-[0.65rem]">
          {node.names.slice(0, 2).map((name) => (
            <span key={name} style={{ color: colorFor(names, name) }}>{name}</span>
          ))}
        </span>
      )}
    </motion.div>
  );
}
