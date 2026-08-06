import { describe, expect, it } from "vitest";
import { caseRecords, parseTestOutput, runEvidence } from "./testReport.js";

/* Verbatim `node --test` output (Node 22, piped stdio) for a two-case visible
   file plus a hidden file, with the stacks trimmed. Submissions used to reach
   the result panel as a single prose sentence, so nothing here was ever parsed
   and every submission rendered as raw output. */
const SUBMISSION = `TAP version 13
# Subtest: adds two numbers
not ok 1 - adds two numbers
  ---
  duration_ms: 1.6075
  type: 'test'
  location: '/tmp/spar/validation/a.test.js:4:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    2 !== 3

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 3
  actual: 2
  operator: 'strictEqual'
  ...
# Subtest: adds zero
ok 2 - adds zero
  ---
  duration_ms: 0.407625
  type: 'test'
  ...
# Subtest: hidden big numbers
not ok 3 - hidden big numbers
  ---
  duration_ms: 2.726208
  type: 'test'
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected

      [
    +   29
    -   30
      ]

  code: 'ERR_ASSERTION'
  expected:
    0: 30
  actual:
    0: 29
  operator: 'deepStrictEqual'
  ...
1..3
# tests 3
# suites 0
# pass 1
# fail 2
# cancelled 0
# skipped 0
# todo 0
# duration_ms 122.505833
`;

describe("parseTestOutput", () => {
  it("reads a submission's visible and hidden cases as structured results", () => {
    const report = parseTestOutput(SUBMISSION);

    expect(report.parsed).toBe(true);
    expect(report.cases.map((item) => [item.ordinal, item.name, item.status])).toEqual([
      [1, "adds two numbers", "failed"],
      [2, "adds zero", "passed"],
      [3, "hidden big numbers", "failed"],
    ]);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(2);
    expect(report.durationMs).toBeCloseTo(122.505833);
  });

  it("keeps the expected/actual pair a failure is judged on", () => {
    const [first] = parseTestOutput(SUBMISSION).cases;

    expect(first?.failure?.expected).toBe("3");
    expect(first?.failure?.actual).toBe("2");
    expect(first?.failure?.operator).toBe("strictEqual");
    expect(first?.failure?.location).toBe("validation/a.test.js:4:1");
    expect(first?.durationMs).toBeCloseTo(1.6075);
  });

  it("rebuilds a non-scalar expected value from Node's nested map", () => {
    const hidden = parseTestOutput(SUBMISSION).cases[2];

    expect(hidden?.failure?.expected).toBe("[ 30 ]");
    expect(hidden?.failure?.actual).toBe("[ 29 ]");
  });

  it("records each case durably, and keeps raw output only when there are no cases", () => {
    const evidence = runEvidence(SUBMISSION);

    expect(evidence.passedCases).toBe(1);
    expect(evidence.failedCases).toBe(2);
    expect(evidence.cases.map((item) => item.status)).toEqual(["failed", "passed", "failed"]);
    expect(evidence.cases[0]?.expected).toBe("3");
    // A recorded run carries cases instead of the log it parsed them out of.
    expect(evidence.summary).toBe("");

    const cpp = runEvidence("tests/hidden.test.cpp:12: assertion failed\n");
    expect(cpp.cases).toEqual([]);
    expect(cpp.summary).toBe("tests/hidden.test.cpp:12: assertion failed");
  });

  it("reads the older C++ harness still sitting in workspaces generated before TAP", () => {
    /* Verbatim from a workspace on disk. The generated test is written once, when
       the challenge is mounted, so changing the generator does nothing for a
       challenge somebody is part-way through — and every one of those was reading
       as raw output. */
    const legacy = [
      "ok - Example 1 (statement)",
      "not ok - Example 2 (statement)",
      "    expected: 0",
      "    actual:   5",
      "1 case(s) failed",
      "",
    ].join("\n");
    const report = parseTestOutput(legacy);

    expect(report.parsed).toBe(true);
    expect(report.cases.map((item) => [item.ordinal, item.name, item.status])).toEqual([
      [1, "Example 1 (statement)", "passed"],
      [2, "Example 2 (statement)", "failed"],
    ]);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.cases[1]?.failure).toMatchObject({ expected: "0", actual: "5" });
  });

  it("does not read a sentence that merely contains the word ok as a verdict", () => {
    expect(parseTestOutput("Everything looks ok - but nothing ran.\n").parsed).toBe(false);
    expect(parseTestOutput("LeetCode could not run that (No cases were run).\n").parsed).toBe(false);
  });

  it("clips an assertion value rather than storing a whole dump in the attempt", () => {
    const long = `TAP version 13\nnot ok 1 - big\n  ---\n  expected: '${"x".repeat(400)}'\n  ...\n`;
    const [record] = caseRecords(parseTestOutput(long));

    expect(record?.expected).toHaveLength(221);
    expect(record?.expected?.endsWith("…")).toBe(true);
  });

  it("reports output with no TAP in it as unparsed rather than as zero cases", () => {
    // Any run that dies before the runner starts, and any C++ test somebody else
    // wrote — a hand-written assert prints nothing this can read.
    expect(parseTestOutput("The submission failed one or more deterministic tests.").parsed).toBe(false);
    expect(parseTestOutput("g++: error: unrecognized command-line option").cases).toEqual([]);
  });

  it("reads the C++ harness Spar generates for a sourced problem", () => {
    /* Verbatim output of the compiled harness, from a real clang++ run. A sourced
       C++ challenge used to land in the raw-output fallback — the whole result
       panel read "No structured cases in this run" for a problem whose cases Spar
       had itself generated. */
    const cpp = [
      "TAP version 13",
      "ok 1 - Example 1 (statement)",
      "ok 2 - Example 2 (statement)",
      "not ok 3 - Deliberately wrong expectation (statement)",
      "  ---",
      "  error: 'expected 99, got 2'",
      "  expected: '99'",
      "  actual: '2'",
      "  ...",
      "1..3",
      "# tests 3",
      "# pass 2",
      "# fail 1",
      "",
    ].join("\n");
    const report = parseTestOutput(cpp);

    expect(report.parsed).toBe(true);
    expect(report.cases.map((item) => [item.ordinal, item.name, item.status])).toEqual([
      [1, "Example 1 (statement)", "passed"],
      [2, "Example 2 (statement)", "passed"],
      [3, "Deliberately wrong expectation (statement)", "failed"],
    ]);
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.cases[2]?.failure).toMatchObject({ expected: "99", actual: "2" });
  });
});
