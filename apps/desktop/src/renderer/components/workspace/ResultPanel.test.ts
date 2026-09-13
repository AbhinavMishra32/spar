import { describe, expect, it } from "vitest";
import { caseLabel, casesForGrid, caseToShow, caseValues, reportForRun, ungradedReason } from "./ResultPanel";

describe("ungraded result explanation", () => {
  it("recognizes provider exception class names as pre-verdict failures", () => {
    expect(ungradedReason("PracticeSourceError: Codeforces refused the submit page.", true)).toBe(
      "The run never reached the cases — it failed before they could be checked. The output says why.",
    );
  });
});

describe("case value presentation", () => {
  const declared = { id: "visible:1", ordinal: 1, name: "small input", file: "tests/visible.test.cpp", assertions: [{ method: "strictEqual", call: "run_trace(2).loopVarAfter", expected: "3" }] };

  it("shows input, output, and expected for a passed case", () => {
    expect(caseValues({ id: "case-1", ordinal: 1, name: "small input", status: "passed" }, declared)).toEqual([
      { input: "run_trace(2).loopVarAfter", output: "3", expected: "3" },
    ]);
  });

  it("uses the runner's actual value for a failed case", () => {
    expect(caseValues({ id: "case-1", ordinal: 1, name: "small input", status: "failed", failure: { expected: "3", actual: "2" } }, declared)).toEqual([
      { input: "run_trace(2).loopVarAfter", output: "2", expected: "3" },
    ]);
  });
});

describe("legacy silent assertion results", () => {
  const declared = {
    parsed: true,
    cases: [{ id: "visible:1", ordinal: 1, name: "value equals 3", file: "tests/visible.test.cpp", assertions: [] }],
  };

  it("joins a successful exit with declared cases instead of showing code:0", () => {
    expect(reportForRun("$ run visible tests\ncode:0", false, { kind: "passed", summary: "" }, declared)).toMatchObject({
      parsed: true,
      passed: 1,
      failed: 0,
      cases: [{ name: "value equals 3", status: "passed" }],
    });
  });

  it("does not invent which case failed from a suite-level non-zero exit", () => {
    expect(reportForRun("assertion failed\ncode:1", false, { kind: "failed", summary: "" }, declared).parsed).toBe(false);
  });
});

describe("which case opens under the grid", () => {
  const passed = (ordinal: number) => ({ id: `c${ordinal}`, ordinal, name: `case ${ordinal}`, status: "passed" as const });
  const failed = (ordinal: number) => ({ id: `c${ordinal}`, ordinal, name: `case ${ordinal}`, status: "failed" as const });

  it("opens nothing when everything passed", () => {
    /* 40 green dots and "40/40 passed" is the entire verdict. Opening case one
       there put "this case passed, but the test did not declare its input and
       expected value" under a clean submission. */
    expect(caseToShow([passed(1), passed(2), passed(3)], "")).toBeUndefined();
  });

  it("opens the first failure without being asked", () => {
    expect(caseToShow([passed(1), failed(2), failed(3)], "")?.ordinal).toBe(2);
  });

  it("opens the case the learner picked, failing or not", () => {
    expect(caseToShow([passed(1), failed(2)], "c1")?.ordinal).toBe(1);
  });

  it("falls back to the failure when the selection is from a previous run", () => {
    expect(caseToShow([passed(1), failed(2)], "stale")?.ordinal).toBe(2);
  });
});

describe("fail-fast result grid", () => {
  it("keeps every unvisited case grey after execution stops on case one", () => {
    const report = {
      parsed: true,
      cases: [{ id: "c1", ordinal: 1, name: "first hidden case", status: "failed" as const }],
      passed: 0,
      failed: 1,
      skipped: 0,
    };
    const grid = casesForGrid(report, false, true, 35);
    expect(grid).toHaveLength(35);
    expect(grid[0]?.status).toBe("failed");
    expect(grid.slice(1).every((item) => item.status === undefined)).toBe(true);
  });
});

describe("reading a generated case name", () => {
  it("splits what the case checks from what it checks it on", () => {
    expect(caseLabel("repeated shrinking is required: target=6, values=[1, 1, 1, 1, 4]")).toEqual({
      label: "repeated shrinking is required",
      input: "target=6, values=[1, 1, 1, 1, 4]",
    });
  });

  it("splits at the last colon, so a colon in the prose is not the split", () => {
    expect(caseLabel("edge case: empty input: values=[]")).toEqual({
      label: "edge case: empty input",
      input: "values=[]",
    });
  });

  it("leaves a name alone when the tail is prose rather than arguments", () => {
    expect(caseLabel("handles an empty list: nothing to do")).toEqual({
      label: "handles an empty list: nothing to do",
      input: "",
    });
  });

  it("leaves a name with no colon alone", () => {
    expect(caseLabel("single-value windows")).toEqual({ label: "single-value windows", input: "" });
  });

  it("gives a hidden failure an input from its name when the runner reported none", () => {
    const [value] = caseValues({
      id: "1",
      ordinal: 1,
      name: "seeded case 23: values=[7, -2, 9, 6], k=-1",
      status: "failed",
      failure: { expected: "1", actual: "2" },
    });
    expect(value?.input).toBe("values=[7, -2, 9, 6], k=-1");
  });
});
