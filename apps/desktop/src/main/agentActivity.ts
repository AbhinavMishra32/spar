import type { AgentActivityStep } from "@spar/domain";

/**
 * What a turn did, held only until its reply is written.
 *
 * The worker reports every tool call as it starts and settles, and those reports
 * went straight to the renderer and nowhere else — so the moment a turn finished
 * and the live run was dropped, the account of how the answer was reached was
 * gone. It is collected here on the way past, and the reply it belongs to takes
 * it with it into storage.
 *
 * Keyed by run rather than by session because two sessions can be mid-turn at
 * once, and a run whose reply never lands must not leak its steps into the next.
 */
const steps = new Map<string, AgentActivityStep[]>();

/** Beyond this a turn is looping, and the transcript row is not the place to
 *  show it. The oldest steps are the ones dropped: what a turn did last is what
 *  its reply is actually built on. */
const MAX_STEPS = 60;

/**
 * Records one worker event if it is a settled tool call. Start events are
 * ignored: the point of the stored copy is what happened, and a call that opened
 * without closing did not.
 */
export function recordAgentActivity(runId: string, event: Record<string, unknown>) {
  if (event.type !== "tool" || event.phase !== "end") return;
  const tool = typeof event.tool === "string" ? event.tool : "";
  if (!tool) return;
  const held = steps.get(runId) ?? [];
  held.push({
    tool,
    label: typeof event.label === "string" ? event.label : "",
    detail: typeof event.detail === "string" ? event.detail : "",
    ok: event.ok !== false,
  });
  steps.set(runId, held.length > MAX_STEPS ? held.slice(-MAX_STEPS) : held);
}

/** The run's steps, and the last word on them — reading clears the entry, so a
 *  turn that retried onto a second provider cannot report the first one twice. */
export function takeAgentActivity(runId: string): AgentActivityStep[] {
  const held = steps.get(runId) ?? [];
  steps.delete(runId);
  return held;
}

/** Dropped without being written, for a turn that ended with no reply to attach
 *  them to. Called on failure so a long session cannot accumulate dead runs. */
export function forgetAgentActivity(runId: string) {
  steps.delete(runId);
}
