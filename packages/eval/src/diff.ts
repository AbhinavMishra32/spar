import type { Trace, TraceEvent } from "./trace.js";

/**
 * Two runs, aligned and compared.
 *
 * The question a trace diff answers is narrower than it looks, and keeping it
 * narrow is what makes it useful: *where did these two runs first stop doing the
 * same thing, and what did each do instead*. Not "what is different" — almost
 * everything is different, because token counts and latencies and generated
 * identifiers all differ between any two runs — but where the **behaviour**
 * forked.
 *
 * So the comparison runs on a deliberately lossy projection of each event, and
 * what is thrown away is as considered as what is kept:
 *
 * - **Out:** wall clock, relative time, latency, token counts, generated ids.
 *   These differ between two runs of the same commit, so including them means
 *   every diff is noise and nobody reads the next one.
 * - **In:** the controller's stage, which tool was called, whether the host
 *   admitted it, and the hash of what was passed. Spar's stage sequence is
 *   deterministic given the outcomes so far, which makes it a genuine spine: two
 *   runs that diverge here diverged because something decided differently.
 * - **In, but separately:** the ledger snapshots, which are the outcome rather
 *   than the path. Two runs can take the same path to different conclusions, and
 *   that is the single most interesting thing a before/after can show.
 */

/** The projection two runs are aligned on. Everything that varies run to run
 *  without anything having decided differently is left out. */
export function shapeKey(event: TraceEvent): string {
  switch (event.kind) {
    case "turn_started": return `turn:${event.turnKind}`;
    case "stage": return `stage:${event.step}:${event.activeTools.join("|")}:${event.toolChoice}`;
    case "model_request": return `ask:${event.step}:${event.toolChoice}`;
    /* The calls it chose, not the text it wrote. Two responses that requested the
       same tools with the same arguments are the same decision however
       differently they were worded, and the argument hash is carried by the
       tool_call event that follows. */
    case "model_response": return `said:${event.step}:${event.calls.join("|")}`;
    case "tool_call": return `call:${event.step}:${event.name}:${event.inputHash}`;
    case "tool_result": return `result:${event.step}:${event.name}:${event.ok ? "ok" : "refused"}:${event.status}:${failedCheckNames(event).join("|")}`;
    case "attempt": return `attempt:${event.outcome}:${event.misconception}`;
    case "ledger": return `ledger:${event.label}`;
    case "reply": return `reply:${event.textHash}`;
    case "note": return `note:${event.text}`;
    case "error": return `error:${event.fatal ? "fatal" : "handled"}:${event.message}`;
  }
}

function failedCheckNames(event: Extract<TraceEvent, { kind: "tool_result" }>): string[] {
  return event.checks.filter((check) => !check.passed).map((check) => check.name);
}

export type DiffStep =
  | { op: "same"; key: string; baseline: TraceEvent; candidate: TraceEvent }
  | { op: "removed"; key: string; baseline: TraceEvent }
  | { op: "added"; key: string; candidate: TraceEvent };

export type TraceDiff = {
  steps: DiffStep[];
  /** How far the two runs agreed before the first divergence, as a count of
   *  aligned events. The single most useful number in the whole diff: a
   *  divergence at event 2 is a different change from one at event 40. */
  agreedFor: number;
  firstDivergence: DiffStep | null;
  identical: boolean;
};

/**
 * Longest common subsequence over the shape keys.
 *
 * LCS rather than a positional walk because a change that inserts one extra
 * retry should read as one insertion, not as "everything after step 3 is
 * different". Traces here are hundreds of events, so the quadratic table is
 * nothing; if that ever stops being true the fix is to align on `stage` events
 * first and diff within each stage, not to abandon alignment.
 */
export function diffTraces(baseline: Trace, candidate: Trace): TraceDiff {
  const left = baseline.events;
  const right = candidate.events;
  const leftKeys = left.map(shapeKey);
  const rightKeys = right.map(shapeKey);

  const table: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i]![j] = leftKeys[i] === rightKeys[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const steps: DiffStep[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (leftKeys[i] === rightKeys[j]) {
      steps.push({ op: "same", key: leftKeys[i]!, baseline: left[i]!, candidate: right[j]! });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      steps.push({ op: "removed", key: leftKeys[i]!, baseline: left[i]! });
      i += 1;
    } else {
      steps.push({ op: "added", key: rightKeys[j]!, candidate: right[j]! });
      j += 1;
    }
  }
  for (; i < left.length; i += 1) steps.push({ op: "removed", key: leftKeys[i]!, baseline: left[i]! });
  for (; j < right.length; j += 1) steps.push({ op: "added", key: rightKeys[j]!, candidate: right[j]! });

  const firstDivergenceIndex = steps.findIndex((step) => step.op !== "same");
  return {
    steps,
    agreedFor: firstDivergenceIndex === -1 ? steps.length : firstDivergenceIndex,
    firstDivergence: firstDivergenceIndex === -1 ? null : steps[firstDivergenceIndex]!,
    identical: firstDivergenceIndex === -1,
  };
}

/**
 * The diff as a person reads it: a few lines of agreement for context, then
 * everything from the fork onwards.
 *
 * Truncated at the head rather than the tail. Nobody needs to see that the first
 * thirty events matched; everybody needs to see all of what happened after they
 * stopped, because the interesting failure mode is a run that recovers and one
 * that does not, and that only shows at the end.
 */
export function renderTraceDiff(diff: TraceDiff, options: { context?: number } = {}): string {
  const { context = 3 } = options;
  if (diff.identical) return `identical — ${diff.steps.length} events agreed`;
  const from = Math.max(0, diff.agreedFor - context);
  const lines = diff.steps.slice(from).map((step) => {
    if (step.op === "same") return `  ${step.key}`;
    return step.op === "removed" ? `- ${step.key}` : `+ ${step.key}`;
  });
  const skipped = from > 0 ? [`  … ${from} earlier events agreed`] : [];
  return [...skipped, ...lines].join("\n");
}
