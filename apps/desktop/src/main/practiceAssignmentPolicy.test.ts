import { describe, expect, it } from "vitest";
import { ESTABLISHED_DEVIATION, UNRATED } from "@spar/domain";
import { assessPracticeAssignment, trainingWindow } from "./practiceAssignmentPolicy.js";

/** An established learner sitting mid-scale, so a window computed around them is
 *  a window and not the wide band a provisional rating produces. */
const rated = { rating: 1500, deviation: 80, volatility: 0.06 };

const target = {
  abilityTitle: "Window invariant restoration",
  specificGap: "Shrink repeatedly until the window is valid",
  desiredEvidence: "Uses a loop rather than one conditional shrink",
  abilityStatus: "developing" as const,
  abilityConcepts: ["window-invariant-restoration"],
  experience: "working" as const,
  rating: rated,
};

/* What replaced `difficultyBand`, which returned a list of provider words keyed
   on ability status. The window is in rating points and is inverted out of the
   same curve that scores the result afterwards, so the level a problem is
   admitted at and the level it is graded at cannot drift apart. */
describe("the window of problems worth setting", () => {
  it("aims a diagnostic near even money and a monitoring check above the learner", () => {
    const diagnostic = trainingWindow({ rating: rated, abilityStatus: "uncertain" });
    const monitoring = trainingWindow({ rating: rated, abilityStatus: "independent" });
    expect(diagnostic.minRating).toBeLessThan(diagnostic.maxRating);
    expect(monitoring.maxRating).toBeGreaterThan(diagnostic.maxRating);
    expect(monitoring.minRating).toBeGreaterThan(diagnostic.minRating);
  });

  it("widens while the rating is still a guess, because more problems are plausibly the right one", () => {
    const unsure = trainingWindow({ rating: UNRATED, abilityStatus: "developing", experience: "senior" });
    const measured = trainingWindow({ rating: rated, abilityStatus: "developing", experience: "senior" });
    expect(unsure.maxRating - unsure.minRating).toBeGreaterThan(measured.maxRating - measured.minRating);
  });

  /* Every learner starts at the same provisional 1500 whatever they said about
     themselves, so the claim caps the window until there is evidence — and stops
     mattering the moment there is. */
  it("caps a beginner's window by what they claimed, only until the rating is measured", () => {
    const claimed = trainingWindow({ rating: UNRATED, abilityStatus: "developing", experience: "new" });
    const unclaimed = trainingWindow({ rating: UNRATED, abilityStatus: "developing", experience: "senior" });
    expect(claimed.maxRating).toBeLessThan(unclaimed.maxRating);
    expect(rated.deviation).toBeLessThanOrEqual(ESTABLISHED_DEVIATION);
    expect(trainingWindow({ rating: rated, abilityStatus: "developing", experience: "new" }).maxRating)
      .toBe(trainingWindow({ rating: rated, abilityStatus: "developing", experience: "senior" }).maxRating);
  });

  it("never closes the window, even when the cap sits below the band", () => {
    const window = trainingWindow({ rating: { rating: 2200, deviation: 200, volatility: 0.06 }, abilityStatus: "independent", experience: "new" });
    expect(window.maxRating).toBeGreaterThanOrEqual(window.minRating);
  });
});

describe("practice assignment policy", () => {
  it("accepts a sub-concept aimed at the matching provider family and target", () => {
    const window = trainingWindow(target);
    const checks = assessPracticeAssignment({
      target,
      /* Priced inside the window by its published Codeforces rating, which is
         already the scale the learner is rated on. */
      candidate: { difficulty: "medium", concepts: ["sliding-window", "arrays"], source: "codeforces", sourceRating: Math.round((window.minRating + window.maxRating) / 2) },
      proposedConcepts: [{ slug: "window-invariant-restoration", parentSlug: "sliding-window", role: "primary" }],
      why: "This requires repeated shrinking until the window is valid, which directly discriminates the persisted gap.",
    });
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("rejects a problem priced past the window, and an unrelated one", () => {
    const checks = assessPracticeAssignment({
      target: { ...target, abilityStatus: "uncertain" },
      candidate: { difficulty: "hard", concepts: ["graphs", "depth-first-search"], source: "codeforces", sourceRating: 2600 },
      proposedConcepts: [{ slug: "window-invariant-restoration", parentSlug: "sliding-window", role: "primary" }],
      why: "This is a generally useful contest problem.",
    });
    expect(checks.filter((check) => !check.passed).map((check) => check.name)).toEqual(expect.arrayContaining(["learner level", "provider concept", "target rationale"]));
  });

  /* The refusal has to be actionable: the agent searches by rating, so a level
     check that only says "too hard" sends it guessing. */
  it("names the rating range to search when it turns a problem down for level", () => {
    const level = assessPracticeAssignment({
      target,
      candidate: { difficulty: "hard", concepts: ["sliding-window"], source: "codeforces", sourceRating: 2600 },
      proposedConcepts: [{ slug: "window-invariant-restoration", parentSlug: "sliding-window", role: "primary" }],
      why: "This requires repeated shrinking until the window is valid.",
    }).find((check) => check.name === "learner level")!;
    expect(level.passed).toBe(false);
    expect(level.detail).toContain("2600");
    expect(level.detail).toContain(String(trainingWindow(target).maxRating));
  });

  /* A LeetCode problem publishes no per-problem rating, so it is priced by its
     band — and the check has to work on that, because it is most of the catalogue. */
  it("prices a problem the source did not rate by its band", () => {
    const checks = assessPracticeAssignment({
      target,
      candidate: { difficulty: "medium", concepts: ["sliding-window"], source: "leetcode", sourceRating: null },
      proposedConcepts: [{ slug: "window-invariant-restoration", parentSlug: "sliding-window", role: "primary" }],
      why: "This requires repeated shrinking until the window is valid, which discriminates the persisted gap.",
    });
    expect(checks.find((check) => check.name === "learner level")!.detail).toMatch(/Priced at \d+/);
  });
});
