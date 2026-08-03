import { describe, expect, it } from "vitest";
import { foldAttempt, formatSolveLog, type ReplayEvent } from "./attemptReplay.js";

const START = Date.parse("2026-08-03T10:00:00.000Z");

let sequence = 0;
function event(type: string, minutes: number, payload: Record<string, unknown> = {}, source = "learner"): ReplayEvent {
  sequence += 1;
  return {
    id: `e${sequence}`,
    sequence: sequence - 1,
    type,
    occurredAt: new Date(START + minutes * 60_000).toISOString(),
    payload,
    source,
  };
}

function testCase(name: string, status: string, extra: Record<string, unknown> = {}) {
  return { name, status, ...extra };
}

/**
 * One realistic attempt: reads for a while, runs the visible cases twice fixing
 * one of them, submits and meets two hidden cases, fixes one of those while
 * breaking a case that had been passing, then submits again and is graded.
 */
function attempt(): ReplayEvent[] {
  sequence = 0;
  return [
    event("attempt_started", 0, { questionId: "q1" }, "system"),
    event("file_changed", 4, { path: "src/window.js", bytes: 210 }),
    event("file_changed", 5, { path: "src/window.js", bytes: 240 }),
    event("test_run", 6, {
      scope: "visible",
      exitCode: 1,
      passed: false,
      passedCases: 1,
      failedCases: 1,
      cases: [
        testCase("counts an empty window", "passed"),
        testCase("shrinks on an equal value", "failed", { expected: "2", actual: "3", message: "Expected values to be strictly equal:" }),
      ],
    }, "runner"),
    event("file_changed", 8, { path: "src/window.js", bytes: 268 }),
    event("test_run", 9, {
      scope: "visible",
      exitCode: 0,
      passed: true,
      passedCases: 2,
      failedCases: 0,
      cases: [testCase("counts an empty window", "passed"), testCase("shrinks on an equal value", "passed")],
    }, "runner"),
    event("submission_created", 10, { questionId: "q1" }),
    event("test_run", 10, {
      scope: "visible-and-hidden",
      exitCode: 1,
      passed: false,
      durationMs: 1_551,
      passedCases: 2,
      failedCases: 2,
      cases: [
        testCase("counts an empty window", "passed"),
        testCase("shrinks on an equal value", "passed"),
        testCase("restores after two removals", "failed", { expected: "[ 30 ]", actual: "[ 29 ]" }),
        testCase("handles a single element", "failed", { expected: "1", actual: "0" }),
      ],
    }, "runner"),
    event("submission_evaluated", 10, { outcome: "failed", exitCode: 1 }, "system"),
    event("attempt_completed", 10, { outcome: "failed" }, "system"),
    event("file_changed", 24, { path: "src/window.js", bytes: 302 }),
    event("test_run", 25, {
      scope: "visible-and-hidden",
      exitCode: 1,
      passed: false,
      passedCases: 3,
      failedCases: 1,
      cases: [
        testCase("counts an empty window", "passed"),
        testCase("shrinks on an equal value", "failed", { expected: "2", actual: "1" }),
        testCase("restores after two removals", "passed"),
        testCase("handles a single element", "passed"),
      ],
    }, "runner"),
  ];
}

describe("foldAttempt", () => {
  it("follows each case across every run rather than keeping only the last verdict", () => {
    const replay = foldAttempt(attempt(), { title: "Restore the window", language: "javascript" });
    const byName = new Map(replay.cases.map((item) => [item.name, item]));

    expect(byName.get("counts an empty window")?.verdicts).toEqual(["passed", "passed", "passed", "passed"]);
    expect(byName.get("shrinks on an equal value")?.verdicts).toEqual(["failed", "passed", "passed", "failed"]);
    // Hidden cases do not exist in a visible run, which is not the same as failing.
    expect(byName.get("restores after two removals")?.verdicts).toEqual(["absent", "absent", "failed", "passed"]);
  });

  it("counts a case that passed and then failed again as a regression", () => {
    const replay = foldAttempt(attempt());
    const regressed = replay.cases.filter((item) => item.regressed).map((item) => item.name);

    expect(regressed).toEqual(["shrinks on an equal value"]);
    expect(replay.stats.regressions).toBe(1);
    expect(replay.runs.at(-1)?.broke).toEqual(["shrinks on an equal value"]);
    expect(replay.runs.at(-1)?.fixed).toEqual(["restores after two removals", "handles a single element"]);
  });

  it("marks a case first seen in a submission as hidden, and a visible one as not", () => {
    const replay = foldAttempt(attempt());
    const hidden = replay.cases.filter((item) => item.hidden).map((item) => item.name);

    expect(hidden).toEqual(["restores after two removals", "handles a single element"]);
  });

  it("records when a case was fixed and how many failures it took", () => {
    const replay = foldAttempt(attempt());
    const fixed = replay.cases.find((item) => item.name === "restores after two removals");

    expect(fixed?.failures).toBe(1);
    expect(fixed?.fixedAtMs).toBe(25 * 60_000);
    expect(fixed?.passedFirstTry).toBe(false);
  });

  it("collapses consecutive saves of one file into a single stretch of work", () => {
    const replay = foldAttempt(attempt());

    expect(replay.stats.saves).toBe(4);
    expect(replay.edits.map((edit) => [edit.path, edit.saves])).toEqual([
      ["src/window.js", 2],
      ["src/window.js", 1],
      ["src/window.js", 1],
    ]);
  });

  it("times everything from the attempt opening and finds the longest quiet stretch", () => {
    const replay = foldAttempt(attempt());

    expect(replay.stats.timeToFirstRunMs).toBe(6 * 60_000);
    expect(replay.stats.longestGapMs).toBe(14 * 60_000);
    expect(replay.stats.runs).toBe(4);
    expect(replay.stats.submissions).toBe(2);
    expect(replay.stats.outcome).toBe("failed");
  });

  it("treats an attempt with no completion event as still open, timed to now", () => {
    const events = attempt().filter((entry) => entry.type !== "attempt_completed");
    const replay = foldAttempt(events, { now: START + 40 * 60_000 });

    expect(replay.open).toBe(true);
    expect(replay.stats.outcome).toBe("in-progress");
    expect(replay.stats.elapsedMs).toBe(40 * 60_000);
  });

  it("names submitting before ever running the visible cases", () => {
    const blind = [
      event("attempt_started", 0, {}, "system"),
      event("test_run", 3, { scope: "visible-and-hidden", passed: false, cases: [testCase("a", "failed")] }, "runner"),
    ];
    sequence = 0;

    expect(foldAttempt(blind).stats.submittedBlind).toBe(true);
    expect(foldAttempt(attempt()).stats.submittedBlind).toBe(false);
  });

  it("keeps raw output only for a run that reported no cases at all", () => {
    sequence = 0;
    const cpp = [
      event("attempt_started", 0, {}, "system"),
      event("test_run", 2, { scope: "visible", passed: false, cases: [], summary: "tests/visible.test.cpp:9: assertion failed\nmore" }, "runner"),
    ];

    expect(foldAttempt(cpp).runs[0]?.rawSummary).toBe("tests/visible.test.cpp:9: assertion failed");
  });
});

describe("formatSolveLog", () => {
  it("writes every recorded event as its own line, with a line per test case in a run", () => {
    const log = formatSolveLog(foldAttempt(attempt(), { title: "Restore the window", language: "javascript" }), { sections: ["log"] });

    expect(log).toContain("SOLVE LOG — Restore the window (javascript)");
    // Nothing is summarised away: the saves, the runs, the grade are all present.
    expect(log).toContain("learner file_changed         src/window.js bytes=210");
    expect(log).toContain("learner submission_created   questionId=q1");
    expect(log).toContain("system  submission_evaluated outcome=failed exitCode=1");
    expect(log).toContain("system  attempt_completed    outcome=failed");
    expect(log).toMatch(/test_run\s+scope=visible exit=1 1\/2 passed/);
    expect(log).toContain("FAIL  shrinks on an equal value  expected 2, got 3");
    expect(log).toContain("PASS  counts an empty window");
    // Derived sections are opt-in, so a caller that asked for the log gets the log.
    expect(log).not.toContain("CASE HISTORY");
  });

  it("keeps only the requested event types when the log is narrowed", () => {
    const log = formatSolveLog(foldAttempt(attempt()), { sections: ["log"], events: ["test_run"] });

    expect(log).toContain("Filtered to event types: test_run.");
    expect(log).toContain("test_run");
    expect(log).not.toContain("file_changed");
  });

  it("drops expected/actual from case lines on brief", () => {
    const log = formatSolveLog(foldAttempt(attempt()), { sections: ["log"], caseDetail: "brief" });

    expect(log).toContain("FAIL  shrinks on an equal value");
    expect(log).not.toContain("expected 2, got 3");
  });

  it("transposes each case across the runs, with its counts and nothing more", () => {
    const log = formatSolveLog(foldAttempt(attempt()), { sections: ["cases"] });

    expect(log).toMatch(/"shrinks on an equal value"\s+F P P F\s+visible, 2 passes, 2 failures/);
    expect(log).toMatch(/"restores after two removals"\s+- - F P\s+hidden, 1 pass, 1 failure/);
    expect(log).toContain("failed again at +25:00");
  });

  it("reports each run's newly passing and newly failing cases", () => {
    const log = formatSolveLog(foldAttempt(attempt()), { sections: ["runs"] });

    expect(log).toContain(`+09:00   visible      2/2   newly passing: "shrinks on an equal value"`);
    expect(log).toContain(`newly failing: "shrinks on an equal value"`);
    expect(log).not.toContain("LOG (");
  });

  it("reports timings as measurements without saying what they mean", () => {
    const log = formatSolveLog(foldAttempt(attempt()), { sections: ["timings"] });

    expect(log).toContain("attempt opened to first run: 6m");
    expect(log).toContain("longest gap between two recorded events: 14m");
    expect(log).toContain("src/window.js, 2 saves");
  });

  it("filters to what happened after the last submission", () => {
    const log = formatSolveLog(foldAttempt(attempt()), { scope: "since-last-submission", sections: ["log", "runs"] });

    expect(log).toContain("Filtered to events after the last submission at +25:00");
    expect(log).not.toContain("+06:00");
  });

  it("filters the case history down to what is still failing", () => {
    const log = formatSolveLog(foldAttempt(attempt()), { sections: ["cases"], cases: "still-failing" });

    expect(log).toContain(`"shrinks on an equal value"`);
    expect(log).not.toContain(`"counts an empty window"`);
  });

  it("keeps the log within maxLines, saying how many it dropped", () => {
    const log = formatSolveLog(foldAttempt(attempt()), { sections: ["log"], maxLines: 4 });
    const body = log.split("\n").filter((line) => line.startsWith("  ") && !line.includes("omitted by maxLines"));

    expect(log).toMatch(/lines? omitted by maxLines/);
    expect(body).toHaveLength(4);
    // The tail is kept, so the most recent thing that happened is always present.
    expect(body.at(-1)).toContain("PASS  handles a single element");
  });
});
