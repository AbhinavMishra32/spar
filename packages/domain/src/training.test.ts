import { describe, expect, it } from "vitest";
import { challengeRequiresComplexityCheckpoint, questionDesignSchema } from "./training.js";

const design = {
  title: "Trace an event transition",
  language: "typescript",
  kind: "repair",
  statement: "Repair the transition so the next state preserves every event in the original order.",
  starterFiles: { "src/state.ts": "export const next = () => [];" },
  referenceFiles: { "src/state.ts": "export const next = (events: unknown[]) => [...events];" },
  visibleTests: { "tests/visible.test.ts": "// visible" },
  hiddenTests: { "tests/hidden.test.ts": "// hidden" },
  knownIncorrectFiles: [{ "src/state.ts": "export const next = () => [];" }],
  runCommand: "node --test",
  accidentalDifficulty: [],
  expectedFailureSignatures: ["drops queued events"],
} as const;

describe("challenge complexity capability", () => {
  it("keeps legacy challenges readable without guessing that they require analysis", () => {
    const parsed = questionDesignSchema.parse(design);
    expect(parsed.requiresComplexityAnalysis).toBeUndefined();
    expect(challengeRequiresComplexityCheckpoint(parsed, true)).toBe(false);
  });

  it("requires both the authored capability and the global setting", () => {
    const parsed = questionDesignSchema.parse({ ...design, requiresComplexityAnalysis: true });
    expect(challengeRequiresComplexityCheckpoint(parsed, true)).toBe(true);
    expect(challengeRequiresComplexityCheckpoint(parsed, false)).toBe(false);
  });
});
