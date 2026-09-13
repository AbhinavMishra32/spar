import { describe, expect, it } from "vitest";
import { clampSteer, steeringSection, STEER_MAX_CHARS } from "./steering.js";

/* What the learner types while the agent is already working. It used to be
   dropped: the session was claimed by the running turn, and the handler answered
   with that turn's id as though the message had been taken. */
describe("a message that arrives mid-turn", () => {
  it("says nothing at all when nothing was said", () => {
    expect(steeringSection([])).toBe("");
  });

  /* Dated relative to the turn on purpose. "The learner said this while you were
     working" and "the learner asked for this up front" are different facts, and
     an agent that cannot tell them apart either ignores the correction or
     restarts the turn on it. */
  it("dates the interruption against the turn and bounds its authority", () => {
    const section = steeringSection(["in Python, not Java"]);
    expect(section).toContain("while you were working");
    expect(section).toContain("without abandoning the phase you are in");
    expect(section).toContain("- in Python, not Java");
  });

  it("keeps several in the order they were typed", () => {
    expect(steeringSection(["one", "two"]).indexOf("- one")).toBeLessThan(steeringSection(["one", "two"]).indexOf("- two"));
  });

  /* The cap is not politeness: this sits beside the evidence the phase reasons
     from, and a pasted file would push the phase's own findings out of the
     window it has to answer in. */
  it("bounds a paste so it cannot displace the evidence", () => {
    expect(clampSteer("x".repeat(50_000))).toHaveLength(STEER_MAX_CHARS);
    expect(clampSteer("  make it easier  ")).toBe("make it easier");
  });
});
