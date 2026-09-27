import { describe, expect, it } from "vitest";
import { readChallengeEditCall } from "./ChallengeEditCard";

describe("readChallengeEditCall", () => {
  it("pairs each changed part with its text before the edit, and names files the learner kept", () => {
    const input = JSON.stringify({ note: "Added a figure.", edits: [] });
    const output = JSON.stringify({
      status: "edited",
      before: [{ part: "statement", text: "old" }, { part: "starter", path: "solution.py", text: "def f(): pass" }],
      after: [{ part: "statement", text: "new" }, { part: "starter", path: "solution.py", text: "def f(x: int): pass" }],
      learnerFiles: [{ path: "solution.py", outcome: "kept" }],
    });
    expect(readChallengeEditCall(input, output)).toEqual({
      note: "Added a figure.",
      edits: [{ name: "Statement", before: "old", after: "new" }, { name: "Starter · solution.py", before: "def f(): pass", after: "def f(x: int): pass" }],
      kept: ["solution.py"],
    });
  });

  it("draws nothing from a refused or clipped result", () => {
    expect(readChallengeEditCall("{}", "{\"status\":\"invalid\"}").edits).toEqual([]);
    expect(readChallengeEditCall("{}", "{not json").edits).toEqual([]);
  });
});
