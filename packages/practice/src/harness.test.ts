import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildHarness, buildProgramHarness, cppLiteral, judgeInputBlock, submittableCode } from "./harness.js";
import type { PracticeCase, PracticeProblem } from "./types.js";

const JS_STARTER = `/**
 * @param {number[]} nums
 * @param {number} target
 * @return {number[]}
 */
var twoSum = function(nums, target) {

};`;

const PY_STARTER = `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for index, value in enumerate(nums):
            if target - value in seen:
                return [seen[target - value], index]
            seen[value] = index
        return []`;

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
      { language: "python", slug: "python3", starter: PY_STARTER },
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

/** Writes a generated workspace to disk and runs it the way Spar's runner does.
 *  Skipped where python3 is not on PATH, so the suite still runs on a machine
 *  without it — but where it is, this is the only check that proves the emitted
 *  file is valid Python rather than merely the right-looking text. */
function runPython(files: Record<string, string>, entry: string): { status: number | null; stdout: string } | null {
  if (spawnSync("python3", ["--version"], { encoding: "utf8" }).status !== 0) return null;
  const root = mkdtempSync(path.join(tmpdir(), "spar-python-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      const full = path.join(root, file);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    const run = spawnSync("python3", [path.join(root, entry)], { encoding: "utf8", timeout: 20_000 });
    return { status: run.status, stdout: run.stdout };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("buildHarness — Python", () => {
  const harness = buildHarness({ problem: problem(), language: "python", cases });

  it("gives the starter the names LeetCode's own environment has in scope", () => {
    expect(harness.supported).toBe(true);
    const file = harness.files["src/solution.py"] ?? "";
    /* `List[int]` is in the published signature and nothing imports it, because
       on LeetCode nothing has to. Without the preamble the starter is a NameError. */
    expect(file).toContain("from typing import *");
    expect(file).toContain("class ListNode:");
    expect(file).toContain("class TreeNode:");
    // The markers are Python comments, and the region is byte-identical.
    expect(file).toContain("# spar:solution:start");
    expect(submittableCode(file)).toBe(PY_STARTER);
    // Nothing the harness adds may end up in the submission.
    expect(submittableCode(file)).not.toContain("import");
  });

  it("writes the test where the Python runner will actually find it", () => {
    // The runner globs test_*.py; a file named otherwise is written and never run.
    expect(harness.testPaths).toEqual(["tests/test_examples.py"]);
  });

  it("runs every published case and reports each one", () => {
    const result = runPython(harness.files as Record<string, string>, "tests/test_examples.py");
    if (!result) return;
    expect(result.stdout).toContain("ok 1 - Example 1 (statement)");
    expect(result.stdout).toContain("ok 2 - Example 2 (statement)");
    expect(result.status).toBe(0);
  });

  it("reports a wrong answer as a case with its expected and actual", () => {
    const wrong = buildHarness({
      problem: problem(),
      language: "python",
      code: "class Solution:\n    def twoSum(self, nums, target):\n        return []",
      cases,
    });
    const result = runPython(wrong.files as Record<string, string>, "tests/test_examples.py");
    if (!result) return;
    expect(result.stdout).toContain("not ok 1 - Example 1 (statement)");
    expect(result.stdout).toContain("expected: '[0,1]'");
    expect(result.stdout).toContain("actual: '[]'");
    /* The exit code is the verdict and TAP is what the panel reads; the two
       must never disagree. */
    expect(result.status).toBe(1);
  });

  it("builds a ListNode argument and renders a ListNode answer", () => {
    /* Without both halves a linked-list problem compares [4,5,1,2,3] against
       `<solution.ListNode object at 0x...>`, or fails on a None head. */
    const rotate = buildHarness({
      problem: problem({
        signature: { name: "rotateRight", params: [{ name: "head", type: "ListNode" }, { name: "k", type: "integer" }], returnType: "ListNode", classBased: false },
      }),
      language: "python",
      code: [
        "class Solution:",
        "    def rotateRight(self, head, k):",
        "        values = []",
        "        while head:",
        "            values.append(head.val)",
        "            head = head.next",
        "        if not values:",
        "            return None",
        "        k %= len(values)",
        "        rotated = values[-k:] + values[:-k] if k else values",
        "        node = None",
        "        for value in reversed(rotated):",
        "            node = ListNode(value, node)",
        "        return node",
      ].join("\n"),
      cases: [{ name: "Example 1", input: ["[1,2,3,4,5]", "2"], expected: "[4,5,1,2,3]", origin: "statement" }],
    });
    const result = runPython(rotate.files as Record<string, string>, "tests/test_examples.py");
    if (!result) return;
    expect(result.stdout).toContain("ok 1 - Example 1 (statement)");
    expect(result.status).toBe(0);
  });

  it("reports a raised exception as the failing case rather than a crash", () => {
    const boom = buildHarness({
      problem: problem(),
      language: "python",
      code: "class Solution:\n    def twoSum(self, nums, target):\n        return nums[99]",
      cases,
    });
    const result = runPython(boom.files as Record<string, string>, "tests/test_examples.py");
    if (!result) return;
    expect(result.stdout).toContain("not ok 1 - Example 1 (statement)");
    expect(result.stdout).toContain("IndexError");
    // Still a full run: the second case is reported too, not abandoned.
    expect(result.stdout).toContain("not ok 2 - Example 2 (statement)");
    expect(result.status).toBe(1);
  });
});

describe("buildProgramHarness — Python", () => {
  const harness = buildProgramHarness({
    problem: problem({ source: "codeforces", languages: [] }),
    language: "python",
    cases: [{ name: "Sample 1", input: ["6 6 4\n"], expected: "4\n", origin: "statement" }],
  });

  it("keeps the whole program submittable between # markers", () => {
    expect(harness.supported).toBe(true);
    const file = harness.files["src/main.py"] ?? "";
    expect(file).toContain("# spar:solution:start");
    expect(file).toContain("import sys");
  });

  it("launches the program with the sample on stdin", () => {
    const files = {
      ...harness.files,
      "src/main.py": "import sys\na, b, c = map(int, sys.stdin.read().split())\nprint(((a + c - 1) // c) * ((b + c - 1) // c))\n",
    };
    const result = runPython(files, "tests/test_examples.py");
    if (!result) return;
    expect(result.stdout).toContain("ok 1 - Sample 1");
    expect(result.status).toBe(0);
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

describe("buildProgramHarness — Codeforces", () => {
  const source = problem({
    source: "codeforces", slug: "4/A", externalId: "4/A", displayId: "4/A",
    url: "https://codeforces.com/problemset/problem/4/A", signature: null,
    languages: [{ language: "cpp", slug: "cpp", starter: "#include <bits/stdc++.h>\nusing namespace std;\nint main(){ return 0; }" }],
  });
  const published = [{ name: "Example 1", input: ["8"], expected: "YES", origin: "source" as const }];

  it("keeps a complete stdin/stdout program submittable", () => {
    const harness = buildProgramHarness({ problem: source, language: "cpp", cases: published });
    expect(harness.supported).toBe(true);
    expect(submittableCode(harness.files["src/main.cpp"] ?? "")).toContain("int main()");
    expect(harness.files["tests/examples.test.cpp"]).toContain("spar_solution_main");
    expect(harness.cases).toEqual(published);
  });

  it("refuses a local run when no paired output was published, without losing the editor file", () => {
    const harness = buildProgramHarness({ problem: source, language: "cpp", cases: [] });
    expect(harness.supported).toBe(false);
    expect(harness.files["src/main.cpp"]).toContain("spar:solution:start");
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
