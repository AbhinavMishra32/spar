import { describe, expect, it } from "vitest";
import { isJudgePending, normalizeLeetCodeVerdict } from "./verdict.js";

const context = { region: "global" as const, slug: "two-sum" };

describe("normalizeLeetCodeVerdict — a scratch run", () => {
  it("passes only when every case matched", () => {
    const verdict = normalizeLeetCodeVerdict({
      status_code: 10,
      status_msg: "Accepted",
      compare_result: "11",
      code_answer: ["[0,1]", "[1,2]"],
      expected_code_answer: ["[0,1]", "[1,2]"],
      total_correct: 2,
      total_testcases: 2,
      status_runtime: "52 ms",
    }, { ...context, submitted: false });
    expect(verdict.outcome).toBe("passed");
    expect(verdict.passedCases).toBe(2);
    expect(verdict.totalCases).toBe(2);
    expect(verdict.runtime).toBe("52 ms");
  });

  it("fails a run that finished but got a case wrong", () => {
    // Status 10 on a run means "the program did not crash", not "correct". A
    // client that reads it as a pass tells the learner they solved something
    // they did not.
    const verdict = normalizeLeetCodeVerdict({
      status_code: 10,
      status_msg: "Accepted",
      compare_result: "10",
      code_answer: ["[0,1]", "[]"],
      expected_code_answer: ["[0,1]", "[1,2]"],
      std_output_list: ["", "traced"],
      last_testcase: "[2,7,11,15]\n9\n[3,2,4]\n6",
      total_correct: 1,
      total_testcases: 2,
    }, { ...context, submitted: false });
    expect(verdict.outcome).toBe("failed");
    expect(verdict.passedCases).toBe(1);
    expect(verdict.failedCase).toEqual({ input: "[3,2,4]\n6", expected: "[1,2]", actual: "[]", stdout: "traced" });
    expect(verdict.caseAnswers.map((entry) => entry.passed)).toEqual([true, false]);
  });

  it("refuses to call a run that judged nothing a pass", () => {
    /* What LeetCode answers when it is handed an empty `data_input`: status 10,
       `correct_answer: true`, and not a single case. Read as a pass, this reported a
       solution that returned 0 for everything as Accepted — and had no cases to show
       for it, which is the tell nobody was looking at. */
    const verdict = normalizeLeetCodeVerdict({
      status_code: 10,
      status_msg: "Accepted",
      correct_answer: true,
      code_answer: [],
      expected_code_answer: [],
      status_runtime: "0 ms",
    }, { ...context, submitted: false });
    // Errored, not failed: the code was never tried, so there is no verdict on it.
    expect(verdict.outcome).toBe("errored");
    expect(verdict.status).toBe("No cases were run");
    expect(verdict.caseAnswers).toEqual([]);
  });

  it("keeps every case the judge answered, so a run can be read case by case", () => {
    const verdict = normalizeLeetCodeVerdict({
      status_code: 10,
      status_msg: "Accepted",
      correct_answer: false,
      code_answer: ["0", "0"],
      expected_code_answer: ["5", "0"],
      last_testcase: "[7,1,5,3,6,4]\n[7,6,4,3,1]",
    }, { ...context, submitted: false });
    expect(verdict.outcome).toBe("failed");
    expect(verdict.caseAnswers).toEqual([
      { input: "[7,1,5,3,6,4]", expected: "5", actual: "0", passed: false },
      { input: "[7,6,4,3,1]", expected: "0", actual: "0", passed: true },
    ]);
  });

  it("does not link a run's id as a submission page", () => {
    const verdict = normalizeLeetCodeVerdict({ status_code: 10, compare_result: "1", submission_id: "runcode_1730" }, { ...context, submitted: false });
    expect(verdict.submissionUrl).toBe("");
    expect(verdict.submitted).toBe(false);
  });
});

describe("normalizeLeetCodeVerdict — a submission", () => {
  it("reads an acceptance and links the submission", () => {
    const verdict = normalizeLeetCodeVerdict({
      status_code: 10,
      status_msg: "Accepted",
      total_correct: 63,
      total_testcases: 63,
      status_runtime: "48 ms",
      status_memory: "42.1 MB",
      runtime_percentile: 91.2,
      memory_percentile: 33.4,
      submission_id: 1886375866,
    }, { ...context, submitted: true });
    expect(verdict.outcome).toBe("passed");
    expect(verdict.status).toBe("Accepted");
    expect(verdict.passedCases).toBe(63);
    expect(verdict.runtimePercentile).toBe(91.2);
    expect(verdict.submissionUrl).toBe("https://leetcode.com/submissions/detail/1886375866/");
  });

  it("keeps the failing case a wrong answer names", () => {
    const verdict = normalizeLeetCodeVerdict({
      status_code: 11,
      status_msg: "Wrong Answer",
      total_correct: 41,
      total_testcases: 63,
      last_testcase: "[3,3]\n6",
      expected_output: "[0,1]",
      code_output: "[]",
      std_output: "",
      submission_id: 42,
    }, { ...context, submitted: true });
    expect(verdict.outcome).toBe("failed");
    expect(verdict.status).toBe("Wrong Answer");
    expect(verdict.failedCase?.input).toBe("[3,3]\n6");
    expect(verdict.failedCase?.expected).toBe("[0,1]");
    // Per-case answers belong to a run; a submission only ever names the first
    // case it failed, and inventing the rest would be inventing evidence.
    expect(verdict.caseAnswers).toEqual([]);
  });

  it("carries a compile error as a failure with the compiler's own words", () => {
    const verdict = normalizeLeetCodeVerdict({
      status_code: 20,
      status_msg: "Compile Error",
      compile_error: "expected ';'",
      full_compile_error: "Line 4: Char 9: error: expected ';' after expression",
    }, { ...context, submitted: true });
    expect(verdict.outcome).toBe("failed");
    expect(verdict.compileError).toContain("expected ';' after expression");
  });

  it("reports the judge's own failure as errored, never as the learner's", () => {
    // `errored` exists so nothing downstream files a judge outage as evidence
    // about the learner.
    expect(normalizeLeetCodeVerdict({ status_code: 16, status_msg: "Internal Error" }, { ...context, submitted: true }).outcome).toBe("errored");
    expect(normalizeLeetCodeVerdict({ status_code: 21 }, { ...context, submitted: true }).outcome).toBe("errored");
    expect(normalizeLeetCodeVerdict({}, { ...context, submitted: true }).outcome).toBe("errored");
  });

  it("names a time limit exceeded as the failure it is", () => {
    const verdict = normalizeLeetCodeVerdict({ status_code: 14, status_msg: "Time Limit Exceeded", total_correct: 30, total_testcases: 63, last_testcase: "[1,2]\n3" }, { ...context, submitted: true });
    expect(verdict.outcome).toBe("failed");
    expect(verdict.status).toBe("Time Limit Exceeded");
    expect(verdict.passedCases).toBe(30);
  });
});

describe("isJudgePending", () => {
  it("waits while the judge has not decided", () => {
    expect(isJudgePending({ state: "PENDING" })).toBe(true);
    expect(isJudgePending({ state: "STARTED" })).toBe(true);
  });

  it("stops once there is a verdict", () => {
    expect(isJudgePending({ state: "SUCCESS", status_code: 10 })).toBe(false);
    expect(isJudgePending({ status_code: 11 })).toBe(false);
  });

  it("treats a body it cannot read as still pending", () => {
    // Guessing "finished" here would invent a verdict; the caller has a deadline.
    expect(isJudgePending({})).toBe(true);
    expect(isJudgePending(null)).toBe(true);
  });
});
