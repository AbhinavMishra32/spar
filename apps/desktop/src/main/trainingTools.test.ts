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
            { label: "New to both — start with the programming and ML prerequisites" },
            { label: "Some experience — calibrate with a small applied task" },
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

/* The learner-reported failure this covers: four unrelated goals in a row — a
   Google interview, TypeScript, C++, and "hii" — each opened with another
   off-by-one loop repair, because one ability in the ledger answered every
   retrieval and the host only ever checked for repetition inside one session. */
describe("challenge coverage across the whole library", () => {
  const seedSaturated = (store: LocalStore, count: number) => {
    for (let index = 0; index < count; index += 1) {
      const { sessionId } = store.createSession(`Earlier goal ${index + 1}`);
      store.setTrainingTarget(sessionId, { ability: "Loop boundary tracing", specificGap: "Stops one short", desiredEvidence: "Exact stop", avoidTesting: [] });
      store.createQuestion(sessionId, design(`Stop the loop exactly ${index + 1}`), { valid: true }, { concepts: [{ slug: "loop-boundary-tracing", role: "primary" }] });
    }
  };

  it("refuses a title the learner has already been asked in another session", async () => {
    const store = new LocalStore(":memory:");
    try {
      const first = store.createSession("Practise arrays");
      store.setTrainingTarget(first.sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts values", avoidTesting: [] });
      store.createQuestion(first.sessionId, design("Count values above a threshold"), { valid: true });

      const second = store.createSession("i wanna pass a google interview");
      store.setTrainingTarget(second.sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts values", avoidTesting: [] });
      const result = await executeTrainingTool("create_question", { title: "Count values above a threshold" }, second.sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { status: string; report: { checks: Array<{ name: string; detail: string }> } };

      expect(result.status).toBe("invalid");
      expect(result.report.checks[0]?.name).toBe("adaptive progression");
    } finally {
      store.close();
    }
  });

  it("refuses a first challenge on the concept the last three were about when the goal never named it", async () => {
    const store = new LocalStore(":memory:");
    try {
      seedSaturated(store, 3);
      const { sessionId } = store.createSession("i wanna pass a google interview");
      store.setTrainingTarget(sessionId, { ability: "Loop boundary tracing", specificGap: "Stops one short", desiredEvidence: "Exact stop", avoidTesting: [] });
      const result = await executeTrainingTool("create_question", { title: "Fix the loop that skips the last multiple", concepts: [{ slug: "loop-boundary-tracing", role: "primary" }] }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { status: string; report: { checks: Array<{ name: string; detail: string }> } };

      expect(result.status).toBe("invalid");
      expect(result.report.checks[0]?.name).toBe("goal coverage");
      expect(result.report.checks[0]?.detail).toContain("does not name it");
    } finally {
      store.close();
    }
  });

  it("still lets the learner drill the same concept when their goal asks for it", async () => {
    const store = new LocalStore(":memory:");
    try {
      seedSaturated(store, 3);
      // The wording a drill started from an ability card is created with.
      const { sessionId } = store.createSession("I want to go deeper on loop boundary tracing.");
      store.setTrainingTarget(sessionId, { ability: "Loop boundary tracing", specificGap: "Stops one short", desiredEvidence: "Exact stop", avoidTesting: [] });
      const result = await executeTrainingTool("create_question", { title: "Hold the boundary under a shrinking window", concepts: [{ slug: "loop-boundary-tracing", role: "primary" }] }, sessionId, store, {} as WorkspaceService, {} as UtilityClient).catch((error: Error) => error) as { report?: { checks: Array<{ name: string }> } };

      // Whatever the compiler goes on to say about the candidate, coverage is not
      // what stopped it.
      expect(result.report?.checks?.[0]?.name).not.toBe("goal coverage");
    } finally {
      store.close();
    }
  });

  it("leaves a session's later challenges alone, because staying on a concept is how teaching works", async () => {
    const store = new LocalStore(":memory:");
    try {
      seedSaturated(store, 3);
      const { sessionId } = store.createSession("i wanna pass a google interview");
      store.setTrainingTarget(sessionId, { ability: "Loop boundary tracing", specificGap: "Stops one short", desiredEvidence: "Exact stop", avoidTesting: [] });
      const opening = store.createQuestion(sessionId, design("Trace the window that never closes"), { valid: true }, { concepts: [{ slug: "loop-boundary-tracing", role: "primary" }] });
      store.completeAttempt(opening.attemptId, "passed");

      const result = await executeTrainingTool("create_question", { title: "Restore the boundary after a shrink", concepts: [{ slug: "loop-boundary-tracing", role: "primary" }] }, sessionId, store, {} as WorkspaceService, {} as UtilityClient).catch((error: Error) => error) as { report?: { checks: Array<{ name: string }> } };

      expect(result.report?.checks?.[0]?.name).not.toBe("goal coverage");
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

/**
 * The loop this prevents: submitting completes the attempt, and every lifecycle
 * guard read the still-present question as "a challenge is already active" — so
 * the turn whose whole job is to publish the next challenge was refused fifteen
 * times, then refused its fallback, and the session stalled with nothing to do.
 */
describe("challenge lifecycle after a solve", () => {
  it("publishes the next challenge once the attempt is complete", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise loops");
      store.setTrainingTarget(sessionId, { ability: "Loops", specificGap: "Boundaries", desiredEvidence: "Stops on an exact hit", avoidTesting: [] });
      const solved = store.createQuestion(sessionId, design("Repair the stopping boundary"), { valid: true });

      // While the learner is on it, a second challenge is correctly refused.
      const during = await executeTrainingTool("create_question", { title: "Something else" }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { status: string; report: { checks: Array<{ name: string; detail: string }> } };
      expect(during.status).toBe("invalid");
      expect(during.report.checks[0]?.detail).toContain("already active");

      store.completeAttempt(solved.attemptId, "passed");

      // And once it is solved the lifecycle no longer blocks the next one: the
      // candidate reaches validation, which is where a candidate belongs. It is
      // still rejected here — the stub runner passes every run, so the
      // misconception never fails its hidden tests — but for its design rather
      // than for the session's state.
      const after = await executeTrainingTool("create_question", design("Transfer the boundary fix"), sessionId, store, workspaceStub(), passingRunner()) as { status: string; report: { checks: Array<{ name: string; passed: boolean; detail: string }> } };

      expect(after.report.checks.map((check) => check.detail).join(" ")).not.toContain("already active");
      expect(after.report.checks.some((check) => check.name.includes("fails hidden") && !check.passed)).toBe(true);
    } finally {
      store.close();
    }
  });
});

/** Enough of the sandbox for a compilation to run without touching a disk. */
function workspaceStub(): WorkspaceService {
  return { writeValidation: async () => "/tmp/spar-test", removeValidation: async () => undefined, writeAll: async () => undefined } as unknown as WorkspaceService;
}

/** Every run passes, which is exactly what a candidate must not be able to do. */
function passingRunner(): UtilityClient {
  return { request: () => ({ id: "run", promise: Promise.resolve({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 }) }) } as unknown as UtilityClient;
}

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
