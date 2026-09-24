import { describe, expect, it } from "vitest";
import { foldSubmissions, snapshotCode, SUBMISSION_CODE_LIMIT, type SubmissionSourceEvent } from "./submissions.js";

let sequence = 0;
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
const event = (type: string, minute: number, payload: Record<string, unknown> = {}, id = `e${++sequence}`): SubmissionSourceEvent =>
  ({ id, attemptId: "a1", sequence: sequence, type, occurredAt: at(minute), payload });

describe("foldSubmissions", () => {
  it("folds the three events of a local submission into one object", () => {
    const [submission] = foldSubmissions([
      event("attempt_started", 0),
      event("file_changed", 1, { path: "solution.py" }),
      event("submission_created", 2, { questionId: "q1", code: { path: "solution.py", text: "def f(): pass", truncated: false } }, "sub-1"),
      event("test_run", 2, { scope: "visible-and-hidden", cases: [{ name: "empty", status: "passed" }, { name: "dupes", status: "failed", expected: "2", actual: "3" }], passedCases: 1, failedCases: 1, durationMs: 120 }),
      event("submission_evaluated", 2, { outcome: "failed", exitCode: 1 }),
    ]);

    expect(submission).toMatchObject({
      id: "sub-1",
      ordinal: 1,
      outcome: "failed",
      judge: "spar",
      status: "exit 1",
      passedCases: 1,
      failedCases: 1,
      totalCases: 2,
      durationMs: 120,
    });
    expect(submission?.code).toEqual({ path: "solution.py", text: "def f(): pass", truncated: false });
    expect(submission?.cases.map((item) => item.name)).toEqual(["empty", "dupes"]);
    expect(submission?.cases[1]).toMatchObject({ expected: "2", actual: "3" });
  });

  it("numbers submissions across the whole run of events", () => {
    const submissions = foldSubmissions([
      event("submission_created", 1, { questionId: "q1" }, "s1"),
      event("test_run", 1, { cases: [{ name: "a", status: "failed" }] }),
      event("submission_evaluated", 1, { outcome: "failed", exitCode: 1 }),
      event("submission_created", 5, { questionId: "q1" }, "s2"),
      event("test_run", 5, { cases: [{ name: "a", status: "passed" }] }),
      event("submission_evaluated", 5, { outcome: "passed", exitCode: 0 }),
    ]);
    expect(submissions.map((item) => [item.id, item.ordinal, item.outcome])).toEqual([["s1", 1, "failed"], ["s2", 2, "passed"]]);
  });

  it("keeps a remote judge's own verdict, counts and numbers", () => {
    const [submission] = foldSubmissions([
      event("submission_created", 1, { questionId: "q1", judge: "leetcode", url: "https://leetcode.com/s/1" }, "s1"),
      event("test_run", 1, { scope: "source-submission", judge: "leetcode", status: "Wrong Answer", passedCases: 34, totalCases: 41, runtime: "42 ms", memory: "17 MB" }),
      event("submission_evaluated", 1, { outcome: "failed", judge: "leetcode", status: "Wrong Answer", url: "https://leetcode.com/s/1" }),
    ]);
    expect(submission).toMatchObject({
      judge: "leetcode",
      status: "Wrong Answer",
      passedCases: 34,
      totalCases: 41,
      runtime: "42 ms",
      memory: "17 MB",
      url: "https://leetcode.com/s/1",
    });
  });

  it("reads an attempt recorded before code snapshots existed", () => {
    const [submission] = foldSubmissions([
      event("submission_created", 1, { questionId: "q1" }, "s1"),
      event("test_run", 1, { cases: [{ name: "a", status: "passed" }], passedCases: 1, failedCases: 0 }),
      event("submission_evaluated", 1, { outcome: "passed", exitCode: 0 }),
    ]);
    expect(submission?.code).toBeNull();
    expect(submission).toMatchObject({ outcome: "passed", status: "Accepted", passedCases: 1 });
  });

  it("returns a submission that was never graded as pending", () => {
    const submissions = foldSubmissions([
      event("submission_created", 1, { questionId: "q1" }, "s1"),
      event("submission_created", 4, { questionId: "q1" }, "s2"),
      event("test_run", 4, { cases: [{ name: "a", status: "passed" }] }),
      event("submission_evaluated", 4, { outcome: "passed" }),
    ]);
    expect(submissions.map((item) => [item.id, item.ordinal, item.outcome])).toEqual([["s1", 1, "pending"], ["s2", 2, "passed"]]);
  });

  it("ignores runs that belong to no submission", () => {
    expect(foldSubmissions([
      event("attempt_started", 0),
      event("test_run", 1, { scope: "visible", cases: [{ name: "a", status: "failed" }] }),
    ])).toEqual([]);
  });

  it("truncates a solution past the snapshot ceiling", () => {
    const long = "x".repeat(SUBMISSION_CODE_LIMIT + 10);
    expect(snapshotCode("s.py", long)).toMatchObject({ truncated: true });
    expect(snapshotCode("s.py", long).text).toHaveLength(SUBMISSION_CODE_LIMIT);
    expect(snapshotCode("s.py", "short")).toEqual({ path: "s.py", text: "short", truncated: false });
  });
});
