/**
 * What the learner says while the agent is already working.
 *
 * pi has a steering queue, and Spar cannot use it directly: pi drains it only
 * when the loop decides to keep going, and Spar's loop stops after every turn
 * because one turn is one phase. So the queue is held by the controller and
 * drained at the phase boundary — the same seam pi would have used, reached
 * from the other side.
 *
 * What arrives there is a few words typed at a keyboard mid-turn, which is a
 * different kind of input from anything else in the prompt: newer than the
 * evidence, newer than the learner action the turn was started for, and not
 * authority to abandon the phase the controller is in.
 */

/** How much of one interruption is carried into the prompt. The learner is
 *  typing mid-turn, not writing a brief; the cap is here so that a paste cannot
 *  displace the evidence the phase is reasoning from. */
export const STEER_MAX_CHARS = 2_000;

export const clampSteer = (text: string): string => text.trim().slice(0, STEER_MAX_CHARS);

/**
 * The interruptions as the phase prompt states them, or nothing at all.
 *
 * Explicitly dated relative to the turn — "while you were working" — because a
 * learner correcting course halfway through reads very differently from one who
 * asked for this up front, and an agent that cannot tell the two apart will
 * either ignore the correction or restart on it.
 */
export function steeringSection(interruptions: readonly string[]): string {
  if (!interruptions.length) return "";
  return `\n\nThe learner said this while you were working, after the action above. It is the most recent thing they have told you, so honour it in what you do from here — without abandoning the phase you are in:\n${interruptions.map((text) => `- ${text}`).join("\n")}`;
}
