import { describe, expect, it } from "vitest";
import { declaredCases, sourcedCases } from "./testCases";

/**
 * The Testcase tab reads cases out of whatever the challenge is made of. Every
 * shape a challenge can arrive in is pinned here, because the failure mode is
 * silent: an unread file does not throw, it renders as a wall of source code
 * where the contract should be.
 */

const JS_SUITE = `import test from "node:test";
import assert from "node:assert/strict";
import { maxProfit } from "../src/solution.js";

test("returns the best single-buy profit", () => {
  assert.strictEqual(maxProfit([7, 1, 5, 3, 6, 4]), 5);
});

test("returns zero when the price only falls", () => {
  assert.strictEqual(maxProfit([7, 6, 4, 3, 1]), 0);
});
`;

/* Verbatim from a mounted LeetCode problem's workspace, as the generator writes
   it now: TAP-emitting, one block per case, arguments bound to named locals
   because LeetCode's signatures take their containers by non-const reference. */
const CPP_SUITE = `#include "solution.h"
#include "spar_check.h"

static void check(const std::string& name, const std::string& actual, const std::string& expected) {
  ++ordinal;
}

int main() {
  std::cout << "TAP version 13\\n";
  {
    Solution solution;
    vector<int> arg0 = {7, 1, 5, 3, 6, 4};
    check("Example 1 (statement)", spar::render(solution.maxProfit(arg0)), "5");
  }

  {
    Solution solution;
    vector<int> arg0 = {7, 6, 4, 3, 1};
    check("Example 2 (statement)", spar::render(solution.maxProfit(arg0)), "0");
  }
}
`;

describe("declared cases", () => {
  it("reads a generated JavaScript suite as its test blocks", () => {
    const declared = declaredCases({ "tests/solution.test.js": JS_SUITE }, ["tests/solution.test.js"]);

    expect(declared.parsed).toBe(true);
    expect(declared.cases.map((item) => item.name)).toEqual([
      "returns the best single-buy profit",
      "returns zero when the price only falls",
    ]);
    expect(declared.cases[0]?.assertions[0]).toMatchObject({ call: "maxProfit([7, 1, 5, 3, 6, 4])", expected: "5" });
  });

  it("reads a C++ suite as its checks, with the arguments put back into the call", () => {
    /* A C++ challenge has no `test(…)` block anywhere in it, so the reader for
       generated JavaScript found nothing and the panel showed the .cpp file
       instead — every C++ challenge, sourced or written, had no Testcase tab
       worth the name. */
    const declared = declaredCases({ "tests/examples.test.cpp": CPP_SUITE }, ["tests/examples.test.cpp"]);

    expect(declared.parsed).toBe(true);
    expect(declared.cases.map((item) => [item.ordinal, item.name])).toEqual([
      [1, "Example 1 (statement)"],
      [2, "Example 2 (statement)"],
    ]);
    expect(declared.cases[0]?.assertions[0]).toMatchObject({ call: "maxProfit({7, 1, 5, 3, 6, 4})", expected: "5" });
    expect(declared.cases[1]?.assertions[0]).toMatchObject({ call: "maxProfit({7, 6, 4, 3, 1})", expected: "0" });
  });

  it("recovers cases from silent native assertions in existing workspaces", () => {
    const source = `#include "trace.h"
#include <cassert>
int main() {
  TraceResult r1 = run_trace(2);
  assert(r1.loopVarAfter == 3);
  TraceResult r2 = run_trace(4);
  assert(r2.loopVarAfter == 5);
  return 0;
}`;
    const declared = declaredCases({ "tests/visible.test.cpp": source }, ["tests/visible.test.cpp"]);

    expect(declared.parsed).toBe(true);
    expect(declared.cases.map((item) => item.name)).toEqual([
      "(run_trace(2)).loopVarAfter equals 3",
      "(run_trace(4)).loopVarAfter equals 5",
    ]);
    expect(declared.cases[0]?.assertions[0]).toMatchObject({ call: "(run_trace(2)).loopVarAfter", expected: "3" });
  });

  it("reports a file it cannot read as unparsed rather than as zero cases", () => {
    const declared = declaredCases({ "tests/opaque.txt": "nothing to read here" }, ["tests/opaque.txt"]);

    expect(declared.parsed).toBe(false);
    expect(declared.cases).toEqual([]);
  });
});

describe("sourced cases", () => {
  it("shows a published case as the call the source's own starter declares", () => {
    const declared = sourcedCases({
      entryName: "maxProfit",
      slug: "best-time-to-buy-and-sell-stock",
      cases: [{ name: "Example 1", input: ["[7,1,5,3,6,4]"], expected: "5" }],
    });

    expect(declared.parsed).toBe(true);
    expect(declared.cases[0]?.assertions[0]).toMatchObject({ call: "maxProfit([7,1,5,3,6,4])", expected: "5" });
  });

  it("stands the arguments on their own when the source published no signature", () => {
    const declared = sourcedCases({
      entryName: "",
      slug: "two-sum",
      cases: [{ name: "Example 1", input: ["[2,7,11,15]", "9"], expected: "[0,1]" }],
    });

    expect(declared.cases[0]?.assertions[0]?.call).toBe("[2,7,11,15], 9");
  });
});
