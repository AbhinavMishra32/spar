import { describe, expect, it } from "vitest";
import { assessPracticeAssignment } from "./practiceAssignmentPolicy.js";

const rated = { rating: 1500, deviation: 80, volatility: 0.06 };

const target = {
  abilityTitle: "Window invariant restoration",
  specificGap: "Shrink repeatedly until the window is valid",
  desiredEvidence: "Uses a loop rather than one conditional shrink",
  abilityStatus: "developing" as const,
  abilityConcepts: ["window-invariant-restoration"],
  experience: "new" as const,
  rating: rated,
};

/* The checks are facts for the coach, not a gate. A rating window used to sit
   here, capped at 1200 for anyone who called themselves new until the rating was
   established — which wins on easy problems never make it — so a learner rated
   1797 was told only LeetCode easies fit. */
describe("practice assignment notes", () => {
  it("states the price and the predicted solve chance, and never fails on level", () => {
    for (const sourceRating of [800, 1500, 2600]) {
      const level = assessPracticeAssignment({
        target,
        candidate: { difficulty: "hard", concepts: ["sliding-window"], source: "codeforces", sourceRating },
        proposedConcepts: [{ slug: "window-invariant-restoration", parentSlug: "sliding-window", role: "primary" }],
      }).find((check) => check.name === "learner level")!;
      expect(level.passed).toBe(true);
      expect(level.detail).toContain(`Priced at ${sourceRating}`);
      expect(level.detail).toMatch(/about \d+% of the time/);
      expect(level.detail).not.toMatch(/window/);
    }
  });

  it("does not cap a self-described beginner below what their rating says", () => {
    const strong = { ...target, rating: { rating: 1800, deviation: 180, volatility: 0.06 } };
    const level = assessPracticeAssignment({
      target: strong,
      candidate: { difficulty: "medium", concepts: ["sliding-window"], source: "leetcode", sourceRating: null },
      proposedConcepts: [{ slug: "window-invariant-restoration", parentSlug: "sliding-window", role: "primary" }],
    }).find((check) => check.name === "learner level")!;
    expect(level.passed).toBe(true);
    expect(level.detail).toContain("Priced at 1600");
  });

  it("says when the aim is not among the provider's tags", () => {
    const checks = assessPracticeAssignment({
      target,
      candidate: { difficulty: "hard", concepts: ["graphs", "depth-first-search"], source: "codeforces", sourceRating: 2600 },
      proposedConcepts: [{ slug: "window-invariant-restoration", parentSlug: "sliding-window", role: "primary" }],
    });
    expect(checks.find((check) => check.name === "provider concept")?.passed).toBe(false);
    expect(checks.map((check) => check.name)).toEqual(["learner level", "provider concept"]);
  });
});
