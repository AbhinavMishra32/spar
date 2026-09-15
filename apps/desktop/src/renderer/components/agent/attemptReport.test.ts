import { describe, expect, it } from "vitest";

import { foldAttempt, formatSolveLog, type ReplayEvent } from "../../../shared/attemptReplay";
import { readAttempt } from "./attemptReport";

/**
 * The panel is drawn from the report the agent read, so the test is a round
 * trip: fold real events, print the log the tool prints, wrap it the way the
 * worker wraps it, and read it back. Nothing here asserts against a hand-typed
 * string — the day `formatSolveLog` changes a column, this fails rather than the
 * transcript quietly falling back to raw JSON.
 */

const START = Date.parse("2026-08-03T10:00:00.000Z");

let sequence = 0;
function event(type: string, minutes: number, payload: Record<string, unknown> = {}, source = "learner"): ReplayEvent {
  sequence += 1;
  return { id: `e${sequence}`, sequence: sequence - 1, type, occurredAt: new Date(START + minutes * 60_000).toISOString(), payload, source };
}

function attempt(): ReplayEvent[] {
  sequence = 0;
  return [
    event("attempt_started", 0, { questionId: "q1" }, "system"),
    event("file_changed", 4, { path: "src/window.js", bytes: 210 }),
    event("test_run", 6, {
      scope: "visible",
      passed: false,
      passedCases: 1,
      failedCases: 1,
      cases: [
        { name: "counts an empty window", status: "passed" },
        { name: "shrinks on an equal value", status: "failed", expected: "2", actual: "3" },
      ],
    }, "runner"),
    event("file_changed", 8, { path: "src/window.js", bytes: 268 }),
    event("submission_created", 10, { questionId: "q1" }),
    event("test_run", 10, {
      scope: "visible-and-hidden",
      passed: false,
      passedCases: 2,
      failedCases: 1,
      cases: [
        { name: "counts an empty window", status: "passed" },
        { name: "shrinks on an equal value", status: "passed" },
        { name: "restores after two removals", status: "failed", expected: "[ 30 ]", actual: "[ 29 ]" },
      ],
    }, "runner"),
    event("attempt_completed", 11, { outcome: "failed" }, "system"),
  ];
}

function payload(over: Record<string, unknown> = {}): string {
  const replay = foldAttempt(attempt(), { title: "Restore the window", language: "javascript" });
  const filters = { sections: ["log", "cases", "runs", "timings"], events: [], cases: "all", scope: "all", caseDetail: "full", maxLines: 400 };
  return JSON.stringify({
    stats: replay.stats,
    filters,
    solve: { path: "src/window.js", text: "function restore(values) {\n  return values;\n}\n" },
    files: [{ path: "src/window.js", text: "function restore(values) {\n  return values;\n}\n" }],
    report: formatSolveLog(replay, { sections: ["log", "cases", "runs", "timings"] }),
    ...over,
  }, null, 2);
}

describe("reading a replay back out of its own report", () => {
  it("recovers the challenge it was an attempt at", () => {
    const read = readAttempt(payload())!;

    expect(read.title).toBe("Restore the window");
    expect(read.language).toBe("javascript");
    expect(read.outcome).toBe("graded failed");
    expect(read.totals).toMatchObject({ runs: 2, submissions: 1, saves: 2, cases: 3 });
  });

  it("follows each case across the runs, and keeps hidden apart from visible", () => {
    const { cases } = readAttempt(payload())!;
    const byName = new Map(cases.map((item) => [item.name, item]));

    expect(byName.get("counts an empty window")?.marks).toEqual(["passed", "passed"]);
    expect(byName.get("shrinks on an equal value")?.marks).toEqual(["failed", "passed"]);
    // A hidden case does not exist in a visible run, which is not failing it.
    expect(byName.get("restores after two removals")?.marks).toEqual(["absent", "failed"]);
    expect(byName.get("restores after two removals")?.hidden).toBe(true);
    expect(byName.get("shrinks on an equal value")?.story).toContain("first passed after failing");
  });

  it("reads what each run fixed and what it broke", () => {
    const { runs } = readAttempt(payload())!;

    expect(runs.map((run) => [run.passed, run.total])).toEqual([[1, 2], [2, 3]]);
    expect(runs[1]?.submission).toBe(true);
    expect(runs[1]?.fixed).toEqual(["shrinks on an equal value"]);
    expect(runs[0]?.fixed).toEqual([]);
  });

  it("keeps every logged event, with each run's failing cases under it", () => {
    const { log } = readAttempt(payload())!;

    expect(log.map((line) => line.type)).toEqual([
      "attempt_started", "file_changed", "test_run", "file_changed", "submission_created", "test_run", "attempt_completed",
    ]);
    const failing = log.find((line) => line.cases.some((item) => item.status === "failed"))!;
    expect(failing.cases.map((item) => item.status)).toEqual(["passed", "failed"]);
    expect(failing.cases[1]?.name).toBe("shrinks on an equal value");
    expect(failing.cases[1]?.note).toBe("expected 2, got 3");
  });

  it("carries the file the replay came back with, and the timings section", () => {
    const read = readAttempt(payload())!;

    expect(read.files.map((file) => file.path)).toEqual(["src/window.js"]);
    expect(read.solve?.text).toContain("function restore");
    expect(read.timings.some((line) => line.startsWith("total on this attempt"))).toBe(true);
  });

  it("says what the call asked the replay for", () => {
    const read = readAttempt(payload({ filters: { sections: ["cases"], events: [], cases: "still-failing", scope: "since-last-submission", caseDetail: "brief", maxLines: 400 } }))!;

    expect(read.asked).toEqual(["case history", "still failing", "since your last submission"]);
  });
});

describe("a payload the worker had to cut", () => {
  /** The report is the last and largest field, so the 16k cap lands inside it —
   *  a JSON string cut in half, which is the one thing bracket-closing cannot
   *  recover. What arrived is still most of an attempt and is still drawn. */
  it("reads the part of the report that arrived", () => {
    const whole = payload();
    const at = whole.indexOf("RUN DELTAS");
    const cut = `${whole.slice(0, at)}\n… truncated (${whole.length - at} more characters)`;

    const read = readAttempt(cut)!;
    expect(read.cut).toBe(true);
    expect(read.title).toBe("Restore the window");
    expect(read.log.length).toBeGreaterThan(0);
    expect(read.cases.length).toBe(3);
    expect(read.runs).toEqual([]);
  });

  it("does not draw a panel for a payload with no report in it at all", () => {
    expect(readAttempt(JSON.stringify({ stats: null }))).toBeNull();
    expect(readAttempt("")).toBeNull();
  });

  it("shows the sentence the tool returns when nothing was recorded", () => {
    const read = readAttempt(JSON.stringify({ report: "No events are recorded for attempt a1, so there is no log to read." }))!;

    expect(read.nothing).toContain("No events are recorded");
    expect(read.log).toEqual([]);
  });
});
