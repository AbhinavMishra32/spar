import { describe, expect, it } from "vitest";
import { buildHarness, cppLiteral, judgeInputBlock, submittableCode } from "./harness.js";
import type { PracticeCase, PracticeProblem } from "./types.js";

const JS_STARTER = `/**
 * @param {number[]} nums
 * @param {number} target
 * @return {number[]}
 */
var twoSum = function(nums, target) {

};`;

const CPP_STARTER = `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {

    }
};`;

const cases: PracticeCase[] = [
  { name: "Example 1", input: ["[2,7,11,15]", "9"], expected: "[0,1]", origin: "statement" },
  { name: "Example 2", input: ["[3,2,4]", "6"], expected: "[1,2]", origin: "statement" },
];

function problem(overrides: Partial<PracticeProblem> = {}): PracticeProblem {
  return {
    source: "leetcode",
    region: "global",
    slug: "two-sum",
    externalId: "1",
    displayId: "1",
    title: "Two Sum",
    url: "https://leetcode.com/problems/two-sum/",
    difficulty: "easy",
    paidOnly: false,
    statement: "Given an array…",
    hints: [],
    topicTags: [{ slug: "array", name: "Array" }],
    concepts: [{ slug: "arrays", role: "primary" }],
    references: [],
    languages: [
      { language: "javascript", slug: "javascript", starter: JS_STARTER },
      { language: "cpp", slug: "cpp", starter: CPP_STARTER },
    ],
    signature: { name: "twoSum", params: [{ name: "nums", type: "integer[]" }, { name: "target", type: "integer" }], returnType: "integer[]", classBased: false },
    examples: [],
    sampleTestcases: ["[2,7,11,15]\n9", "[3,2,4]\n6"],
    acceptanceRate: 55.1,
    status: "todo",
    ...overrides,
  };
}

describe("buildHarness — JavaScript", () => {
  const harness = buildHarness({ problem: problem(), language: "javascript", cases });

  it("puts the source's starter between the markers, untouched", () => {
    expect(harness.supported).toBe(true);
    const file = harness.files["src/solution.js"] ?? "";
    // Byte-identical, because whatever is in the region is what gets submitted.
    expect(submittableCode(file)).toBe(JS_STARTER);
  });

  it("keeps the export outside the region so it is never submitted", () => {
    const file = harness.files["src/solution.js"] ?? "";
    expect(file).toContain("export { twoSum as entry };");
    expect(submittableCode(file)).not.toContain("export");
  });

  it("asserts every case the problem published", () => {
    const test = harness.files["tests/examples.test.js"] ?? "";
    expect(test).toContain('"[2,7,11,15]"');
    expect(test).toContain('"[1,2]"');
    expect(harness.cases).toHaveLength(2);
  });

  it("says the source is the authority when a case disagrees", () => {
    // Some problems accept several correct answers and the statement shows one.
    // The message has to leave room for the learner being right.
    expect(harness.files["tests/examples.test.js"]).toContain("submit and let the judge decide");
  });
});

describe("buildHarness — C++", () => {
  const harness = buildHarness({ problem: problem(), language: "cpp", cases });

  it("compiles the class into a header the test can include", () => {
    expect(harness.supported).toBe(true);
    const header = harness.files["src/solution.h"] ?? "";
    expect(header).toContain("#pragma once");
    expect(header).toContain("using namespace std;");
    // No <bits/stdc++.h>: it is a libstdc++ header and Spar builds with clang.
    expect(header).not.toContain("bits/stdc++.h");
    expect(submittableCode(header)).toBe(CPP_STARTER);
  });

  it("builds each argument as a named local, because LeetCode takes them by reference", () => {
    const test = harness.files["tests/examples.test.cpp"] ?? "";
    expect(test).toContain("vector<int> arg0 = {2, 7, 11, 15};");
    expect(test).toContain("int arg1 = 9;");
    expect(test).toContain("solution.twoSum(arg0, arg1)");
  });

  it("ships the comparison helper the test includes", () => {
    expect(harness.files["tests/spar_check.h"]).toContain("namespace spar");
  });
});

describe("buildHarness — what it refuses", () => {
  it("refuses a design problem instead of testing the wrong thing", () => {
    const result = buildHarness({
      problem: problem({ signature: { name: "LRUCache", params: [], returnType: "void", classBased: true } }),
      language: "javascript",
      cases,
    });
    expect(result.supported).toBe(false);
    if (!result.supported) expect(result.reason).toContain("design problem");
    // The learner still gets a file to work in: the source's judge can grade it.
    expect(result.files["src/solution.js"]).toBeTruthy();
  });

  it("refuses a C++ signature it cannot build a value for", () => {
    const result = buildHarness({
      problem: problem({ signature: { name: "invertTree", params: [{ name: "root", type: "TreeNode*" }], returnType: "TreeNode*", classBased: false } }),
      language: "cpp",
      cases: [{ name: "Example 1", input: ["[4,2,7]"], expected: "[4,7,2]", origin: "statement" }],
    });
    expect(result.supported).toBe(false);
    if (!result.supported) expect(result.reason).toContain("TreeNode*");
  });

  it("refuses when no case has an expected answer", () => {
    const result = buildHarness({ problem: problem(), language: "javascript", cases: [] });
    expect(result.supported).toBe(false);
    if (!result.supported) expect(result.reason).toContain("no worked example");
  });

  it("refuses when the source publishes no starter for the language", () => {
    const result = buildHarness({ problem: problem({ languages: [] }), language: "typescript", cases });
    expect(result.supported).toBe(false);
    if (!result.supported) expect(result.reason).toContain("no TypeScript starter");
  });

  it("drops a case whose argument count does not match the signature", () => {
    const result = buildHarness({
      problem: problem(),
      language: "javascript",
      cases: [...cases, { name: "Broken", input: ["[1]"], expected: "[0]", origin: "generated" }],
    });
    expect(result.cases).toHaveLength(2);
  });
});

describe("submittableCode", () => {
  it("returns the whole file when the markers are gone", () => {
    // The file is the learner's to edit; a missing marker must not mean a
    // missing solution.
    expect(submittableCode("var f = function () {};")).toBe("var f = function () {};");
  });

  it("survives a learner writing the marker text inside their own comment", () => {
    const file = ["// spar:solution:start", "// mentions spar:solution:end in a string", "var f = 1;", "// spar:solution:end"].join("\n");
    expect(submittableCode(file)).toContain("var f = 1;");
  });
});

describe("cppLiteral", () => {
  it("brace-initialises a JSON array", () => {
    expect(cppLiteral("[2,7,11,15]", "vector<int>&")).toBe("{2, 7, 11, 15}");
  });

  it("walks a matrix without splitting on nested commas", () => {
    expect(cppLiteral("[[1,2],[3]]", "vector<vector<int>>")).toBe("{{1, 2}, {3}}");
  });

  it("turns JSON strings into char literals when the element type is char", () => {
    expect(cppLiteral('[["X","O"]]', "vector<vector<char>>&")).toBe(`{{'X', 'O'}}`);
  });

  it("keeps strings quoted the way C++ wants them", () => {
    expect(cppLiteral('"abc"', "string")).toBe('"abc"');
    expect(cppLiteral('["a","b"]', "vector<string>")).toBe('{"a", "b"}');
  });

  it("does not split a comma inside a string", () => {
    expect(cppLiteral('["a,b","c"]', "vector<string>")).toBe('{"a,b", "c"}');
  });

  it("renders an empty array as an empty initialiser", () => {
    expect(cppLiteral("[]", "vector<int>")).toBe("{}");
  });
});

describe("judgeInputBlock", () => {
  it("serialises cases the way the source's run endpoint expects them", () => {
    // One argument per line, cases concatenated — LeetCode's own format.
    expect(judgeInputBlock(cases)).toBe("[2,7,11,15]\n9\n[3,2,4]\n6");
  });
});
