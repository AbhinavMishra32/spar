import { describe, expect, it } from "vitest";
import { isBlankAnswer, parseReviewGrade, parseReviewPrompt, pickReviewTarget, reviewFormats, reviewPromptInstructions } from "./reviewAgent.js";

const memory = (stabilityDays: number, lapses = 0) => ({ stabilityDays, recallChance: 0.9, reps: 2, lapses, daysSinceLastReview: 3 });

describe("which formats a review may use", () => {
  it("rebuilds a fragile card and stretches a held one", () => {
    expect(reviewFormats(memory(2), [])[0]).toBe("recognize");
    expect(reviewFormats(memory(2, 1), [])[0]).toBe("explain-why");
    expect(reviewFormats(memory(40), [])[0]).toBe("what-if");
    expect(reviewFormats(memory(2), [])).not.toContain("what-if");
  });

  it("never makes a card of the re-solve: solving it again is the review, offered before the card", () => {
    expect(reviewFormats(memory(40), [])).not.toContain("resolve");
    expect(reviewFormats(memory(40), [], "problem")).not.toContain("resolve");
    expect(reviewFormats(memory(40), [], "problem").length).toBeGreaterThan(0);
  });

  it("never asks the same kind of question twice running", () => {
    expect(reviewFormats(memory(10), [{ format: "recognize", rating: 3, daysAgo: 5, feedback: null }])).not.toContain("recognize");
  });

  it("names the learner's language and only the offered formats in the prompt", () => {
    const text = reviewPromptInstructions(["recognize", "sketch"], "python");
    expect(text).toContain('"recognize", "sketch"');
    expect(text).toContain("python");
  });
});

describe("what a review is about", () => {
  it("narrows the formats to the target without leaving the memory band", () => {
    expect(reviewFormats(memory(2), [], "pitfall")).toEqual(["explain-why", "spot-the-bug"]);
    expect(reviewFormats(memory(10), [], "pattern")).toEqual(["recognize", "what-if", "sketch"]);
    // A fragile card asked about its problem outlines the approach; it is not sent to re-solve.
    expect(reviewFormats(memory(2), [], "problem")).toEqual(["explain-why", "sketch"]);
  });

  it("still varies the format within a target", () => {
    expect(reviewFormats(memory(10), [{ format: "recognize", target: "pattern", rating: 3, daysAgo: 5, feedback: null }], "pattern")).not.toContain("recognize");
  });

  it("rotates to the card's target gone longest without a review", () => {
    const history = [
      { format: "recognize" as const, target: "pattern" as const, rating: 3, daysAgo: 2, feedback: null },
      { format: "invariant" as const, target: "concept" as const, rating: 3, daysAgo: 6, feedback: null },
    ];
    expect(pickReviewTarget(["pattern", "concept", "problem"], history)).toBe("problem");
    expect(pickReviewTarget(["pattern", "concept"], history)).toBe("concept");
    expect(pickReviewTarget(["pattern"], history)).toBe("pattern");
  });

  it("tells the writer what to make them recall", () => {
    expect(reviewPromptInstructions(["sketch"], "python", "problem")).toContain("THE PROBLEM ITSELF");
    expect(reviewPromptInstructions(["recognize"], "python", "pattern")).toContain("independent of this problem");
  });
});

describe("reading the model's replies", () => {
  it("takes a prompt out of a fenced reply and pulls an off-band format back into the band", () => {
    const reply = "```json\n" + JSON.stringify({ format: "resolve", prompt: "You get a stream of prices. Find the longest stretch that rises. What approach?", cue: "", expected: ["one pass", " ", "track the run length"] }) + "\n```";
    const parsed = parseReviewPrompt(reply, ["recognize", "invariant"]);
    expect(parsed).toMatchObject({ format: "recognize", cue: null, expected: ["one pass", "track the run length"] });
  });

  it("rejects a prompt with nothing to grade against", () => {
    expect(parseReviewPrompt(JSON.stringify({ format: "recognize", prompt: "What would you do here, and why?", cue: null, expected: [] }), ["recognize"])).toBeNull();
    expect(parseReviewPrompt("not json", ["recognize"])).toBeNull();
  });

  it("reads a grade with a string rating and missing lists", () => {
    const grade = parseReviewGrade("Here you go: " + JSON.stringify({ verdict: "partial", rating: "2", feedback: "The idea is there but the invariant is not.", misconception: "" }));
    expect(grade).toEqual({ verdict: "partial", rating: 2, hits: [], misses: [], feedback: "The idea is there but the invariant is not.", misconception: null });
    expect(parseReviewGrade(JSON.stringify({ verdict: "maybe", rating: 7, feedback: "?" }))).toBeNull();
  });

  it("treats a way of saying 'I don't remember' as a blank answer", () => {
    expect(isBlankAnswer("idk")).toBe(true);
    expect(isBlankAnswer("  I don't know. ")).toBe(true);
    expect(isBlankAnswer("Use two pointers and shrink from the left")).toBe(false);
  });
});
