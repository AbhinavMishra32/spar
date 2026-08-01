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
