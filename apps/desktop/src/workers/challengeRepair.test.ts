import { describe, expect, it } from "vitest";
import { mergeQuestionChanges, parseRepairChanges, repairQuestionUntilValid } from "./challengeRepair.js";

describe("rejected challenge repair", () => {
  it("changes one failed test without rebuilding the retained candidate", () => {
    const candidate = {
      title: "Transform values",
      statement: "Retain this exact learner-facing contract.",
      referenceFiles: { "src/index.ts": "old implementation", "src/helper.ts": "keep helper" },
      visibleTests: { "tests/visible.test.ts": "keep visible" },
      hiddenTests: { "tests/hidden.test.ts": "old hidden" },
    };
    const repaired = mergeQuestionChanges(candidate, {
      referenceFiles: { "src/index.ts": "fixed implementation" },
      hiddenTests: { "tests/hidden.test.ts": "fixed hidden" },
    });

    expect(repaired).toEqual({
      ...candidate,
      referenceFiles: { "src/index.ts": "fixed implementation", "src/helper.ts": "keep helper" },
      hiddenTests: { "tests/hidden.test.ts": "fixed hidden" },
    });
    expect(repaired.statement).toBe(candidate.statement);
    expect(repaired.visibleTests).toBe(candidate.visibleTests);
  });

  it("reads a small JSON patch without treating surrounding prose as fields", () => {
    expect(parseRepairChanges('```json\n{"changes":{"runCommand":"node --test"}}\n```')).toEqual({ runCommand: "node --test" });
    expect(parseRepairChanges("not json")).toBeNull();
  });

  it("removes the old path when a repair renames a test", () => {
    const repaired = mergeQuestionChanges(
      { visibleTests: { "tests/visible.test.py": "old" } },
      { visibleTests: { "tests/visible.test.py": null, "tests/test_visible.py": "new" } },
    );
    expect(repaired.visibleTests).toEqual({ "tests/test_visible.py": "new" });
  });

  it("keeps one tool call alive after malformed and unchanged repair replies", async () => {
    const replies = ["not json", '{"referenceFiles":{"src/index.js":"wrong"}}', '{"referenceFiles":{"src/index.js":"fixed"}}'];
    const feedback: string[] = [];
    const validated: Array<Record<string, unknown>> = [];
    const result = await repairQuestionUntilValid(
      { title: "Keep the learner's target", referenceFiles: { "src/index.js": "wrong" } },
      { status: "invalid" },
      {
        limit: 4,
        signal: new AbortController().signal,
        failedChecks: () => ["known incorrect 1 passes visible: one visible case failed"],
        playable: (value) => (value as { status: string }).status === "playable",
        complete: async (_candidate, _failures, previous) => { feedback.push(previous); return replies.shift()!; },
        validate: async (candidate) => { validated.push(candidate); return { status: "playable" }; },
        progress: () => undefined,
      },
    );
    expect(feedback).toEqual(["", "It contained no usable JSON changes", "It did not change the rejected candidate"]);
    expect(validated).toHaveLength(1);
    expect(result).toMatchObject({ attempts: 3, repairError: null, value: { status: "playable" } });
    expect(result.input).toEqual({ title: "Keep the learner's target", referenceFiles: { "src/index.js": "fixed" } });
  });

  it("does not retry a session lifecycle rejection", async () => {
    let called = false;
    const result = await repairQuestionUntilValid({}, { status: "invalid" }, {
      limit: 4,
      signal: new AbortController().signal,
      failedChecks: () => ["session lifecycle: another challenge is active"],
      playable: () => false,
      complete: async () => { called = true; return "{}"; },
      validate: async () => ({ status: "playable" }),
      progress: () => undefined,
    });
    expect(called).toBe(false);
    expect(result.attempts).toBe(0);
  });

  it("feeds the next validation failure back into the same retained candidate", async () => {
    const diagnostics: string[] = [];
    const result = await repairQuestionUntilValid(
      { title: "Next smaller positions", referenceFiles: { "src/solve.js": "old" }, visibleTests: { "test.js": "old" } },
      { status: "invalid", failure: "reference failed" },
      {
        limit: 4,
        signal: new AbortController().signal,
        failedChecks: (value) => [(value as { failure: string }).failure],
        playable: (value) => (value as { status: string }).status === "playable",
        complete: async (_candidate, failures) => {
          diagnostics.push(failures[0]!);
          return diagnostics.length === 1
            ? '{"referenceFiles":{"src/solve.js":"correct"}}'
            : '{"visibleTests":{"test.js":"correct"}}';
        },
        validate: async (candidate) => candidate.visibleTests && (candidate.visibleTests as Record<string, string>)["test.js"] === "correct"
          ? { status: "playable" }
          : { status: "invalid", failure: "known incorrect fails visible" },
        progress: () => undefined,
      },
    );
    expect(diagnostics).toEqual(["reference failed", "known incorrect fails visible"]);
    expect(result.input).toEqual({ title: "Next smaller positions", referenceFiles: { "src/solve.js": "correct" }, visibleTests: { "test.js": "correct" } });
    expect(result).toMatchObject({ attempts: 2, value: { status: "playable" } });
  });
});
