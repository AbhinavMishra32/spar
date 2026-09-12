import { formatIn, isRef, sameValue, type HeapObject, type LineNote, type Snapshot, type Trace, type Value } from "@spar/visualizer";
import type { Language } from "@spar/domain";

/**
 * Reading a trace, for the parts of the UI that have to say something about it
 * in words rather than draw it.
 *
 * Kept out of the components because all of it is a pure function of two
 * snapshots, and because the narration is the part of this feature most likely
 * to be wrong in a way only a test catches: "what changed on this step" is
 * exactly the question a learner is using the visualiser to answer, and a
 * confident wrong answer to it is worse than no answer.
 */

/** The six identity colours, as CSS variables. Cycled rather than extended:
 *  past six simultaneous pointers the picture has stopped being legible for
 *  reasons no palette fixes. */
export const TRACE_COLORS = ["var(--trace-1)", "var(--trace-2)", "var(--trace-3)", "var(--trace-4)", "var(--trace-5)", "var(--trace-6)"] as const;

/** A variable's colour, keyed by its position in the frame rather than by its
 *  name — so `i` is the same colour for the life of a frame and does not jump
 *  when an unrelated variable comes into scope above it. */
export function colorFor(names: readonly string[], name: string): string {
  const index = names.indexOf(name);
  return TRACE_COLORS[(index < 0 ? 0 : index) % TRACE_COLORS.length] ?? TRACE_COLORS[0];
}

/** What this step is doing, in four words. The event carries most of it; the
 *  statement's grammar carries the rest, which is why the tracer sends it. */
export function describeStep(frame: Snapshot | undefined, note: LineNote | undefined): string {
  if (!frame) return "Ready when you are";
  if (frame.event === "exception") return "Exception raised";
  if (frame.event === "call") return `Enter ${frame.function}()`;
  if (frame.event === "return") return `Return from ${frame.function}()`;
  if (note?.kind === "While" || note?.kind === "If") return "Evaluate the condition";
  if (note?.kind === "For") return "Advance the loop";
  if (note?.kind === "Assign" || note?.kind === "AugAssign" || note?.kind === "AnnAssign") return "Update the state";
  return "Execute this line";
}

/** Locals whose value is not what it was on the previous step. The first frame
 *  has no previous, and on it everything is new rather than changed — reporting
 *  a whole scope as "just changed" on step one is noise, so it reports nothing. */
export function changedLocals(frame: Snapshot | undefined, previous: Snapshot | undefined): string[] {
  if (!frame || !previous) return [];
  return Object.keys(frame.locals).filter((name) => !sameValue(previous.locals[name], frame.locals[name]));
}

/** Fields of heap objects that changed, as `@n2.next → @n3`.
 *
 *  This is the one the canvas cannot show on its own: a pointer that moved is
 *  visible as a redrawn edge, but a pointer that moved *to the same shape* — the
 *  common case in a linked-list reversal — looks identical until you read it. */
export function changedFields(language: Language, frame: Snapshot | undefined, previous: Snapshot | undefined): string[] {
  if (!frame || !previous) return [];
  return Object.values(frame.heap).flatMap((object) =>
    Object.entries(object.fields ?? {})
      .filter(([field, value]) => previous.heap[object.id] && !sameValue(previous.heap[object.id]?.fields?.[field], value))
      .map(([field, value]) => `@${object.id}.${field} → ${formatIn(language, value)}`),
  );
}

/** What the canvas is mostly showing, for the label above it. Named after the
 *  structure rather than the step so it does not flicker as the trace runs. */
export function canvasSubject(frame: Snapshot | undefined): string {
  if (!frame) return "Nothing running";
  const kinds = new Set(Object.values(frame.heap).map((object) => object.kind));
  if (kinds.has("tree")) return "Binary tree";
  if (kinds.has("linked")) return "Linked list";
  if (kinds.has("dict") && kinds.has("array")) return "Data structures";
  if (kinds.has("dict")) return "Mapping";
  if (kinds.has("array")) return "Sequence";
  if (kinds.size) return "Objects";
  return "Local values";
}

/** The label a node carries: whatever the object calls its payload. Falls back
 *  to the identity, so a node with no obvious value is still identifiable. */
export function nodeLabel(language: Language, node: HeapObject): string {
  const payload = node.fields?.val ?? node.fields?.value ?? node.fields?.data;
  if (payload === undefined) return `@${node.id}`;
  const text = formatIn(language, payload);
  return text.replace(/^"|"$/g, "");
}

/** Objects worth drawing as nodes in the graph, versus as containers below it.
 *  A record with no fields — an empty `Solution()` — is neither: it is a wrapper
 *  the learner did not write and does not want to look at. */
export function partitionHeap(frame: Snapshot): { nodes: HeapObject[]; containers: HeapObject[] } {
  const objects = Object.values(frame.heap).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return {
    nodes: objects.filter((object) => object.kind === "linked" || object.kind === "tree" || (object.kind === "object" && Object.keys(object.fields ?? {}).length > 0)),
    containers: objects.filter((object) => object.kind === "array" || object.kind === "set" || object.kind === "dict"),
  };
}

/** Every local in this frame that points at something, with the object it points
 *  at. This is what turns the canvas from a picture of memory into a picture of
 *  the algorithm: the labels are the reason a reversal is legible. */
export function pointers(frame: Snapshot): Array<[string, string]> {
  return Object.entries(frame.locals).flatMap(([name, value]) => (isRef(value) ? [[name, value.ref] as [string, string]] : []));
}

/**
 * Where a trace stopped and why, in one sentence a learner can act on.
 *
 * Three different failures reach the UI looking the same, and they want
 * different responses: an exception in their code is a bug to go and read, a
 * truncated trace is an input to shrink, and a clean finish is neither. Saying
 * which is which is most of the value of the banner.
 */
export function traceVerdict(trace: Trace | null): { tone: "error" | "warning" | "none"; title: string; detail: string } {
  if (!trace) return { tone: "none", title: "", detail: "" };
  if (trace.truncated) return { tone: "warning", title: "Trace stopped at the limit", detail: trace.error ?? "The run was longer than Spar keeps. What you can see is the beginning of it." };
  if (trace.error) return { tone: "error", title: "The program raised an exception", detail: trace.error };
  return { tone: "none", title: "", detail: "" };
}

/** Values that are not references, for the scalar view. */
export function scalars(frame: Snapshot): Array<[string, Value]> {
  return Object.entries(frame.locals).filter(([, value]) => !isRef(value));
}

/** A point on the canvas, in viewBox units. */
export type Point = { x: number; y: number };

/** How far a node has been dragged from where the layout put it. */
export type Offsets = Record<string, Point>;

/**
 * The canvas frame, in viewBox units.
 *
 * It has a floor — an empty canvas should not be a sliver — and it grows in all
 * four directions rather than only right and down, because a node dragged past
 * the left edge has to still be on the canvas. That asymmetry is the bug this
 * exists to make impossible: growing only two ways looks correct until the
 * first time someone drags something up.
 */
export function canvasFrame(points: readonly Point[]): { left: number; top: number; width: number; height: number } {
  const left = Math.min(0, ...points.map((point) => point.x - 90));
  const top = Math.min(0, ...points.map((point) => point.y - 90));
  const right = Math.max(760, ...points.map((point) => point.x + 90));
  const bottom = Math.max(320, ...points.map((point) => point.y + 105));
  return { left, top, width: right - left, height: bottom - top };
}

/** The layout, plus wherever each node has since been moved to. */
export function placeNodes(positions: Record<string, Point>, offsets: Offsets): Record<string, Point> {
  const result: Record<string, Point> = {};
  for (const [id, point] of Object.entries(positions)) {
    const offset = offsets[id];
    result[id] = offset ? { x: point.x + offset.x, y: point.y + offset.y } : point;
  }
  return result;
}

/** How far a pointer has travelled, as a distance the canvas understands.
 *
 *  The conversion is the whole of it: the pointer moves in client pixels and
 *  the node lives in viewBox units, and the two are only the same when the
 *  canvas happens to be rendered at exactly its declared width. Skip the scale
 *  and a drag tracks the cursor on one pane width and drifts away from it on
 *  every other. */
export function dragTo(origin: Point, from: Point, to: Point, scale: number): Point {
  return { x: origin.x + (to.x - from.x) * scale, y: origin.y + (to.y - from.y) * scale };
}

/** Whether a pointer has travelled far enough to be a drag rather than a click
 *  with a shaky hand. Measured against where the drag started, so a slow drag
 *  is not read as a series of clicks. */
export function isDrag(origin: Point, moved: Point): boolean {
  return Math.hypot(moved.x - origin.x, moved.y - origin.y) >= 3;
}
