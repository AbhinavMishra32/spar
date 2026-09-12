import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import type { Language } from "@spar/domain";
import { formatIn, isRef, sameValue, type HeapObject, type Snapshot } from "@spar/visualizer";
import { cn } from "@/lib/utils";
import { canvasFrame, colorFor, dragTo, isDrag, nodeLabel, partitionHeap, placeNodes, pointers, scalars } from "@/lib/visualizer";

/**
 * The picture.
 *
 * Its whole job is to make one claim true: *the thing on screen is the same
 * thing it was a step ago.* Every design decision here follows from that.
 *
 * Node positions are a pure function of the snapshot, so a node that survives a
 * step is laid out at the same place and the animation between snapshots is a
 * real transition rather than a redraw. Motion keys are object identities from
 * the tracer, never array indices — key a node by its position in a list and
 * every insertion makes the whole list flash, which reads as "everything
 * changed" on precisely the step where one pointer moved.
 *
 * What is drawn in colour is deliberately narrow. Spar is a monochrome app and
 * the visualiser does not get an exemption: the six identity hues appear as a
 * pointer label and its stem, and one warm accent marks what changed on this
 * step. Nodes, edges, cells and containers are all drawn in the app's own greys,
 * so the colour on screen means *variable* and *change* and nothing else. A
 * canvas where the boxes are also coloured is a canvas where the pointer labels
 * have stopped standing out, and the pointer labels are the algorithm.
 *
 * Nodes can be dragged. The layout is a good default and a bad answer to "these
 * two crossing edges are the thing I am trying to see" — so a drag records an
 * *offset* from the computed position rather than replacing it. Everything
 * anchored to a node is derived from one position map, which is what makes the
 * edges, their field labels and the pointer chips follow a dragged node without
 * any of them knowing a drag happened. Offsets survive stepping, because an
 * arrangement someone built to watch a reversal is worth exactly as much on the
 * next step as on this one.
 */

const NODE_RADIUS = 29;
const LEVEL_HEIGHT = 115;

export function StructureCanvas({
  frame,
  previous,
  language,
  selected,
  onSelect,
  zoom,
  memory,
  speed,
}: {
  frame: Snapshot;
  previous: Snapshot | undefined;
  language: Language;
  selected: string | null;
  onSelect(id: string | null): void;
  zoom: number;
  /** Memory view: every object, with its type and identity, laid out flat.
   *  The escape hatch for when the structural drawing is not what you need. */
  memory: boolean;
  speed: number;
}) {
  const reduced = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  /* Offsets, not positions. A node the learner moved keeps its relationship to
     a layout that is still free to change underneath it — a tree that gains a
     level does not strand every node someone has already arranged. */
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef<{ id: string; fromX: number; fromY: number; originX: number; originY: number; moved: boolean } | null>(null);
  /* A drag ends with a click on the node, and a click selects it. This is the
     one bit of state that stops "I moved that" from also meaning "I opened
     that" in the inspector. */
  const dragged = useRef(false);
  const { nodes, containers } = useMemo(() => partitionHeap(frame), [frame]);
  const refs = useMemo(() => pointers(frame), [frame]);
  const names = useMemo(() => Object.keys(frame.locals), [frame.locals]);

  /**
   * Layout.
   *
   * A tree is laid out as a tree — halving the horizontal spread each level, so
   * a deep tree narrows instead of running off the canvas. Everything else goes
   * on a grid, which is honest: for a heap of unrelated objects there is no
   * meaningful geometry, and inventing one (a force layout, say) would imply a
   * relationship the program does not have and would move nodes between steps
   * for reasons the learner cannot see.
   */
  const positions = useMemo(() => {
    const result: Record<string, { x: number; y: number }> = {};
    const trees = nodes.filter((node) => node.kind === "tree");
    if (trees.length && trees.length === nodes.length) {
      const children = new Set(trees.flatMap((node) => Object.values(node.fields ?? {}).filter(isRef).map((value) => value.ref)));
      const roots = trees.filter((node) => !children.has(node.id));
      const seen = new Set<string>();
      const visit = (id: string, x: number, y: number, spread: number) => {
        if (seen.has(id) || !frame.heap[id]) return;
        seen.add(id);
        result[id] = { x, y };
        const fields = frame.heap[id]?.fields;
        if (isRef(fields?.left)) visit(fields.left.ref, x - spread, y + LEVEL_HEIGHT, spread / 2);
        if (isRef(fields?.right)) visit(fields.right.ref, x + spread, y + LEVEL_HEIGHT, spread / 2);
      };
      roots.forEach((node, index) => visit(node.id, 380 + index * 760, 110, 165));
      // Detached nodes still exist and the learner may be holding one. They go
      // on a row of their own rather than being dropped — a node that vanished
      // because nothing points at it any more is the exact bug a visualiser is
      // supposed to reveal.
      trees.filter((node) => !seen.has(node.id)).forEach((node, index) => visit(node.id, 90 + index * 115, 470, 60));
    } else {
      nodes.forEach((node, index) => {
        result[node.id] = { x: 85 + (index % 6) * 120, y: 170 + Math.floor(index / 6) * 170 };
      });
    }
    return result;
  }, [frame, nodes]);

  /** Where each node actually is: the layout, plus wherever it has been moved
   *  to. Every anchored thing on the canvas reads this and nothing reads the
   *  raw layout, which is the whole of "the arrows follow". */
  const placed = useMemo(() => placeNodes(positions, offsets), [positions, offsets]);

  /* The frame grows to hold whatever has been dragged out of it, in every
     direction — dragging a node off the left edge and losing it would make the
     canvas feel like it had eaten something. */
  const { left, top, width, height } = useMemo(() => canvasFrame(Object.values(placed)), [placed]);

  /** Client pixels to viewBox units. Read from the rendered box rather than
   *  computed, so the page zoom and the pane's width are both already in it. */
  const unit = useCallback(() => {
    const box = svg.current?.getBoundingClientRect();
    return box && box.width ? width / box.width : 1;
  }, [width]);

  const startDrag = useCallback((id: string) => (event: React.PointerEvent<SVGGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = offsets[id] ?? { x: 0, y: 0 };
    drag.current = { id, fromX: event.clientX, fromY: event.clientY, originX: current.x, originY: current.y, moved: false };
    setDragging(id);
  }, [offsets]);

  const moveDrag = useCallback((event: React.PointerEvent<SVGGElement>) => {
    const active = drag.current;
    if (!active) return;
    const origin = { x: active.originX, y: active.originY };
    const next = dragTo(origin, { x: active.fromX, y: active.fromY }, { x: event.clientX, y: event.clientY }, unit());
    if (!active.moved && !isDrag(origin, next)) return;
    active.moved = true;
    setOffsets((current) => ({ ...current, [active.id]: next }));
  }, [unit]);

  const endDrag = useCallback((event: React.PointerEvent<SVGGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragged.current = drag.current?.moved ?? false;
    drag.current = null;
    setDragging(null);
  }, []);

  /** Nothing anchored to a node moves under motion's easing while a pointer is
   *  holding it: an eased drag lags the cursor and reads as broken. Spread
   *  rather than passed, so a node that is *not* being dragged inherits the
   *  page's transition instead of being handed an empty one. */
  const live = useCallback(
    (...ids: Array<string | undefined>) => (dragging !== null && ids.includes(dragging) ? { transition: { duration: 0 } } : {}),
    [dragging],
  );
  const rearranged = Object.keys(offsets).length > 0;

  /* An adjacency list is a graph, and drawing it as a dictionary of arrays
     throws that away. Recognised structurally — a mapping whose every value is
     a flat array of scalars — rather than by name. */
  const graph = useMemo(() => containers.find((object) =>
    object.kind === "dict" &&
    (object.entries?.length ?? 0) > 0 &&
    object.entries!.every(([key, value]) => !isRef(key) && isRef(value) && frame.heap[value.ref]?.kind === "array" && frame.heap[value.ref]?.items?.every((item) => !isRef(item))),
  ), [containers, frame.heap]);

  const empty = nodes.length === 0 && containers.length === 0;

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: reduced ? 0 : 0.6 / speed, ease: [0.32, 0.72, 0, 1] }}>
      <div className="min-w-fit p-5" style={{ zoom }}>
        {/* Only once something has been moved. An arrangement is the learner's
            and Spar does not throw it away on its own — not on the next step,
            not on the next run — so the way back has to be theirs too. */}
        {rearranged && nodes.length > 0 && (
          <div className="sticky top-0 z-10 -mt-1 mb-1 flex justify-end">
            <button
              className="rounded-full border border-border bg-popover px-2.5 py-1 text-ui-sm text-muted-foreground shadow-[var(--app-shadow-overlay)] transition-colors hover:text-foreground"
              onClick={() => setOffsets({})}
              type="button"
            >
              Reset layout
            </button>
          </div>
        )}

        {nodes.length > 0 && (
          <svg
            aria-label="Objects, the references between them, and what changed on this step"
            className="w-full"
            role="img"
            ref={svg}
            style={{ minWidth: Math.min(width, 760), maxWidth: width, touchAction: "none" }}
            viewBox={`${left} ${top} ${width} ${height}`}
          >
            <defs>
              <marker id="viz-arrow" markerHeight="6" markerWidth="6" orient="auto-start-reverse" refX="9" refY="5" viewBox="0 0 10 10">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--trace-edge)" />
              </marker>
              <marker id="viz-arrow-changed" markerHeight="6" markerWidth="6" orient="auto-start-reverse" refX="9" refY="5" viewBox="0 0 10 10">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--trace-change)" />
              </marker>
            </defs>

            <AnimatePresence initial={false}>
              {nodes.flatMap((node) =>
                Object.entries(node.fields ?? {})
                  .filter(([, value]) => isRef(value) && placed[value.ref])
                  .map(([field, value]) => {
                    const target = (value as { ref: string }).ref;
                    const from = placed[node.id];
                    const to = placed[target];
                    if (!from || !to) return null;
                    const changed = Boolean(previous) && !sameValue(previous?.heap[node.id]?.fields?.[field], value);
                    const isTree = node.kind === "tree";
                    const straight = !isTree && to.x > from.x && to.y === from.y;
                    const path = isTree
                      ? `M ${from.x} ${from.y + 27} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y - 30}`
                      : straight
                        ? `M ${from.x + 31} ${from.y} C ${from.x + 55} ${from.y}, ${to.x - 55} ${to.y}, ${to.x - 34} ${to.y}`
                        : `M ${from.x} ${from.y + 29} C ${from.x} ${from.y + 95}, ${to.x} ${to.y + 95}, ${to.x} ${to.y + 32}`;
                    const labelX = isTree ? (from.x + to.x) / 2 + 12 : (from.x + to.x) / 2;
                    const labelY = isTree ? (from.y + to.y) / 2 : straight ? from.y - 13 : Math.max(from.y, to.y) + 75;
                    return (
                      <motion.g animate={{ opacity: 1 }} exit={{ opacity: 0 }} initial={{ opacity: 0 }} key={`${node.id}-${field}`}>
                        <motion.path
                          animate={{ d: path }}
                          fill="none"
                          initial={false}
                          markerEnd={`url(#${changed ? "viz-arrow-changed" : "viz-arrow"})`}
                          stroke={changed ? "var(--trace-change)" : "var(--trace-edge)"}
                          strokeWidth={changed ? 1.75 : 1.25}
                          {...live(node.id, target)}
                        />
                        <motion.text
                          animate={{ x: labelX, y: labelY }}
                          className="fill-muted-foreground font-mono"
                          fontSize={10.5}
                          initial={false}
                          textAnchor="middle"
                          {...live(node.id, target)}
                          x={labelX}
                          y={labelY}
                        >
                          {field}
                        </motion.text>
                      </motion.g>
                    );
                  }),
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {nodes.map((node) => {
                const point = placed[node.id];
                if (!point) return null;
                const changed = Boolean(previous) && !sameValue(previous?.heap[node.id], node);
                return (
                  <motion.g
                    animate={{ x: point.x, y: point.y, opacity: 1, scale: 1 }}
                    aria-label={`Inspect or move ${node.type} ${nodeLabel(language, node)}`}
                    className={cn("outline-none", dragging === node.id ? "cursor-grabbing" : "cursor-grab")}
                    exit={{ opacity: 0, scale: 0.85 }}
                    initial={{ x: point.x, y: point.y, opacity: 0, scale: 0.85 }}
                    key={node.id}
                    onClick={() => {
                      // Suppressed once after a real drag, so putting a node
                      // somewhere does not also open it in the inspector.
                      if (dragged.current) { dragged.current = false; return; }
                      onSelect(node.id === selected ? null : node.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id === selected ? null : node.id); }
                    }}
                    onPointerCancel={endDrag}
                    onPointerDown={startDrag(node.id)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    role="button"
                    tabIndex={0}
                    {...live(node.id)}
                  >
                    <rect
                      fill="var(--trace-node)"
                      height={NODE_RADIUS * 2}
                      rx={14}
                      stroke={selected === node.id ? "var(--foreground)" : changed ? "var(--trace-change)" : "var(--border-strong)"}
                      strokeWidth={selected === node.id || changed ? 1.5 : 1}
                      width={NODE_RADIUS * 2}
                      x={-NODE_RADIUS}
                      y={-NODE_RADIUS}
                    />
                    <text className="fill-foreground font-mono" fontSize={13} textAnchor="middle" y={5}>
                      {nodeLabel(language, node).slice(0, 7)}
                    </text>
                    <text className="fill-muted-foreground font-mono" fontSize={9.5} textAnchor="middle" y={46}>
                      {memory ? `${node.type} @${node.id}` : `@${node.id}`}
                    </text>
                    {/* A chain that ends is drawn ending. Without this, the last
                        node looks identical to a node whose next has not been
                        set yet, which is the difference between a finished
                        reversal and a lost tail. */}
                    {node.kind === "linked" && node.fields?.next === null && (
                      <g>
                        <path d="M 31 0 L 52 0" stroke="var(--trace-edge)" strokeWidth={1.25} />
                        <text className="fill-muted-foreground font-mono" fontSize={12} x={58} y={4}>&empty;</text>
                      </g>
                    )}
                  </motion.g>
                );
              })}
            </AnimatePresence>

            {/* Pointer labels. The one thing on this canvas that carries an
                identity colour, because they are the only thing whose identity
                the learner is tracking across steps. Stacked in lanes when
                several names point at one node, which is exactly the moment a
                two-pointer algorithm gets interesting. */}
            <AnimatePresence initial={false}>
              {refs.filter(([, ref]) => placed[ref]).map(([name, ref]) => {
                const point = placed[ref]!;
                const lane = refs.filter(([, target]) => target === ref).findIndex(([key]) => key === name);
                const color = colorFor(names, name);
                const y = point.y - 54 - lane * 23;
                const width = Math.max(46, name.length * 7.4 + 16);
                return (
                  <motion.g
                    animate={{ x: point.x, y, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    /* Keyed by the call stack as well as the name: `node` in a
                       recursive frame is a different pointer from `node` in its
                       parent, and animating between them would draw one label
                       sliding down the tree as the recursion descends. */
                    key={`${frame.stack.map((entry) => entry.name).join("/")}:${name}`}
                    initial={{ x: point.x, y, opacity: 0 }}
                    {...live(ref)}
                  >
                    <rect fill={color} fillOpacity={0.14} height={21} rx={5} width={width} x={-width / 2} y={-13} />
                    <text fill={color} fontSize={11} fontWeight={500} textAnchor="middle" y={2}>{name}</text>
                    {lane === 0 && <path d="M 0 9 L 0 21" stroke={color} strokeDasharray="2 3" />}
                  </motion.g>
                );
              })}
            </AnimatePresence>
          </svg>
        )}

        {graph && !memory && <AdjacencyGraph frame={frame} graph={graph} language={language} names={names} />}

        <div className="mt-4 flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {containers
              .filter((object) => memory || !graph || (object.id !== graph.id && refs.some(([, ref]) => ref === object.id)))
              .map((object) => (
                <Container
                  key={object.id}
                  language={language}
                  names={refs.filter(([, ref]) => ref === object.id).map(([name]) => name)}
                  object={object}
                  onSelect={onSelect}
                  previous={previous}
                  selected={selected}
                  variables={Object.keys(frame.locals)}
                />
              ))}
          </AnimatePresence>
        </div>

        {/* No objects at all is not an empty canvas — a loop over integers is a
            real algorithm and its state is worth drawing. */}
        {empty && (
          <div>
            <p className="text-ui-sm font-medium uppercase tracking-[0.08em] text-muted-foreground">Local values</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {scalars(frame).map(([name, value]) => (
                <div className="min-w-24 rounded-xl border border-border bg-card px-3 py-2 shadow-[var(--app-shadow-card)]" key={name}>
                  <div className="flex items-center gap-1.5">
                    <span aria-hidden className="size-1.5 rounded-full" style={{ background: colorFor(names, name) }} />
                    <span className="font-mono text-ui-sm text-muted-foreground">{name}</span>
                  </div>
                  <p className="mt-0.5 font-mono text-[0.95rem] tabular-nums">{formatIn(language, value)}</p>
                </div>
              ))}
              {!scalars(frame).length && <p className="text-ui text-muted-foreground">Nothing is in scope on this step yet.</p>}
            </div>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

/** A list, set or mapping, drawn as cells. Indices are shown under a sequence
 *  and not under a set, because a set has none and implying otherwise is a
 *  lie the learner will act on. */
function Container({ object, previous, language, names, variables, selected, onSelect }: {
  object: HeapObject;
  previous: Snapshot | undefined;
  language: Language;
  names: string[];
  variables: string[];
  selected: string | null;
  onSelect(id: string | null): void;
}) {
  const ordered = object.kind !== "set";
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "cursor-pointer rounded-xl border bg-card px-3.5 py-3 shadow-[var(--app-shadow-card)] transition-colors",
        selected === object.id ? "border-border-strong" : "border-border hover:border-border-strong",
      )}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: 10 }}
      key={object.id}
      layout
      onClick={() => onSelect(object.id === selected ? null : object.id)}
      onKeyDown={(event) => { if (event.key === "Enter") onSelect(object.id === selected ? null : object.id); }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center gap-2">
        {names.length ? (
          <span className="flex items-center gap-1.5">
            {names.map((name) => (
              <span className="flex items-center gap-1 font-mono text-ui font-medium" key={name}>
                <span aria-hidden className="size-1.5 rounded-full" style={{ background: colorFor(variables, name) }} />
                {name}
              </span>
            ))}
          </span>
        ) : (
          <span className="font-mono text-ui text-muted-foreground">@{object.id}</span>
        )}
        <span className="ml-auto font-mono text-ui-sm text-muted-foreground">{object.type}</span>
      </div>

      {object.items && (
        <div className="mt-2 flex flex-wrap gap-1">
          <AnimatePresence initial={false}>
            {object.items.map((item, index) => {
              const changed = Boolean(previous) && !sameValue(previous?.heap[object.id]?.items?.[index], item);
              return (
                <motion.div animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center" exit={{ opacity: 0, scale: 0.8 }} initial={{ opacity: 0, scale: 0.8 }} key={index} layout>
                  <div
                    className={cn(
                      "flex h-8 min-w-9 items-center justify-center rounded-md border px-2 font-mono text-ui tabular-nums",
                      changed ? "border-[var(--trace-change)] text-foreground" : "border-border text-foreground",
                    )}
                  >
                    {formatIn(language, item)}
                  </div>
                  {ordered && <span className="mt-0.5 font-mono text-[0.6rem] text-muted-foreground">{index}</span>}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {!object.items.length && <span className="text-ui text-muted-foreground">empty {object.type}</span>}
        </div>
      )}

      {object.entries && (
        <div className="mt-2 flex flex-col gap-0.5">
          {object.entries.map(([key, value], index) => {
            const changed = Boolean(previous) && !sameValue(previous?.heap[object.id]?.entries?.[index], [key, value]);
            return (
              <div className="flex items-center gap-2 font-mono text-ui" key={index}>
                <span className="text-muted-foreground">{formatIn(language, key)}</span>
                <span aria-hidden className="text-muted-foreground">&rarr;</span>
                <span className={cn("tabular-nums", changed && "text-[var(--trace-change)]")}>{formatIn(language, value)}</span>
              </div>
            );
          })}
          {!object.entries.length && <span className="text-ui text-muted-foreground">empty {object.type}</span>}
        </div>
      )}

      {object.truncated && <p className="mt-1.5 text-ui-sm text-muted-foreground">Showing the first 80 items.</p>}
    </motion.div>
  );
}

/** An adjacency list as the graph it is. Laid out on a circle: no layout is
 *  right for an arbitrary graph, and a circle at least keeps every vertex
 *  visible and every edge straight. */
function AdjacencyGraph({ graph, frame, language, names }: { graph: HeapObject; frame: Snapshot; language: Language; names: string[] }) {
  const entries = graph.entries ?? [];
  const keys = [...new Set(entries.flatMap(([key, value]) => [
    formatIn(language, key),
    ...(isRef(value) ? (frame.heap[value.ref]?.items ?? []).map((item) => formatIn(language, item)) : []),
  ]))];
  const at = (key: string) => {
    const angle = (keys.indexOf(key) / Math.max(1, keys.length)) * Math.PI * 2 - Math.PI / 2;
    return { x: 380 + Math.cos(angle) * 150, y: 190 + Math.sin(angle) * 135 };
  };
  return (
    <svg aria-label="The adjacency list, drawn as a directed graph" className="w-full" role="img" viewBox="0 0 760 380">
      <defs>
        <marker id="viz-graph-arrow" markerHeight="6" markerWidth="6" orient="auto" refX="9" refY="5" viewBox="0 0 10 10">
          <path d="M0 0L10 5L0 10z" fill="var(--trace-edge)" />
        </marker>
      </defs>
      {entries.flatMap(([key, value]) =>
        isRef(value)
          ? (frame.heap[value.ref]?.items ?? []).map((neighbour, index) => {
              const from = at(formatIn(language, key));
              const to = at(formatIn(language, neighbour));
              const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
              return (
                <path
                  d={`M${from.x + ((to.x - from.x) * 28) / distance} ${from.y + ((to.y - from.y) * 28) / distance} L${to.x - ((to.x - from.x) * 32) / distance} ${to.y - ((to.y - from.y) * 32) / distance}`}
                  fill="none"
                  key={`${formatIn(language, key)}-${index}`}
                  markerEnd="url(#viz-graph-arrow)"
                  stroke="var(--trace-edge)"
                  strokeWidth={1.25}
                />
              );
            })
          : [],
      )}
      {keys.map((key) => {
        const point = at(key);
        const here = Object.entries(frame.locals).filter(([, value]) => !isRef(value) && formatIn(language, value) === key);
        return (
          <g key={key} transform={`translate(${point.x},${point.y})`}>
            <circle
              fill="var(--trace-node)"
              r={26}
              stroke={here.length ? "var(--trace-change)" : "var(--border-strong)"}
              strokeWidth={here.length ? 1.5 : 1}
            />
            <text className="fill-foreground font-mono" fontSize={12} textAnchor="middle" y={5}>{key.replaceAll('"', "")}</text>
            {here.length > 0 && (
              <text fill={colorFor(names, here[0]![0])} fontSize={11} fontWeight={500} textAnchor="middle" y={-38}>
                {here.map(([name]) => name).join(", ")}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
