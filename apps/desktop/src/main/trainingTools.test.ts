import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LocalStore } from "./store.js";
import { executeTrainingTool } from "./trainingTools.js";
import type { UtilityClient } from "./utilityClient.js";
import type { WorkspaceService } from "./workspaces.js";

describe("Training Agent learner suspension", () => {
  it("persists ask_user_question as structured intake without duplicating chat", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Prepare for an AI engineer interview");
      await executeTrainingTool("ask_user_question", {
        questions: [{
          header: "Experience",
          question: "How much Python and machine-learning experience do you have?",
          options: [
            { label: "New to both", description: "Start with programming and ML prerequisites." },
            { label: "Some experience", description: "Calibrate with a small applied task." },
          ],
          multiple: false,
          custom: true,
        }],
      }, sessionId, store, {} as WorkspaceService, {} as UtilityClient);

      const detail = store.readSession(sessionId);
      expect(detail?.pendingLearnerQuestion?.questions[0]?.header).toBe("Experience");
      expect(detail?.messages).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("refuses a second question after a session has a playable challenge", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise arrays");
      store.setTrainingTarget(sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts matching values", avoidTesting: [] });
      store.createQuestion(sessionId, design("Count values"), { valid: true });
      const result = await executeTrainingTool("create_question", { title: "Another question" }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { status: string; report: { checks: Array<{ name: string }> } };
      expect(result.status).toBe("invalid");
      expect(result.report.checks[0]?.name).toBe("session lifecycle");
    } finally {
      store.close();
    }
  });
});

describe("replay_attempt", () => {
  it("returns the attempt log with every case inside every run", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise arrays");
      store.setTrainingTarget(sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts matching values", avoidTesting: [] });
      const question = store.createQuestion(sessionId, design("Count values above a threshold"), { valid: true });
      const attemptId = question.attemptId;
      // Offsets in the report are measured from the attempt's own first event.
      const opened = Date.parse(store.readAttempt(attemptId)[0]!.occurredAt);
      const append = (type: string, seconds: number, payload: Record<string, unknown>, source: "learner" | "runner" | "system" = "runner") =>
        store.appendNextEvent({ id: randomUUID(), attemptId, type: type as never, occurredAt: new Date(opened + seconds * 1_000).toISOString(), payload, source, schemaVersion: 1 });

      append("file_changed", 60, { path: "src/count.js", bytes: 120 }, "learner");
      append("test_run", 120, { scope: "visible", passed: false, passedCases: 1, failedCases: 1, cases: [{ name: "counts positives", status: "passed" }, { name: "ignores the threshold itself", status: "failed", expected: "2", actual: "3" }] });
      append("test_run", 300, { scope: "visible-and-hidden", passed: false, passedCases: 2, failedCases: 1, cases: [{ name: "counts positives", status: "passed" }, { name: "ignores the threshold itself", status: "passed" }, { name: "handles an empty array", status: "failed", expected: "0", actual: "NaN" }] });

      const result = await executeTrainingTool("replay_attempt", { attemptId }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { report: string; stats: { runs: number; regressions: number } };

      expect(result.report).toContain("SOLVE LOG — Count values above a threshold (javascript)");
      // The log itself: the learner's save, both runs, and every case inside them.
      expect(result.report).toContain("file_changed         src/count.js bytes=120");
      expect(result.report).toContain("FAIL  ignores the threshold itself  expected 2, got 3");
      expect(result.report).toContain("FAIL  handles an empty array  expected 0, got NaN");
      // A case only the submission ran is absent earlier rather than failing.
      expect(result.report).toMatch(/"handles an empty array"\s+- F/);
      expect(result.report).toContain("first passed after failing at +05:00");
      expect(result.stats.runs).toBe(2);
      expect(result.stats.regressions).toBe(0);
    } finally {
      store.close();
    }
  });

  it("says plainly that there is nothing to read rather than inventing a trace", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise arrays");
      const result = await executeTrainingTool("replay_attempt", { attemptId: randomUUID() }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { report: string; stats: null };

      expect(result.report).toContain("no log to read");
      expect(result.stats).toBeNull();
    } finally {
      store.close();
    }
  });
});

function design(title: string) {
  return {
    title,
    language: "javascript" as const,
    kind: "function" as const,
    difficulty: "foundation" as const,
    statement: "Count values in a simple JavaScript array and return the resulting total.",
    starterFiles: { "src/count.js": "" },
    referenceFiles: { "src/count.js": "" },
    visibleTests: { "test/count.test.js": "" },
    hiddenTests: { "test/count.hidden.test.js": "" },
    knownIncorrectFiles: [{ "src/count.js": "" }],
    runCommand: "node --test",
    accidentalDifficulty: [],
    expectedFailureSignatures: ["off by one"],
  };
}
