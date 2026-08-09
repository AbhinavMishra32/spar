import { describe, expect, it } from "vitest";
import { syntheticChallengeAuthoringDoctrine } from "./challengeAuthoring.js";

describe("synthetic challenge authoring doctrine", () => {
  it("requires professional problem-page structure and excludes agent commentary", () => {
    const doctrine = syntheticChallengeAuthoringDoctrine();

    expect(doctrine).toContain("**Examples**");
    expect(doctrine).toContain("**Constraints**");
    expect(doctrine).toContain("**Input:**");
    expect(doctrine).toContain("**Output:**");
    expect(doctrine).toContain("Never mention Spar, the agent, the prompt");
  });

  it("gives repair challenges a learner-facing contract without changing their semantics", () => {
    const doctrine = syntheticChallengeAuthoringDoctrine();

    expect(doctrine).toContain("provided implementation is intended to satisfy a named contract");
    expect(doctrine).toContain("without changing the public API");
    expect(doctrine).toContain("should not lead with a source path");
  });
});
