import { describe, expect, it } from "vitest";
import { ESTABLISHED_DEVIATION, GENERATED_DIFFICULTIES, UNRATED } from "@spar/domain";
import { assessGeneratedLevel, assessPracticeAssignment, trainingWindow } from "./practiceAssignmentPolicy.js";

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

/**
 * The generated path, which until now had no level check at all while the
 * sourced one beside it did. The bug that produced these tests: a learner rated
 * 1635 was set a run of `developing` challenges priced at 1200, solved every one,
 * and stayed provisional forever — because a result you were always going to get
 * right carries no information for Glicko-2 to narrow a deviation with.
 */
describe("the level check on a challenge Spar writes itself", () => {
  const strong = { rating: 1635, deviation: 90, volatility: 0.06 };

  it("refuses the word that produced the bug, and names the one to use", () => {
    const check = assessGeneratedLevel({ graded: true, difficulty: "developing", target: { rating: strong, abilityStatus: "developing", experience: "working" } });

    expect(check.passed).toBe(false);
    expect(check.detail).toContain("Write it as proficient");
  });

  it("admits the word that lands in the window", () => {
    const check = assessGeneratedLevel({ graded: true, difficulty: "proficient", target: { rating: strong, abilityStatus: "developing", experience: "working" } });

    expect(check.passed).toBe(true);
  });

  it("follows the ability's status rather than one range per learner", () => {
    /* Monitoring a settled ability wants a stretch, so the same learner takes a
       harder word — which is the nuance the window exists to carry. */
    const monitoring = assessGeneratedLevel({ graded: true, difficulty: "advanced", target: { rating: strong, abilityStatus: "independent", experience: "working" } });
    const practising = assessGeneratedLevel({ graded: true, difficulty: "advanced", target: { rating: strong, abilityStatus: "developing", experience: "working" } });

    expect(monitoring.passed).toBe(true);
    expect(practising.passed).toBe(false);
  });

  it("stands down rather than becoming a gate nothing can pass", () => {
    /* Spar's four anchors stop at 1800, so a learner far above that has a window
       no word can satisfy. Refusing there would loop the agent forever and leave
       the learner with nothing, so the nearest word is accepted instead. */
    const outgrown = { rating: 2300, deviation: 70, volatility: 0.06 };
    for (const difficulty of GENERATED_DIFFICULTIES) {
      expect(assessGeneratedLevel({ graded: true, difficulty, target: { rating: outgrown, abilityStatus: "developing", experience: "senior" } }).passed).toBe(true);
    }
  });

  it("still pitches a barely-measured learner low, because the window has not been earned", () => {
    const check = assessGeneratedLevel({ graded: true, difficulty: "advanced", target: { rating: UNRATED, abilityStatus: "uncertain", experience: "new" } });

    expect(check.passed).toBe(false);
  });

  it("leaves a cold start to the pedagogy, because there is nothing measured to pitch against", () => {
    /* The window off a seeded rating lands at 1050-1200 for an untested ability,
       which would refuse the accessible first rung the agent is told to open
       with. Nothing has been graded, so that window is an assumption. */
    const check = assessGeneratedLevel({ graded: false, difficulty: "foundation", target: { rating: UNRATED, abilityStatus: "uncertain", experience: "new" } });

    expect(check.passed).toBe(true);
  });
});
