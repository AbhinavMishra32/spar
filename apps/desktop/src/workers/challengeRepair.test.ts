import { describe, expect, it } from "vitest";
import { mergeQuestionChanges, parseRepairChanges } from "./challengeRepair.js";

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
});
