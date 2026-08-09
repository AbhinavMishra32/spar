import { describe, expect, it } from "vitest";
import { assessPracticeAssignment, difficultyBand } from "./practiceAssignmentPolicy.js";

const target = {
  abilityTitle: "Window invariant restoration",
  specificGap: "Shrink repeatedly until the window is valid",
  desiredEvidence: "Uses a loop rather than one conditional shrink",
  abilityStatus: "developing" as const,
  abilityConcepts: ["window-invariant-restoration"],
  experience: "working" as const,
};

describe("practice assignment policy", () => {
  it("bounds provider difficulty by durable ability evidence", () => {
    expect(difficultyBand("uncertain")).toEqual(["easy"]);
    expect(difficultyBand("uncertain", "senior")).toEqual(["easy", "medium"]);
    expect(difficultyBand("developing")).toEqual(["easy", "medium"]);
    expect(difficultyBand("independent")).toEqual(["medium", "hard"]);
  });

  it("accepts a sub-concept aimed at the matching provider family and target", () => {
    const checks = assessPracticeAssignment({
      target,
      candidate: { difficulty: "medium", concepts: ["sliding-window", "arrays"] },
      proposedConcepts: [{ slug: "window-invariant-restoration", parentSlug: "sliding-window", role: "primary" }],
      why: "This requires repeated shrinking until the window is valid, which directly discriminates the persisted gap.",
    });
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("rejects a hard jump and an unrelated provider problem", () => {
    const checks = assessPracticeAssignment({
      target: { ...target, abilityStatus: "uncertain" },
      candidate: { difficulty: "hard", concepts: ["graphs", "depth-first-search"] },
      proposedConcepts: [{ slug: "window-invariant-restoration", parentSlug: "sliding-window", role: "primary" }],
      why: "This is a generally useful contest problem.",
    });
    expect(checks.filter((check) => !check.passed).map((check) => check.name)).toEqual(expect.arrayContaining(["learner level", "provider concept", "target rationale"]));
  });
});
