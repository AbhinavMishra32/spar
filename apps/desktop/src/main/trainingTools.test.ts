import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LocalStore } from "./store.js";
import { executeTrainingTool } from "./trainingTools.js";
import { REVIEW_TARGET_MODE_KEY, reviewTargetMode } from "./reviewSession.js";
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

  it("finds an earlier hypothesis through the record search, so a second sighting can promote it", async () => {
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

      const found = await executeTrainingTool("search_record", { query: "window invariant restoration shrinking" }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { abilities: Array<{ id: string }>; patterns: Array<{ title: string; status: string }>; observations: Array<{ statement: string }>; challenges: unknown[]; note: string };
      expect(found.abilities.map((row) => row.id)).toContain(target.abilityId);
      expect(found.patterns).toMatchObject([{ title: "Stops after one shrink", status: "hypothesis" }]);
      expect(found.observations[0]?.statement).toContain("stopped shrinking");
      expect(found.note).toContain("promotes a hypothesis");

      const narrowed = await executeTrainingTool("search_record", { query: "window invariant restoration shrinking", kinds: ["patterns"] }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as Record<string, unknown>;
      expect(Object.keys(narrowed).sort()).toEqual(["note", "observations", "patterns"]);

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

describe("agent choice of challenge", () => {
  it("records a corrected target only when the new challenge validates", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practice stack reasoning");
      store.setTrainingTarget(sessionId, { ability: "Next greater positions", specificGap: "Untested index method", desiredEvidence: "Returns next greater indices", avoidTesting: [] });
      const candidate = {
        ...design("Repair streamed stack state"),
        language: "python" as const,
        kind: "repair" as const,
        starterFiles: { "solution.py": "broken" },
        referenceFiles: { "solution.py": "correct" },
        visibleTests: { "test_visible.py": "visible" },
        hiddenTests: { "test_hidden.py": "hidden" },
        knownIncorrectFiles: [{ "solution.py": "incorrect" }],
        why: "Transfer the known stack invariant into a streaming state repair.",
        trainingTarget: { ability: "Streaming stack state", specificGap: "State across chunks is untested", desiredEvidence: "Preserves unresolved indices across chunks", avoidTesting: [] },
      };
      await executeTrainingTool("create_question", candidate, sessionId, store, workspaceStub(), passingRunner());
      expect(store.latestTarget(sessionId)?.ability_title).toBe("Next greater positions");

      const visible = Array.from({ length: 4 }, (_, index) => `ok - visible ${index}`).join("\n");
      const hidden = Array.from({ length: 4 }, (_, index) => `ok - hidden ${index}`).join("\n");
      const outputs = [
        { exitCode: 0, stdout: `${visible}\n${hidden}\n`, stderr: "", durationMs: 1 },
        { exitCode: 0, stdout: `${visible}\n`, stderr: "", durationMs: 1 },
        { exitCode: 1, stdout: "not ok - retained across chunks\n    input: two chunks\n    expected: retained\n    actual: lost\n", stderr: "", durationMs: 1 },
        { exitCode: 0, stdout: `${visible}\n`, stderr: "", durationMs: 1 },
      ];
      const runner = { request: () => ({ id: "run", promise: Promise.resolve(outputs.shift()!) }) } as unknown as UtilityClient;
      const result = await executeTrainingTool("create_question", candidate, sessionId, store, workspaceStub(), runner) as { status: string };
      expect(result.status).toBe("playable");
      expect(store.latestTarget(sessionId)?.ability_title).toBe("Streaming stack state");
      expect(store.readSession(sessionId)?.question?.abilityTitle).toBe("Streaming stack state");
      expect(store.readSession(sessionId)?.question?.introductionReason).toBe("Transfer the known stack invariant into a streaming state repair.");
    } finally { store.close(); }
  });

  it("lets a repeated title reach validation", async () => {
    const store = new LocalStore(":memory:");
    try {
      const first = store.createSession("Practise arrays");
      store.setTrainingTarget(first.sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts values", avoidTesting: [] });
      store.createQuestion(first.sessionId, design("Count values above a threshold"), { valid: true });
      const second = store.createSession("Compare my new approach");
      store.setTrainingTarget(second.sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts values", avoidTesting: [] });
      const result = await executeTrainingTool("create_question", design("Count values above a threshold"), second.sessionId, store, workspaceStub(), passingRunner()) as { report: { checks: Array<{ name: string }> } };
      expect(result.report.checks[0]?.name).toBe("challenge file set");
    } finally { store.close(); }
  });

  it("lets a repeated concept reach validation even when the goal uses different words", async () => {
    const store = new LocalStore(":memory:");
    try {
      for (let index = 0; index < 3; index += 1) {
        const earlier = store.createSession(`Earlier goal ${index}`);
        store.setTrainingTarget(earlier.sessionId, { ability: "Loop boundary tracing", specificGap: "Stops one short", desiredEvidence: "Exact stop", avoidTesting: [] });
        store.createQuestion(earlier.sessionId, design(`Boundary ${index}`), { valid: true }, { concepts: [{ slug: "loop-boundary-tracing", role: "primary" }] });
      }
      const current = store.createSession("i wanna pass a google interview");
      store.setTrainingTarget(current.sessionId, { ability: "Loop boundary tracing", specificGap: "Stops one short", desiredEvidence: "Exact stop", avoidTesting: [] });
      const candidate = { ...design("Transfer the boundary"), concepts: [{ slug: "loop-boundary-tracing", role: "primary" }] };
      const result = await executeTrainingTool("create_question", candidate, current.sessionId, store, workspaceStub(), passingRunner()) as { report: { checks: Array<{ name: string }> } };
      expect(result.report.checks[0]?.name).toBe("challenge file set");
    } finally { store.close(); }
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
      expect(result.report).toMatch(/first passed after failing at \d{1,2}:\d{2}:\d{2}[ap]m/);
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

describe("reading one record", () => {
  it("reads a challenge, an ability and a lesson by id, and says plainly when there is none", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise arrays");
      const target = store.setTrainingTarget(sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts matching values", avoidTesting: [] });
      const question = store.createQuestion(sessionId, design("Count values"), { valid: true });
      const read = (input: Record<string, unknown>) => executeTrainingTool("read_record", input, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as Promise<Record<string, unknown>>;

      const challenge = await read({ kind: "challenge", id: question.id }) as { id: string; title: string; design: { starterFiles: unknown; hiddenTests?: unknown }; attempts: Array<{ id: string; events: number }> };
      expect(challenge).toMatchObject({ id: question.id, title: "Count values", design: { starterFiles: { "src/count.js": "" } } });
      expect(challenge.design).not.toHaveProperty("hiddenTests");
      expect(challenge.attempts.map((attempt) => attempt.id)).toEqual([question.attemptId]);
      expect(typeof challenge.attempts[0]?.events).toBe("number");

      store.updateAbility({ abilityId: target.abilityId, markdown: "# Arrays\n\nCounts in one pass.", evidenceEventIds: [] });
      const ability = await read({ kind: "ability", id: target.abilityId }) as { ability: { id: string }; patterns: unknown[]; evidence: unknown[] };
      expect(ability.ability.id).toBe(target.abilityId);
      expect(Array.isArray(ability.patterns) && Array.isArray(ability.evidence)).toBe(true);

      const lessonId = randomUUID();
      store.saveLesson({ id: lessonId, sessionId, title: "Counting", summary: "One pass", concepts: [], payload: { title: "Counting", body: "Walk once." } });
      expect(await read({ kind: "lesson", id: lessonId })).toMatchObject({ id: lessonId, title: "Counting", body: "Walk once." });

      expect(await read({ kind: "challenge", id: "missing" })).toMatchObject({ error: "not-found" });
      expect(await read({ kind: "ability", id: "missing" })).toMatchObject({ error: "not-found" });
      expect(await read({ kind: "lesson", id: "missing" })).toMatchObject({ error: "not-found" });
      expect(await read({ kind: "concept", id: "arrays" })).toHaveProperty("concepts");
      expect(await read({ kind: "nonsense", id: "x" })).toMatchObject({ error: "unknown-kind" });
    } finally {
      store.close();
    }
  });
});

describe("the coach's notebook tool", () => {
  it("saves a new version, reports an unchanged write, refuses an empty one, and hands back the previous text", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise graphs");
      const trackId = store.trackIdForSession(sessionId);
      const write = (input: Record<string, unknown>) => executeTrainingTool("update_notebook", input, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as Promise<Record<string, unknown>>;

      expect(await write({ markdown: "   " })).toMatchObject({ status: "invalid" });
      expect(store.readNotebook(trackId)).toBeNull();

      expect(await write({ markdown: "Forgets visited sets.", note: "first read" })).toEqual({ status: "saved", version: 1, note: "first read", markdown: "Forgets visited sets.", previous: null, previousAuthor: null });
      expect(await write({ markdown: "Forgets visited sets." })).toMatchObject({ status: "unchanged", version: 1, previous: null, previousAuthor: "coach" });

      store.writeNotebook(trackId, { markdown: "Forgets visited sets on grids.", author: "learner" });
      expect(await write({ markdown: "Forgets visited sets on grids and trees." })).toMatchObject({ status: "saved", version: 3, previous: "Forgets visited sets on grids.", previousAuthor: "learner" });
      expect(store.readNotebook(trackId)).toMatchObject({ version: 3, author: "coach", sessionId });
    } finally {
      store.close();
    }
  });
});

describe("update_ability", () => {
  it("introduces an ability by title, updates it by id, and refuses an unknown id or a missing title", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise recursion");
      const call = (input: Record<string, unknown>) => executeTrainingTool("update_ability", input, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as Promise<Record<string, unknown>>;

      expect(await call({ markdown: "# Something" })).toMatchObject({ committed: false });
      expect(await call({ abilityId: "missing", markdown: "# Something" })).toMatchObject({ committed: false, note: expect.stringContaining("No ability missing") });

      const created = await call({ title: "Base cases", markdown: "# Base cases\n\nStates the base case first.", evidenceEventIds: [] }) as { committed: boolean; id: string; version: number };
      expect(created.committed).toBe(true);
      expect(store.listAbilities(store.trackIdForSession(sessionId)).map((entry) => entry.title)).toContain("Base cases");

      const updated = await call({ abilityId: created.id, markdown: "# Base cases\n\nStates the base case before recurring.", evidenceEventIds: [] }) as { committed: boolean; id: string; version: number };
      expect(updated).toMatchObject({ committed: true, id: created.id });
      expect(updated.version).toBeGreaterThan(created.version);
    } finally {
      store.close();
    }
  });
});

describe("challenge_builder_context", () => {
  it("hands the builder the open design and the starters the learner was already given", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise arrays");
      const call = () => executeTrainingTool("challenge_builder_context", {}, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as Promise<{ preferredLanguage: string; open: Record<string, unknown> | null; recentStarters: Array<{ title: string; starter: { path: string } }> }>;
      expect(await call()).toMatchObject({ open: null, recentStarters: [] });

      store.setTrainingTarget(sessionId, { ability: "Arrays", specificGap: "Traverse values", desiredEvidence: "Counts matching values", avoidTesting: [] });
      store.createQuestion(sessionId, { ...design("Count values"), starterFiles: { "src/count.js": "export function count(values) {}" } }, { valid: true });
      const context = await call();
      expect(typeof context.preferredLanguage).toBe("string");
      expect(context.open).toMatchObject({ title: "Count values", language: "javascript", starterFiles: { "src/count.js": "export function count(values) {}" } });
      expect(context.recentStarters).toEqual([expect.objectContaining({ title: "Count values", starter: { path: "src/count.js", text: "export function count(values) {}" } })]);
    } finally {
      store.close();
    }
  });
});

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

/** The learner chose to say what their reviews ask about: a new card needs their answer. */
describe("filing an insight when the learner decides what to remember", () => {
  const card = {
    title: "Slide the window by one", trigger: "Aggregate over every block of the same length", insight: "Adjacent windows share all but one item, so update the sum instead of recomputing it.",
    click: { summary: "Moved the comparison outside the first-window loop." }, independence: "independent", pitfalls: [],
    rubric: ["add the incoming item", "drop the outgoing item"], transfer: ["Average of every block of k"], firstGrade: "good",
  };

  it("sends the agent to ask first, then keeps the learner's words on the card", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise windows");
      store.setTrainingTarget(sessionId, { ability: "Windows", specificGap: "Sliding", desiredEvidence: "Linear pass", avoidTesting: [] });
      const solved = store.createQuestion(sessionId, design("Window sums"), { valid: true });
      store.appendNextEvent({ id: randomUUID(), attemptId: solved.attemptId, type: "attempt_completed", occurredAt: new Date().toISOString(), payload: { outcome: "passed" }, source: "system", schemaVersion: 1 });
      store.setSetting(REVIEW_TARGET_MODE_KEY, "ask");

      const refused = await executeTrainingTool("record_insight", { ...card, attemptId: solved.attemptId }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { status: string; note: string };
      expect(refused.status).toBe("invalid");
      expect(refused.note).toContain("ask_user_question");

      const filed = await executeTrainingTool("record_insight", { ...card, attemptId: solved.attemptId, targets: ["turning-point"], remember: "Moving the max check after the first window is what fixed it" }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { status: string; cardId: string };
      expect(filed.status).toBe("filed");
      expect(store.reviews.card(filed.cardId)?.remember).toBe("Moving the max check after the first window is what fixed it");
      expect(store.reviews.card(filed.cardId)?.targets).toEqual(["turning-point"]);
    } finally {
      store.close();
    }
  });

  it("decides for them by default", async () => {
    const store = new LocalStore(":memory:");
    try {
      const { sessionId } = store.createSession("Practise windows");
      store.setTrainingTarget(sessionId, { ability: "Windows", specificGap: "Sliding", desiredEvidence: "Linear pass", avoidTesting: [] });
      const solved = store.createQuestion(sessionId, design("Window sums"), { valid: true });
      store.appendNextEvent({ id: randomUUID(), attemptId: solved.attemptId, type: "attempt_completed", occurredAt: new Date().toISOString(), payload: { outcome: "passed" }, source: "system", schemaVersion: 1 });
      expect(reviewTargetMode(store)).toBe("auto");
      const filed = await executeTrainingTool("record_insight", { ...card, attemptId: solved.attemptId }, sessionId, store, {} as WorkspaceService, {} as UtilityClient) as { status: string; cardId: string };
      expect(filed.status).toBe("filed");
      expect(store.reviews.card(filed.cardId)?.remember).toBeNull();
    } finally {
      store.close();
    }
  });
});
