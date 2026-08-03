import { describe, expect, it } from "vitest";
import { recordAgentActivity, takeAgentActivity } from "./agentActivity.js";

/**
 * A turn is a sequence, and the stored copy has to keep it: the sentence the
 * agent said, the call it made after saying it, the thinking in between. All of
 * this used to reach the renderer and nothing else, so a finished turn kept only
 * its last paragraph.
 */
describe("what a turn leaves behind", () => {
  it("keeps thinking, narration, and calls in the order they happened", () => {
    const run = "run-1";
    recordAgentActivity(run, { type: "reasoning", text: "The shrink case is the one that broke." });
    recordAgentActivity(run, { type: "text", text: "Reading your solve " });
    recordAgentActivity(run, { type: "text", text: "before I judge it." });
    recordAgentActivity(run, { type: "tool", phase: "start", tool: "replay_attempt" });
    recordAgentActivity(run, { type: "tool", phase: "end", tool: "replay_attempt", label: "full log", detail: "5 runs", ok: true });
    recordAgentActivity(run, { type: "reasoning", text: "Now I know what to aim at." });

    const activity = takeAgentActivity(run);
    expect(activity.map((step) => step.kind)).toEqual(["reasoning", "note", "tool", "reasoning"]);
    // Deltas of one sentence are one segment, not one segment per delta.
    expect(activity[1]?.text).toBe("Reading your solve before I judge it.");
    expect(activity[2]?.detail).toBe("5 runs");
    // Reading is destructive, so a second turn cannot inherit the first one's steps.
    expect(takeAgentActivity(run)).toEqual([]);
  });

  it("keeps two concurrent runs apart", () => {
    recordAgentActivity("a", { type: "text", text: "Turn A" });
    recordAgentActivity("b", { type: "text", text: "Turn B" });

    expect(takeAgentActivity("a").map((step) => step.text)).toEqual(["Turn A"]);
    expect(takeAgentActivity("b").map((step) => step.text)).toEqual(["Turn B"]);
  });
});
