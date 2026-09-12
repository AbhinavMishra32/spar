import { z } from "zod";

/**
 * What one execution looks like, in a shape no language owns.
 *
 * This is the contract between a tracer and the canvas, and it is deliberately
 * poorer than any single runtime's object model. A tracer's job is to flatten
 * whatever its language calls a value into four things the canvas knows how to
 * draw — a scalar, a sequence, a mapping, or a record of named fields — and to
 * hand back a stable identity for anything that has one. Everything the canvas
 * does downstream (drawing a linked list as a chain, holding a node still while
 * the pointer beside it moves, colouring the field that changed this step) is
 * built on those identities and nothing else.
 *
 * The consequence worth stating: a second language is a second tracer emitting
 * this, not a second canvas. `kind` is the only place a runtime's vocabulary
 * shows through, and the values it can take are drawing instructions rather than
 * type names — Python's `dict`, a JS `Map` and a Go map are all `"dict"` here
 * because they are all a column of key/value rows on screen.
 */

/** A reference to something on the heap. The one indirection in the model. */
export const refSchema = z.object({ ref: z.string().min(1) });
export type Ref = z.infer<typeof refSchema>;

/** A scalar rendered inline, or a pointer to an object rendered as a box.
 *  Strings that came back from the tracer are already display-truncated. */
export const valueSchema: z.ZodType<Value> = z.union([z.string(), z.number(), z.boolean(), z.null(), refSchema]);
export type Value = string | number | boolean | null | Ref;

/** How the canvas should draw an object, not what its language calls it.
 *  `type` carries the real name for the inspector to print. */
export const heapKindSchema = z.enum(["linked", "tree", "object", "array", "dict", "set"]);
export type HeapKind = z.infer<typeof heapKindSchema>;

export const heapObjectSchema = z.object({
  id: z.string().min(1),
  /** The runtime's own name for the type, shown verbatim. */
  type: z.string(),
  kind: heapKindSchema,
  fields: z.record(valueSchema).optional(),
  items: z.array(valueSchema).optional(),
  entries: z.array(z.tuple([valueSchema, valueSchema])).optional(),
  /** True when the tracer stopped short of the whole object, so the canvas can
   *  say "preview" rather than quietly showing a lie. */
  truncated: z.boolean().optional(),
});
export type HeapObject = z.infer<typeof heapObjectSchema>;

export const stackFrameSchema = z.object({
  name: z.string(),
  line: z.number().int(),
  locals: z.record(valueSchema),
});
export type StackFrame = z.infer<typeof stackFrameSchema>;

/** Why a branch went the way it did. Captured at the moment the runtime converts
 *  the test to a boolean, so a custom truthiness rule is reported as what
 *  actually happened rather than as what the expression looks like it should do. */
export const conditionSchema = z.object({
  expression: z.string(),
  result: z.boolean(),
  /** The statement that owns the test: "if", "while", and so on. */
  kind: z.string(),
  /** Plain-language consequence, e.g. "Exit loop". */
  branch: z.string(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const traceEventSchema = z.enum(["call", "step", "return", "exception", "condition"]);
export type TraceEvent = z.infer<typeof traceEventSchema>;

/** One step. The whole visible world at one instant, not a delta: the canvas
 *  diffs consecutive snapshots itself, which is what lets the timeline scrub
 *  backwards as cheaply as it steps forwards. */
export const snapshotSchema = z.object({
  line: z.number().int(),
  event: traceEventSchema,
  function: z.string(),
  locals: z.record(valueSchema),
  heap: z.record(heapObjectSchema),
  stack: z.array(stackFrameSchema),
  /** Everything written to stdout up to and including this step. */
  output: z.string(),
  result: valueSchema.optional(),
  condition: conditionSchema.nullable().optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

/** What the source says about a line, so the narration can name the statement
 *  without the renderer having to parse the language itself. */
export const lineNoteSchema = z.object({
  /** The statement's node name in the language's own grammar, e.g. "Assign". */
  kind: z.string(),
  text: z.string(),
  /** Names this statement writes to, used to highlight them in the editor. */
  targets: z.array(z.string()),
});
export type LineNote = z.infer<typeof lineNoteSchema>;

export const traceSchema = z.object({
  frames: z.array(snapshotSchema),
  /** Everything the whole run printed. A snapshot's `output` is only what had
   *  been printed by that step, and the entry-point call itself is not traced,
   *  so the tail of the console exists only here. */
  output: z.string().default(""),
  /** The runtime's message when execution did not finish cleanly. A trace with
   *  an error is still worth showing: the frames up to the throw are the point. */
  error: z.string().nullable(),
  /** True when a limit stopped the trace rather than the program ending. */
  truncated: z.boolean(),
  notes: z.record(lineNoteSchema),
  durationMs: z.number(),
});
export type Trace = z.infer<typeof traceSchema>;

export function isRef(value: Value | undefined): value is Ref {
  return typeof value === "object" && value !== null && "ref" in value;
}

/** How a value reads in the inspector. Language-neutral on purpose: a tracer that
 *  wants `None` rather than `null` sends the literal string it wants shown. */
export function formatValue(value: Value | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (isRef(value)) return `@${value.ref}`;
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** True when the two values are the same as far as the canvas is concerned.
 *  Structural, because a snapshot's values are plain JSON by construction. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export const EMPTY_TRACE: Trace = { frames: [], output: "", error: null, truncated: false, notes: {}, durationMs: 0 };
