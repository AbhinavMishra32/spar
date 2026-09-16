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

/* The agent's own earlier readings of the learner, handed back to it.
   Both of these were written on every attempt-complete turn and read by nothing
   but the learner's screens, so a finding could be recorded indefinitely and
   never confirmed — only rewritten under a new id on the next attempt. */
describe("reading back what the agent already worked out", () => {
  const observed = (store: LocalStore, sessionId: string, attemptId: string, abilityId: string, statement: string, patternStatus: "observation" | "pattern", alsoLink: string[] = []) => {
    const event = store.appendNextEvent({ id: randomUUID(), attemptId, type: "submission_evaluated", occurredAt: new Date().toISOString(), payload: { outcome: "failed" }, source: "system", schemaVersion: 1 });
    store.updateAbility({
      abilityId,
      markdown: `# Variable-window restoration\n\n${statement}`,
      evidenceEventIds: [event.id],
      evidence: [{ eventId: event.id, statement, polarity: "contradictory", independence: "independent", strength: 0.7 }],
      pattern: { title: "Stops after one shrink", description: "The window is restored once and the loop moves on.", status: patternStatus, evidenceEventIds: [...alsoLink, event.id] },
    });
    return event.id;
  };

  it("returns the open patterns and the behavioural evidence beside the ability document", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise variable windows");
      const target = store.setTrainingTarget(sessionId, { ability: "Variable-window restoration", specificGap: "Repeated shrinking", desiredEvidence: "Restores across several shrinks", avoidTesting: [] });
      const question = store.createQuestion(sessionId, design("Shrink until valid"), { valid: true });
      const eventId = observed(store, sessionId, question.attemptId, target.abilityId, "Restored the invariant once and moved on, so the two cases needing a second shrink failed.", "observation");

      const result = await executeTrainingTool("read_ability", { abilityId: target.abilityId }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { ability: unknown; patterns: Array<{ title: string; status: string }>; evidence: Array<{ eventId: string | null; statement: string }> };
      expect(result.ability).toBeTruthy();
      expect(result.patterns).toMatchObject([{ title: "Stops after one shrink", status: "observation" }]);
      expect(result.evidence[0]).toMatchObject({ eventId, statement: expect.stringContaining("second shrink") });
    } finally {
      store.close();
    }
  });

  it("finds an earlier hypothesis through the learner-model search, so a second sighting can promote it", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise variable windows");
      const target = store.setTrainingTarget(sessionId, { ability: "Variable-window restoration", specificGap: "Repeated shrinking", desiredEvidence: "Restores across several shrinks", avoidTesting: [] });
      const first = store.createQuestion(sessionId, design("Shrink until valid"), { valid: true });
      const firstEvent = observed(store, sessionId, first.attemptId, target.abilityId, "Restored the invariant once and stopped shrinking.", "pattern");
      store.completeAttempt(first.attemptId, "failed");
      /* One attempt cannot make a pattern, by design — so this is exactly the
         state the next turn has to be able to find and finish. */
      expect(store.listPatterns()[0]?.status).toBe("hypothesis");

      const found = await executeTrainingTool("search_learner_model", { query: "window invariant restoration shrinking" }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { passages: unknown[]; patterns: Array<{ title: string; status: string }>; evidence: Array<{ statement: string }> };
      expect(found.passages).not.toHaveLength(0);
      expect(found.patterns).toMatchObject([{ title: "Stops after one shrink", status: "hypothesis" }]);
      expect(found.evidence[0]?.statement).toContain("stopped shrinking");

      /* Promotion needs both events named in the same call, which is the whole
         reason the first one has to be findable: an agent that cannot retrieve
         its own earlier observation can only ever link the attempt in front of
         it, and the host will refuse that for as long as it keeps happening. */
      const second = store.createQuestion(sessionId, design("Shrink an event stream"), { valid: true });
      observed(store, sessionId, second.attemptId, target.abilityId, "The same single-shrink restoration appeared in a different structure.", "pattern", [firstEvent]);
      expect(store.listPatterns()[0]).toMatchObject({ status: "pattern", evidenceCount: 2 });
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

/**
 * One call, everything about the attempt.
 *
 * This was four tools — two of them the same handler under different names —
 * and a turn that wanted to know how the learner was doing paid a host round
 * trip for each. What the merge has to keep is that none of what any of them
 * returned went missing: the log, the code, and the raw events whose ids are
 * what an ability update cites as its evidence.
 */
describe("read_attempt", () => {
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

      const result = await executeTrainingTool("read_attempt", { attemptId }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { report: string; stats: { runs: number; regressions: number } };

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
      const result = await executeTrainingTool("read_attempt", { attemptId: randomUUID() }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { report: string; stats: null };

      expect(result.report).toContain("no log to read");
      expect(result.stats).toBeNull();
    } finally {
      store.close();
    }
  });

  /* The three halves of the old arrangement, in one result. `events` carries the
     ids `propose_ability_update` cites as evidence, so losing it to the merge
     would have quietly broken every ability update; `files` is the code the two
     read tools existed to hand over; `stats` is the runner's own verdict, which
     the model is never allowed to form its own opinion of. */
  it("hands back the code and the raw events beside the log", async () => {
    const store = new LocalStore(":memory:");
    const workspaces = {
      list: async () => ["src/count.js"],
      read: async () => "export function count(values, threshold) {\n  return 0;\n}\n",
    } as unknown as WorkspaceService;
    try {
      const { sessionId } = store.createSession("Practise arrays");
      store.setTrainingTarget(sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts matching values", avoidTesting: [] });
      const question = store.createQuestion(sessionId, design("Count values above a threshold"), { valid: true });

      const result = await executeTrainingTool("read_attempt", { attemptId: question.attemptId }, sessionId, store, workspaces, {} as UtilityClient) as {
        files: Array<{ path: string; text: string }>;
        events: Array<{ id: string }>;
        solve: { path: string } | null;
        stats: { outcome: string };
        report: string;
      };

      expect(result.files).toEqual([{ path: "src/count.js", text: "export function count(values, threshold) {\n  return 0;\n}\n" }]);
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.events.every((event) => typeof event.id === "string" && event.id.length > 0)).toBe(true);
      expect(result.solve?.path).toBe("src/count.js");
      expect(result.stats.outcome).toBe("in-progress");
      /* The transcript keeps only the first 16k of this serialised, and draws
         the attempt panel out of the report — so the report must be written
         before the two fields that exist for the model alone. */
      const order = Object.keys(result as object);
      expect(order.indexOf("report")).toBeLessThan(order.indexOf("files"));
      expect(order.indexOf("report")).toBeLessThan(order.indexOf("events"));
    } finally {
      store.close();
    }
  });

  /**
   * The workspace outlives the challenge; the attempt does not.
   *
   * A session's third problem is solved in the same directory as its first two,
   * so listing that directory handed the agent whichever file the filesystem
   * named first — and the learner watched their tutor open "your attempt" and
   * read a function from two challenges ago. What this attempt saved is the only
   * thing this attempt is about.
   */
  it("preserves large reads and all evidence IDs without duplicating raw payloads", async () => {
    const store = new LocalStore(":memory:");
    const workspaces = { list: async () => ["a.py", "b.py", "c.py"], read: async () => "x".repeat(30_000) } as unknown as WorkspaceService;
    try {
      const { sessionId } = store.createSession("Practise arrays");
      store.setTrainingTarget(sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts matching values", avoidTesting: [] });
      const question = store.createQuestion(sessionId, design("Count values"), { valid: true });
      for (let i = 0; i < 120; i++) store.appendNextEvent({ id: randomUUID(), attemptId: question.attemptId, type: "test_run", occurredAt: new Date().toISOString(), payload: { scope: "visible", passed: false, cases: [{ name: "large failure", status: "failed", expected: "x".repeat(10_000), actual: "y".repeat(10_000) }] }, source: "runner", schemaVersion: 1 });
      const result = await executeTrainingTool("read_attempt", {}, sessionId, store, workspaces, {} as UtilityClient) as { report: string; files: Array<{ text: string }>; events: Array<{ id: string; payload?: unknown }>; stats: { runs: number } };
      expect(result.report).toContain("x".repeat(10_000));
      expect(result.report).toContain("y".repeat(10_000));
      expect(result.files.map((file) => file.text.length)).toEqual([30_000, 30_000, 30_000]);
      expect(result.events).toHaveLength(store.readAttempt(question.attemptId).length);
      const ids = new Set(store.readAttempt(question.attemptId).map((event) => event.id));
      expect(result.events.every((event) => ids.has(event.id) && event.payload === undefined)).toBe(true);
      expect(result.stats.runs).toBe(120);
      expect(result.report).not.toContain("omitted");
    } finally { store.close(); }
  });

  it("reads only the files this attempt touched, most recently saved first", async () => {
    const store = new LocalStore(":memory:");
    const bodies: Record<string, string> = {
      "src/min_subarray.js": "export function minSubarray() {\n  return 0;\n}\n",
      "src/count.js": "export function count() {\n  return 0;\n}\n",
      "src/helpers.js": "export const noop = () => {};\n",
    };
    const workspaces = {
      list: async () => Object.keys(bodies),
      read: async (_session: string, path: string) => bodies[path] ?? "",
    } as unknown as WorkspaceService;
    try {
      const { sessionId } = store.createSession("Practise arrays");
      store.setTrainingTarget(sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts matching values", avoidTesting: [] });
      const question = store.createQuestion(sessionId, design("Count values above a threshold"), { valid: true });
      const attemptId = question.attemptId;
      const opened = Date.parse(store.readAttempt(attemptId)[0]!.occurredAt);
      const save = (path: string, seconds: number) =>
        store.appendNextEvent({ id: randomUUID(), attemptId, type: "file_changed" as never, occurredAt: new Date(opened + seconds * 1_000).toISOString(), payload: { path }, source: "learner", schemaVersion: 1 });

      save("src/count.js", 30);
      save("src/helpers.js", 60);
      save("src/count.js", 90);

      const result = await executeTrainingTool("read_attempt", { attemptId }, sessionId, store, workspaces, {} as UtilityClient) as {
        files: Array<{ path: string }>;
        solve: { path: string } | null;
      };

      // The file from the earlier challenge is not part of this attempt.
      expect(result.files.map((file) => file.path)).toEqual(["src/count.js", "src/helpers.js"]);
      // And the one they were last in is the solve the transcript draws.
      expect(result.solve?.path).toBe("src/count.js");
    } finally {
      store.close();
    }
  });

  /* The id the model used to have to carry out of the context and into every
     call, and got wrong. Omitting it means the attempt in front of the learner. */
  it("reads the attempt the learner has open when no id is given", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise arrays");
      store.setTrainingTarget(sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts matching values", avoidTesting: [] });
      store.createQuestion(sessionId, design("Count values above a threshold"), { valid: true });

      const result = await executeTrainingTool("read_attempt", {}, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { report: string; stats: { runs: number } | null };

      expect(result.report).toContain("SOLVE LOG — Count values above a threshold");
      expect(result.stats?.runs).toBe(0);
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
