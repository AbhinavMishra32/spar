import type { AgentActivityStep } from "@spar/domain";

/**
 * What a turn did, in order, held only until its reply is written.
 *
 * The worker reports its reasoning and every tool call as they happen, and those
 * reports went straight to the renderer and nowhere else — so the moment a turn
 * finished and the live run was dropped, the account of how the answer was
 * reached was gone. It is collected here on the way past, in the order it
 * happened, and the reply it belongs to takes it into storage.
 *
 * Order is the whole point. A turn that thought, called two tools, thought again
 * and then answered is a different turn from one that called two tools and
 * thought once, and a set of steps with the thinking hoisted out of it cannot
 * tell them apart.
 *
 * Keyed by run rather than by session because two sessions can be mid-turn at
 * once, and a run whose reply never lands must not leak its steps into the next.
 */
const segments = new Map<string, AgentActivityStep[]>();
/** When the open reasoning block started, so its stored row can say how long. */
const thinkingSince = new Map<string, number>();

/** Beyond this a turn is looping, and the transcript row is not the place to show
 *  it. The oldest steps go first: what a turn did last is what its reply is built
 *  on. */
const MAX_STEPS = 80;
/** Reasoning is verbose by nature, and this is stored per turn forever. Enough to
 *  read back why a turn went the way it did, not a full transcript of the model. */
const MAX_REASONING = 4_000;
/** A phase narration is one sentence. This is a guard, not a budget. */
const MAX_NOTE = 600;

export function recordAgentActivity(runId: string, event: Record<string, unknown>) {
  if (event.type === "reasoning") return recordReasoning(runId, event);
  if (event.type === "text") return recordNote(runId, event);
  if (event.type !== "tool" || event.phase !== "end") return;
  const tool = typeof event.tool === "string" ? event.tool : "";
  if (!tool) return;
  push(runId, {
    kind: "tool",
    tool,
    label: typeof event.label === "string" ? event.label : "",
    actionTitle: typeof event.actionTitle === "string" ? event.actionTitle : "",
    detail: typeof event.detail === "string" ? event.detail : "",
    ok: event.ok !== false,
    text: "",
    seconds: 0,
    /* Stored so a turn read back weeks later opens to the same arguments and
       results it showed while it ran. Already redacted and bounded by the
       worker, which is the only place that sees the unredacted design. */
    input: typeof event.input === "string" ? event.input : "",
    output: typeof event.output === "string" ? event.output : "",
  });
  thinkingSince.delete(runId);
}

/**
 * Reasoning deltas append to the open thinking step, so one block of thought is
 * one row rather than one row per token. A tool call between two blocks ends the
 * first, which is what keeps the stored order faithful to what happened.
 */
function recordReasoning(runId: string, event: Record<string, unknown>) {
  if (event.phase === "end") {
    thinkingSince.delete(runId);
    return;
  }
  const text = typeof event.text === "string" ? event.text : "";
  if (event.phase === "start" || !text) return;
  const held = segments.get(runId) ?? [];
  const open = held.at(-1);
  const startedAt = thinkingSince.get(runId);
  if (open?.kind === "reasoning" && startedAt !== undefined) {
    open.text = open.text.length >= MAX_REASONING ? open.text : (open.text + text).slice(0, MAX_REASONING);
    open.seconds = Math.round((Date.now() - startedAt) / 1_000);
    return;
  }
  thinkingSince.set(runId, Date.now());
  push(runId, { kind: "reasoning", tool: "", label: "", actionTitle: "", detail: "", ok: true, text: text.slice(0, MAX_REASONING), seconds: 0, input: "", output: "" });
}

/**
 * A sentence the agent said mid-turn, before one of its calls. These arrive as
 * text deltas exactly like the final reply does, and they used to be streamed to
 * the renderer and then lost — so a finished turn had the calls and the thinking
 * but not the narration that tied them together.
 */
function recordNote(runId: string, event: Record<string, unknown>) {
  const text = typeof event.text === "string" ? event.text : "";
  if (!text) return;
  const held = segments.get(runId) ?? [];
  const open = held.at(-1);
  if (open?.kind === "note") {
    open.text = open.text.length >= MAX_NOTE ? open.text : (open.text + text).slice(0, MAX_NOTE);
    return;
  }
  thinkingSince.delete(runId);
  push(runId, { kind: "note", tool: "", label: "", actionTitle: "", detail: "", ok: true, text: text.slice(0, MAX_NOTE), seconds: 0, input: "", output: "" });
}

function push(runId: string, step: AgentActivityStep) {
  const held = segments.get(runId) ?? [];
  held.push(step);
  segments.set(runId, held.length > MAX_STEPS ? held.slice(-MAX_STEPS) : held);
}

/** The run's steps, and the last word on them — reading clears the entry, so a
 *  turn that retried onto a second provider cannot report the first one twice. */
export function takeAgentActivity(runId: string): AgentActivityStep[] {
  const held = segments.get(runId) ?? [];
  segments.delete(runId);
  thinkingSince.delete(runId);
  return held;
}

/** Dropped without being written, for a turn that ended with no reply to attach
 *  them to. Called on failure so a long session cannot accumulate dead runs. */
export function forgetAgentActivity(runId: string) {
  segments.delete(runId);
  thinkingSince.delete(runId);
}
