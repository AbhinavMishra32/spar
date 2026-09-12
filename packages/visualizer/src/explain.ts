import type { Language } from "@spar/domain";
import { formatIn } from "./dialect.js";
import { sameValue, type Condition, type HeapObject, type Snapshot, type Trace, type Value } from "./trace.js";

/**
 * A trace, read rather than drawn.
 *
 * The canvas answers "what does this look like". This answers "what happened,
 * and where exactly did it stop being what you expected" — in text, for a reader
 * that cannot see the canvas at all. That reader is the agent.
 *
 * Why this is a module and not a prompt: a fifteen-hundred-frame trace does not
 * fit in a context window, and the obvious compressions all destroy the thing
 * that makes a trace worth having. Sending every tenth frame loses the one where
 * the invariant broke. Sending a summary loses the values. So nothing here
 * summarises a run into prose; it indexes one, so the agent can ask three
 * cheap questions — what shape was this run, where did `total` change, what was
 * true at step 41 — and get exact answers to each. The agent does the
 * explaining. This makes the evidence small enough to explain from.
 *
 * Every function here is bounded on purpose and says so when it clipped. A
 * report that silently drops the last four locals is worse than one that names
 * three and admits it: the agent will happily reason about the absence.
 */

/** Rows in any one listing. Past this the agent is reading a table rather than
 *  evidence, and the reply it writes stops being about a specific moment. */
const MAX_ROWS = 24;
/** Characters of any single formatted value. Long enough for a short list, short
 *  enough that one pathological string cannot crowd out the rest of a frame. */
const MAX_VALUE = 160;

export type LineVisit = {
  line: number;
  /** The statement's own source text, so the agent can quote the line it means. */
  source: string;
  /** Its node kind in the language's grammar — `While`, `Assign`, `Return`. */
  kind: string;
  visits: number;
  firstStep: number;
  lastStep: number;
};

export type Decision = { step: number; line: number; expression: string; result: boolean; branch: string };

export type VariableLife = {
  name: string;
  first: string;
  last: string;
  /** How many steps changed it, and the first few of them. A counter that moved
   *  forty times and one that moved twice are different kinds of evidence. */
  changes: number;
  changedAt: number[];
};

export type TraceDigest = {
  steps: number;
  truncated: boolean;
  error: string | null;
  durationMs: number;
  /** The entry frame's function, which is what the learner actually called. */
  entry: string;
  /** What it returned, formatted in the learner's language, or null if it did not. */
  returned: string | null;
  output: string;
  lines: LineVisit[];
  decisions: Decision[];
  variables: VariableLife[];
  structures: Array<{ id: string; type: string; kind: string; summary: string }>;
  /** What this digest left out, in words. Never silently empty. */
  clipped: string[];
};

/**
 * The shape of a run, in about a page.
 *
 * The four listings are chosen to answer the four questions that actually
 * separate a working algorithm from a broken one: which lines ran and how often
 * (a loop that ran twice when it should run five times is visible here and
 * nowhere else), which way each branch went, which variables moved and when,
 * and what was built on the heap. Everything else is a follow-up question —
 * `frameReport` and `findMoments` are those follow-ups.
 */
export function digestTrace(trace: Trace, language: Language): TraceDigest {
  const clipped: string[] = [];
  const frames = trace.frames;
  const visits = new Map<number, LineVisit>();
  const decisions: Decision[] = [];
  const lives = new Map<string, { first: Value | undefined; last: Value | undefined; changes: number; changedAt: number[] }>();

  frames.forEach((frame, step) => {
    const note = trace.notes[String(frame.line)];
    const seen = visits.get(frame.line);
    if (seen) {
      seen.visits += 1;
      seen.lastStep = step;
    } else {
      visits.set(frame.line, { line: frame.line, source: note?.text ?? "", kind: note?.kind ?? frame.event, visits: 1, firstStep: step, lastStep: step });
    }
    if (frame.condition) decisions.push({ step, line: frame.line, ...frame.condition });

    const previous = frames[step - 1];
    for (const [name, value] of Object.entries(frame.locals)) {
      const life = lives.get(name);
      if (!life) {
        lives.set(name, { first: value, last: value, changes: 0, changedAt: [step] });
        continue;
      }
      life.last = value;
      /* Only against the step before. A variable is "changed" where the run
         changed it, not wherever it differs from where it started — those are
         different facts and the second one is useless for locating a bug. */
      if (previous && !sameValue(previous.locals[name], value)) {
        life.changes += 1;
        if (life.changedAt.length < 8) life.changedAt.push(step);
      }
    }
  });

  const lines = [...visits.values()].sort((a, b) => a.line - b.line);
  if (lines.length > MAX_ROWS) clipped.push(`${lines.length - MAX_ROWS} more executed lines`);
  if (decisions.length > MAX_ROWS) clipped.push(`${decisions.length - MAX_ROWS} more branch decisions — ask for a specific one with find_execution_moment`);

  const last = frames.at(-1);
  const returned = frames.filter((frame) => frame.event === "return").at(-1)?.result;

  const heap = last ? Object.values(last.heap) : [];
  if (heap.length > MAX_ROWS) clipped.push(`${heap.length - MAX_ROWS} more heap objects`);

  const variables = [...lives.entries()]
    .map(([name, life]) => ({ name, first: clip(formatIn(language, life.first)), last: clip(formatIn(language, life.last)), changes: life.changes, changedAt: life.changedAt }))
    /* Busiest first. In a broken loop the variable that moved most is almost
       always the one to look at, and the ones that never moved are the second
       thing to look at — so both ends of this list are informative and the
       middle is what gets clipped. */
    .sort((a, b) => b.changes - a.changes);
  if (variables.length > MAX_ROWS) clipped.push(`${variables.length - MAX_ROWS} more variables`);

  return {
    steps: frames.length,
    truncated: trace.truncated,
    error: trace.error,
    durationMs: trace.durationMs,
    entry: frames[0]?.function ?? "",
    returned: returned === undefined ? null : clip(formatIn(language, returned)),
    output: trace.output.slice(0, 2_000),
    lines: lines.slice(0, MAX_ROWS),
    decisions: decisions.slice(0, MAX_ROWS),
    variables: variables.slice(0, MAX_ROWS),
    structures: heap.slice(0, MAX_ROWS).map((object) => ({ id: object.id, type: object.type, kind: object.kind, summary: summarizeObject(language, object) })),
    clipped,
  };
}

export type FrameReport = {
  step: number;
  of: number;
  line: number;
  source: string;
  event: string;
  function: string;
  condition: Condition | null;
  /** Every local in scope, formatted. Heap values read as `@id`, and the object
   *  behind each one is expanded below, so a pointer is never a dead end. */
  locals: Record<string, string>;
  /** What this step changed, relative to the step before it. The single most
   *  useful line in the report and the reason it takes a step rather than a
   *  frame: a snapshot alone cannot say what moved. */
  changed: string[];
  heap: Array<{ id: string; type: string; kind: string; summary: string }>;
  stack: Array<{ name: string; line: number; locals: Record<string, string> }>;
  /** Printed up to and including this step. */
  output: string;
  clipped: string[];
};

/**
 * Everything true at one instant, and what the instant before it was not.
 *
 * Reachable only by step index, which is deliberate: the agent has to have
 * located the moment first, from the digest or from `findMoments`. That is what
 * stops the obvious failure mode — walking steps 0, 1, 2, 3 looking for
 * something — which burns a turn and finds nothing, because the interesting
 * step in a 400-step trace is never step 3.
 */
export function frameReport(trace: Trace, step: number, language: Language): FrameReport {
  const index = Math.max(0, Math.min(Math.trunc(step), trace.frames.length - 1));
  const frame = trace.frames[index];
  if (!frame) throw new Error("This trace has no frames, so there is no state to read.");
  const previous = trace.frames[index - 1];
  const clipped: string[] = [];

  const locals = Object.entries(frame.locals);
  if (locals.length > MAX_ROWS) clipped.push(`${locals.length - MAX_ROWS} more locals`);
  const heap = Object.values(frame.heap);
  if (heap.length > MAX_ROWS) clipped.push(`${heap.length - MAX_ROWS} more heap objects`);

  return {
    step: index,
    of: trace.frames.length,
    line: frame.line,
    source: trace.notes[String(frame.line)]?.text ?? "",
    event: frame.event,
    function: frame.function,
    condition: frame.condition ?? null,
    locals: Object.fromEntries(locals.slice(0, MAX_ROWS).map(([name, value]) => [name, clip(formatIn(language, value))])),
    changed: changesBetween(previous, frame, language),
    heap: heap.slice(0, MAX_ROWS).map((object) => ({ id: object.id, type: object.type, kind: object.kind, summary: summarizeObject(language, object) })),
    stack: frame.stack.slice(0, 8).map((entry) => ({
      name: entry.name,
      line: entry.line,
      locals: Object.fromEntries(Object.entries(entry.locals).slice(0, 12).map(([name, value]) => [name, clip(formatIn(language, value))])),
    })),
    output: frame.output.slice(-1_000),
    clipped,
  };
}

/**
 * What changed between two consecutive steps, in one list.
 *
 * Locals and heap fields together, because to a learner they are the same event:
 * `node.next = prev` and `prev = node` are one move in a reversal, and splitting
 * them across two lists is how a narration ends up describing half of it.
 */
export function changesBetween(previous: Snapshot | undefined, frame: Snapshot, language: Language): string[] {
  if (!previous) return [];
  const changes: string[] = [];
  for (const [name, value] of Object.entries(frame.locals)) {
    if (!(name in previous.locals)) {
      changes.push(`${name} = ${clip(formatIn(language, value))} (new)`);
      continue;
    }
    if (!sameValue(previous.locals[name], value)) {
      changes.push(`${name}: ${clip(formatIn(language, previous.locals[name]))} → ${clip(formatIn(language, value))}`);
    }
  }
  for (const object of Object.values(frame.heap)) {
    const before = previous.heap[object.id];
    if (!before) continue;
    for (const [field, value] of Object.entries(object.fields ?? {})) {
      if (!sameValue(before.fields?.[field], value)) changes.push(`@${object.id}.${field}: ${clip(formatIn(language, before.fields?.[field]))} → ${clip(formatIn(language, value))}`);
    }
    if (object.items && !sameValue(before.items, object.items)) changes.push(`@${object.id}: ${clip(summarizeObject(language, before))} → ${clip(summarizeObject(language, object))}`);
    if (object.entries && !sameValue(before.entries, object.entries)) changes.push(`@${object.id}: ${clip(summarizeObject(language, object))}`);
  }
  return changes.slice(0, MAX_ROWS);
}

export type MomentQuery = {
  /** Steps where this local changed. */
  variable?: string | undefined;
  /** Steps executing this source line. */
  line?: number | undefined;
  /** Steps whose branch test went this way. */
  branch?: boolean | undefined;
  /** Steps of this kind: a call, a return, the exception. */
  event?: "call" | "step" | "return" | "exception" | "condition" | undefined;
  /** Steps where any local or heap field took this formatted value. Matched as a
   *  substring of the formatted value, because the agent is looking for `-1` or
   *  `None` rather than reconstructing the runtime's exact spelling. */
  value?: string | undefined;
  limit?: number | undefined;
};

export type Moment = { step: number; line: number; source: string; why: string };

/**
 * Where in a run something happened.
 *
 * This is the tool that makes the other two usable: a 900-step trace has maybe
 * four steps worth reading, and without a way to ask for them the only way to
 * find one is to guess an index. Every filter given must hold, so the queries
 * that matter — "where did `total` change inside the second loop", "where did
 * the while test first go False" — are one call rather than a scan.
 *
 * A match carries its own reason, so the agent never has to re-derive why a step
 * came back and cannot attribute it to the wrong filter.
 */
export function findMoments(trace: Trace, query: MomentQuery, language: Language): { moments: Moment[]; total: number; note: string } {
  const limit = Math.max(1, Math.min(query.limit ?? 8, MAX_ROWS));
  const matches: Moment[] = [];

  trace.frames.forEach((frame, step) => {
    const previous = trace.frames[step - 1];
    const reasons: string[] = [];

    if (query.event && frame.event !== query.event) return;
    if (query.event) reasons.push(query.event === "exception" ? "the exception" : `${query.event} event`);

    if (query.line !== undefined && frame.line !== query.line) return;

    if (query.variable !== undefined) {
      const name = query.variable;
      if (!(name in frame.locals)) return;
      const before = previous?.locals[name];
      const changed = !previous || !(name in previous.locals) || !sameValue(before, frame.locals[name]);
      if (!changed) return;
      reasons.push(previous && name in previous.locals
        ? `${name}: ${clip(formatIn(language, before))} → ${clip(formatIn(language, frame.locals[name]))}`
        : `${name} = ${clip(formatIn(language, frame.locals[name]))} first appears`);
    }

    if (query.branch !== undefined) {
      if (!frame.condition || frame.condition.result !== query.branch) return;
      reasons.push(`${frame.condition.expression} was ${frame.condition.result ? "true" : "false"} — ${frame.condition.branch}`);
    }

    if (query.value !== undefined) {
      const needle = query.value;
      const hit = Object.entries(frame.locals).find(([, value]) => formatIn(language, value).includes(needle));
      if (!hit) return;
      reasons.push(`${hit[0]} is ${clip(formatIn(language, hit[1]))}`);
    }

    matches.push({
      step,
      line: frame.line,
      source: trace.notes[String(frame.line)]?.text ?? "",
      why: reasons.join("; ") || `line ${frame.line}`,
    });
  });

  /* Both ends, not the first N. The first time a loop variable changes and the
     last time it does are the two informative steps; the two hundred in between
     are the same event repeated, and returning only the head of that list is how
     an agent concludes a loop never terminated. */
  const moments = matches.length <= limit ? matches : [...matches.slice(0, Math.ceil(limit / 2)), ...matches.slice(-Math.floor(limit / 2))];
  const note = matches.length === 0
    ? "Nothing in this run matches. A filter that matches nothing is itself evidence — say so rather than assuming the step exists."
    : matches.length > limit
      ? `${matches.length} steps match; showing the first and last few. Narrow with another filter to see the middle.`
      : `${matches.length} ${matches.length === 1 ? "step matches" : "steps match"}.`;
  return { moments, total: matches.length, note };
}

/** One heap object, in a line. Shape-aware because the shape is the point: a
 *  linked-list node reads as its value and its next pointer, a dict as its
 *  first few pairs. Long ones are cut and say so. */
export function summarizeObject(language: Language, object: HeapObject): string {
  const say = (value: Value | undefined) => formatIn(language, value);
  if (object.items) {
    const head = object.items.slice(0, 10).map(say);
    const tail = object.items.length > 10 ? `, …${object.items.length - 10} more` : "";
    return object.kind === "set" ? `{${head.join(", ")}${tail}}` : `[${head.join(", ")}${tail}]`;
  }
  if (object.entries) {
    const head = object.entries.slice(0, 8).map(([key, value]) => `${say(key)}: ${say(value)}`);
    const tail = object.entries.length > 8 ? `, …${object.entries.length - 8} more` : "";
    return `{${head.join(", ")}${tail}}`;
  }
  const fields = Object.entries(object.fields ?? {});
  if (!fields.length) return object.type;
  return `${object.type}(${fields.slice(0, 8).map(([name, value]) => `${name}=${say(value)}`).join(", ")}${fields.length > 8 ? ", …" : ""})`;
}

/**
 * The steps an explanation is built from, packed for the canvas.
 *
 * A view is not a trace. It carries only the frames the agent chose plus, for
 * each, the frame immediately before it — which is what the canvas diffs to
 * colour what moved. That pairing is why a view cannot be assembled in the
 * renderer from step indices alone: step 41's predecessor is step 40, and step
 * 40 is not in the view.
 */
export type TraceStepView = {
  step: number;
  /** The agent's own sentence about this step. The teaching is here; the canvas
   *  only shows what it is about. */
  caption: string;
  /**
   * What to draw, by variable name or `@id`. Empty means everything.
   *
   * This is the difference between a debugger and an explanation. A debugger
   * shows the whole heap because the person driving it is deciding what matters;
   * by the time the agent gets here something has already decided — it found the
   * step, and it knows the sentence it is about to write. A picture of six
   * unrelated objects is a worse answer to "which one moved" than a picture of
   * the two it means.
   */
  focus: string[];
  /** Seconds to dwell here while the sequence plays. The agent sets the pace,
   *  because the step where the invariant breaks deserves longer than the two
   *  setup steps before it, and a fixed interval cannot know which is which. */
  hold: number;
  frame: Snapshot;
  previous: Snapshot | null;
  source: string;
};

export type TraceView = {
  language: Language;
  code: string;
  title: string;
  steps: TraceStepView[];
  /** Whether the sequence runs on its own when it appears. The agent's call:
   *  a three-step change over time wants to be watched, and a single annotated
   *  still wants to be read. */
  autoplay: boolean;
  error: string | null;
  truncated: boolean;
  totalSteps: number;
};

/** Bounds on a dwell. Below the floor a step is a flicker nobody can read;
 *  above the ceiling the learner is waiting on a diagram, which is the moment a
 *  teaching animation turns into a video they want to skip. */
const MIN_HOLD = 0.6;
const MAX_HOLD = 6;

export type StepPick = { step: number; caption: string; focus?: string[] | undefined; hold?: number | undefined };

export function sliceView(
  trace: Trace,
  language: Language,
  code: string,
  title: string,
  picks: StepPick[],
  autoplay = true,
): TraceView {
  const steps = picks
    .map(({ step, caption, focus, hold }) => {
      const index = Math.max(0, Math.min(Math.trunc(step), trace.frames.length - 1));
      const frame = trace.frames[index];
      if (!frame) return null;
      return {
        step: index,
        caption,
        focus: (focus ?? []).map((name) => name.trim()).filter(Boolean).slice(0, 6),
        /* Defaulted from the caption's length when the agent does not say. A
           longer sentence takes longer to read, and a step that vanishes before
           its own caption has been read is the one way an animation can be
           strictly worse than a still. */
        hold: clampHold(hold ?? 1.4 + caption.length / 90),
        frame,
        previous: trace.frames[index - 1] ?? null,
        source: trace.notes[String(frame.line)]?.text ?? "",
      };
    })
    .filter((entry): entry is TraceStepView => entry !== null)
    /* The agent may name them in any order; they are played in run order.
       A "watch this happen" that jumps backwards is not a replay of anything. */
    .sort((a, b) => a.step - b.step);

  /* Autoplay only when there is motion to watch. One step is a diagram, and a
     diagram that plays itself is a diagram that flashes at you once. */
  return { language, code, title, steps, autoplay: autoplay && steps.length > 1, error: trace.error, truncated: trace.truncated, totalSteps: trace.frames.length };
}

/**
 * A stored view, read back.
 *
 * A saved explanation outlives the code that saved it — that is the entire point
 * of storing it rather than inlining it in the message — so by the time anything
 * reads one, its shape is whatever some earlier version of this file wrote. The
 * first row read back after `focus` and `hold` were added had neither, and the
 * card crashed the whole renderer on `focus.map`.
 *
 * So nothing downstream trusts the payload. Every field is checked and defaulted
 * here, once, and a row too damaged to draw comes back as `null` rather than as
 * a half-built view that fails further in. The defaults are the old behaviour:
 * no spotlight is the whole frame, no pace is the caption's reading time.
 */
export function hydrateView(payload: unknown): TraceView | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  const steps = (Array.isArray(value.steps) ? value.steps : [])
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .flatMap((entry) => {
      const frame = entry.frame as Snapshot | undefined;
      // A step without its snapshot cannot be drawn, and drawing the rest of the
      // sequence without it is better than drawing none of it.
      if (!frame || typeof frame !== "object" || typeof frame.line !== "number") return [];
      const caption = typeof entry.caption === "string" ? entry.caption : "";
      return [{
        step: typeof entry.step === "number" ? entry.step : 0,
        caption,
        focus: Array.isArray(entry.focus) ? entry.focus.filter((name): name is string => typeof name === "string") : [],
        hold: clampHold(typeof entry.hold === "number" ? entry.hold : 1.4 + caption.length / 90),
        frame,
        previous: (entry.previous as Snapshot | null) ?? null,
        source: typeof entry.source === "string" ? entry.source : "",
      }];
    });
  if (!steps.length) return null;
  return {
    language: (typeof value.language === "string" ? value.language : "python") as Language,
    code: typeof value.code === "string" ? value.code : "",
    title: typeof value.title === "string" && value.title.trim() ? value.title : "What happens when this runs",
    steps,
    /* Older rows have no `autoplay`. They predate it being directed at all, so
       they are read as stills rather than silently starting to move. */
    autoplay: value.autoplay === true && steps.length > 1,
    error: typeof value.error === "string" ? value.error : null,
    truncated: value.truncated === true,
    totalSteps: typeof value.totalSteps === "number" ? value.totalSteps : steps.length,
  };
}

function clampHold(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_HOLD;
  return Math.round(Math.max(MIN_HOLD, Math.min(seconds, MAX_HOLD)) * 10) / 10;
}

function clip(text: string): string {
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}
