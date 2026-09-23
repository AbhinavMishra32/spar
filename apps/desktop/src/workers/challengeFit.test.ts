import { describe, expect, it } from "vitest";
import { reviewChallengeFit } from "./challengeFit.js";

const candidate = {
  concepts: [{ slug: "stack-invariant", role: "primary" }],
  title: "Next Greater Positions",
  language: "python",
  kind: "function",
  difficulty: "developing",
  requiresComplexityAnalysis: true,
  statement: "Implement next_greater_positions for every entry using a left-to-right unresolved-index stack.",
  starterFiles: { "solution.py": "pass" },
  referenceFiles: { "solution.py": "return []" },
  visibleTests: { "test_visible.py": "pass" },
  hiddenTests: { "test_hidden.py": "pass" },
  knownIncorrectFiles: [{ "solution.py": "return None" }],
  runCommand: "python -m unittest",
  accidentalDifficulty: [],
  expectedFailureSignatures: ["equal values"],
  why: "Check whether the learner can transfer unresolved positions to a new setting.",
};

const context = JSON.stringify({
  session: { originalGoal: "Practice coding interviews" },
  activeTrainingTarget: { specific_gap: "Left-to-right unresolved-index stack is untested" },
  recentChallenges: [{ id: "previous", title: "Next Greater Positions", task: candidate.statement, outcome: "passed" }],
});

describe("private challenge fit review", () => {
  it("spends no model call when there is no earlier challenge to compare", async () => {
    let calls = 0;
    const result = await reviewChallengeFit({
      candidate,
      context: JSON.stringify({ session: { originalGoal: "Learn stacks" }, recentChallenges: [] }),
      learnerMessage: "Give me a first challenge",
      signal: new AbortController().signal,
      complete: async () => { calls += 1; return '{"verdict":"accept"}'; },
      progress: () => undefined,
    });
    expect(result.feedback).toBeNull();
    expect(calls).toBe(0);
  });

  it("accepts a justified repeat without imposing a novelty rule", async () => {
    const result = await reviewChallengeFit({
      candidate,
      context,
      learnerMessage: "I want to consolidate this",
      signal: new AbortController().signal,
      complete: async () => '{"verdict":"accept","reason":"A deliberate repeat is useful here."}',
      progress: () => undefined,
    });
    expect(result).toEqual({ candidate, feedback: null });
  });

  it("revises a duplicate and carries a corrected target in the same candidate", async () => {
    const observed: Array<{ pass: number; verdict: string; reason?: string; candidateTitle: string }> = [];
    const replies = [
      '{"verdict":"revise","reason":"The passed challenge already exercised the stated left-to-right invariant."}',
      '{"title":"Repair a streamed stack","kind":"repair","statement":"Repair the streamed stack so equal values and chunk boundaries preserve pending positions.","trainingTarget":{"ability":"Streaming stack state","specificGap":"State across chunks has not been tested","desiredEvidence":"Repairs state retention across chunks","avoidTesting":[]}}',
      '{"verdict":"accept","reason":"This tests state across chunks rather than the solved position lookup."}',
    ];
    const result = await reviewChallengeFit({
      candidate,
      context,
      learnerMessage: "Give me a new challenge",
      signal: new AbortController().signal,
      complete: async () => replies.shift()!,
      progress: () => undefined,
      observe: (event) => observed.push(event),
    });
    expect(result.feedback).toBeNull();
    expect(result.candidate).toMatchObject({ title: "Repair a streamed stack", kind: "repair", trainingTarget: { ability: "Streaming stack state" } });
    expect(observed).toEqual([
      { pass: 1, verdict: "revise", reason: "The passed challenge already exercised the stated left-to-right invariant.", candidateTitle: "Next Greater Positions" },
      { pass: 2, verdict: "accept", reason: "This tests state across chunks rather than the solved position lookup.", candidateTitle: "Repair a streamed stack" },
    ]);
  });

  it("returns evidence-based feedback when the revision still repeats the solved work", async () => {
    const replies = [
      '{"verdict":"revise","reason":"Already solved"}',
      '{"title":"Position lookup again"}',
      '{"verdict":"revise","reason":"Still the same position lookup despite the new title"}',
    ];
    const result = await reviewChallengeFit({
      candidate,
      context,
      learnerMessage: "Give me a new challenge",
      signal: new AbortController().signal,
      complete: async () => replies.shift()!,
      progress: () => undefined,
    });
    expect(result.feedback).toContain("Still the same position lookup");
  });
});
