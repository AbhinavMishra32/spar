import { describe, expect, it } from "vitest";
import type { PracticeVerdict } from "@spar/practice";
import type { SourceRunReport } from "./api.js";
import { sourceRunOutput, sourceSubmissionOutput } from "./sourceOutput.js";
import { parseTestOutput } from "./testReport.js";

/**
 * Every one of these asserts the same thing from a different angle: what the run
 * writes, the result panel reads back as cases. The two are written apart and
 * only this test holds them together — a run at the source that lost its header
 * or its diagnostic block does not throw anywhere, it silently becomes a log.
 */

const REPORT: SourceRunReport = {
  outcome: "failed",
  status: "Wrong Answer",
  passedCases: 1,
  totalCases: 2,
  runtime: "3 ms",
  memory: "8.2 MB",
  message: "LeetCode says Wrong Answer — 1 of 2 cases passed.",
  failedCase: null,
  cases: [],
  url: "",
};

describe("a run judged at the source", () => {
  it("reads back as one case per answer the judge gave", () => {
    const output = sourceRunOutput({
      ...REPORT,
      cases: [
        { input: "[7,1,5,3,6,4]", expected: "5", actual: "5", passed: true },
        { input: "[7,6,4,3,1]", expected: "0", actual: "5", passed: false },
      ],
    }, "LeetCode");
    const report = parseTestOutput(output);

    expect(report.parsed).toBe(true);
    expect(report.cases).toHaveLength(2);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.cases[1]?.status).toBe("failed");
    // The three things a failing case is: what it was given, what was wanted, what came back.
    expect(report.cases[1]?.name).toContain("[7,6,4,3,1]");
    expect(report.cases[1]?.failure).toMatchObject({ expected: "0", actual: "5" });
  });

  it("reads back as one case when the judge answered with only the case it rejected", () => {
    const output = sourceRunOutput({
      ...REPORT,
      passedCases: 9,
      totalCases: 212,
      failedCase: { input: "[3,3]\n6", expected: "[0,1]", actual: "[]", stdout: "" },
    }, "LeetCode");
    const report = parseTestOutput(output);

    expect(report.parsed).toBe(true);
    expect(report.cases[0]?.status).toBe("failed");
    expect(report.cases[0]?.name).toContain("[3,3], 6");
    expect(report.cases[0]?.failure).toMatchObject({ expected: "[0,1]", actual: "[]" });
    // Counted from the judge's totals, never from the one row it named.
    expect(report.passed).toBe(9);
    expect(report.failed).toBe(203);
  });

  it("keeps a multi-line value inside its own case", () => {
    const output = sourceRunOutput({
      ...REPORT,
      cases: [{ input: "[[1,2],\n[3,4]]", expected: "[1,2,\n3,4]", actual: "it's [ ]", passed: false }],
    }, "LeetCode");
    const report = parseTestOutput(output);

    expect(report.cases).toHaveLength(1);
    expect(report.cases[0]?.failure).toMatchObject({ expected: "[1,2, 3,4]", actual: "it's [ ]" });
  });

  it("names what it is showing, so a case rail is never a row of unnamed numbers", () => {
    const output = sourceRunOutput({
      ...REPORT,
      cases: [{ input: "[2,7,11,15]\n9", expected: "[0,1]", actual: "[0,1]", passed: true }],
    }, "LeetCode");

    expect(parseTestOutput(output).cases[0]?.name).toBe("Case 1 · [2,7,11,15], 9");
  });

  it("claims no cases when the judge ran none, rather than inventing a verdict", () => {
    /* LeetCode answers a request it could not run with a status and nothing else.
       There is no case to draw, and writing a passing point here would report an
       acceptance nobody gave — the panel draws the challenge's own cases as
       ungraded instead. */
    const output = sourceRunOutput({ ...REPORT, outcome: "errored", status: "No cases were run", passedCases: 0, totalCases: 0 }, "LeetCode");

    expect(parseTestOutput(output).parsed).toBe(false);
    expect(output).toContain("No cases were run");
  });
});

const VERDICT: PracticeVerdict = {
  outcome: "failed",
  status: "Wrong Answer",
  statusCode: 11,
  passedCases: 9,
  totalCases: 212,
  runtime: "",
  memory: "",
  runtimePercentile: null,
  memoryPercentile: null,
  compileError: "",
  runtimeError: "",
  failedCase: null,
  caseAnswers: [],
  stdout: [],
  submitted: true,
  submissionId: "1",
  submissionUrl: "",
  judgedAt: "2026-08-06T00:00:00.000Z",
};

describe("a submission judged at the source", () => {
  it("draws the one case the source rejected, with its counts intact", () => {
    const output = sourceSubmissionOutput({
      ...VERDICT,
      failedCase: { input: "[1,2]\n3", expected: "[0,1]", actual: "[1,0]", stdout: "" },
    }, "LeetCode");
    const report = parseTestOutput(output);

    expect(report.parsed).toBe(true);
    expect(report.cases[0]?.failure).toMatchObject({ expected: "[0,1]", actual: "[1,0]" });
    /* 9 of 212, not 9 of the one row on screen — the panel counts from these and
       "9/1 passed" is not a thing that can be true. */
    expect([report.passed, report.failed]).toEqual([9, 203]);
  });

  it("draws an acceptance as a passing case rather than as prose", () => {
    const output = sourceSubmissionOutput({
      ...VERDICT,
      outcome: "passed",
      status: "Accepted",
      statusCode: 10,
      passedCases: 212,
      runtime: "3 ms",
      runtimePercentile: 91.2,
    }, "LeetCode");
    const report = parseTestOutput(output);

    expect(report.parsed).toBe(true);
    expect(report.cases[0]?.status).toBe("passed");
    expect(report.failed).toBe(0);
    expect(output).toContain("beats 91.2%");
  });

  it("keeps a compile error readable instead of forcing it into a case", () => {
    /* Nothing was judged, so there is no case to draw and none is invented. The
       panel shows the challenge's own cases as ungraded and puts this underneath. */
    const output = sourceSubmissionOutput({ ...VERDICT, status: "Compile Error", statusCode: 20, passedCases: 0, totalCases: 0, compileError: "line 7: expected ';'" }, "LeetCode");

    expect(parseTestOutput(output).parsed).toBe(false);
    expect(output).toContain("expected ';'");
  });
});
