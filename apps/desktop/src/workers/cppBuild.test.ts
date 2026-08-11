import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buildHarness, buildProgramHarness, type PracticeProblem } from "@spar/practice";
import { parseTestOutput } from "../shared/testReport.js";
import { planCppBuild } from "./cppBuild.js";

/** The layout a model actually writes: header beside the implementation in src/, tests under tests/. */
const layout = {
  "src/window.h": "#pragma once\n#include <vector>\nint longest_run(const std::vector<int>& values);\n",
  "src/window.cpp": "#include \"window.h\"\nint longest_run(const std::vector<int>& values) {\n  int best = 0, run = 0;\n  for (size_t i = 0; i < values.size(); ++i) { run = (i > 0 && values[i] == values[i-1]) ? run + 1 : 1; if (run > best) best = run; }\n  return best;\n}\n",
  "tests/visible.test.cpp": "#include \"window.h\"\n#include <cassert>\nint main() { assert(longest_run({1,1,2}) == 2); return 0; }\n",
  "tests/hidden.test.cpp": "#include \"window.h\"\n#include <cassert>\nint main() { assert(longest_run({4,4,4,1}) == 3); return 0; }\n",
};

async function materialize(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "spar-cpp-"));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

/** Executes the plan the way the runner does: sequential, stopping at the first non-zero stage. */
async function runPlan(root: string, files: Record<string, string>, command: "test" | "run" = "test") {
  const plan = planCppBuild({ files: Object.keys(files), outputDir: path.join(root, ".spar"), command });
  if ("error" in plan) return { exitCode: 1, output: plan.error };
  await mkdir(path.join(root, ".spar"), { recursive: true });
  let output = "";
  for (const stage of plan.stages) {
    try {
      const result = await promisify(execFile)(stage.bin, stage.args, { cwd: root, timeout: 20_000 });
      output += result.stdout + result.stderr;
    } catch (error) {
      const value = error as { stdout?: string; stderr?: string; code?: number };
      return { exitCode: Number(value.code ?? 1), output: output + (value.stdout ?? "") + (value.stderr ?? "") };
    }
  }
  return { exitCode: 0, output };
}

/** A sourced problem, cut down to what the harness generator reads. */
const PROBLEM = {
  source: "leetcode",
  region: "global",
  slug: "best-time-to-buy-and-sell-stock",
  externalId: "121",
  displayId: "121",
  title: "Best Time to Buy and Sell Stock",
  url: "https://leetcode.com/problems/best-time-to-buy-and-sell-stock/",
  difficulty: "easy",
  paidOnly: false,
  statement: "",
  hints: [],
  topicTags: [],
  concepts: [],
  references: [],
  languages: [{ language: "cpp", slug: "cpp", starter: "class Solution {\npublic:\n    int maxProfit(vector<int>& prices) {\n        \n    }\n};" }],
  signature: { name: "maxProfit", params: [{ name: "prices", type: "integer[]" }], returnType: "integer", classBased: false },
  examples: [],
  sampleTestcases: [],
  acceptanceRate: 55,
  status: "todo",
} as unknown as PracticeProblem;

const CASES = [
  { name: "Example 1", input: ["[7,1,5,3,6,4]"], expected: "5", origin: "statement" as const },
  { name: "Example 2", input: ["[7,6,4,3,1]"], expected: "0", origin: "statement" as const },
];

describe("the generated C++ harness", () => {
  /**
   * Generator to compiler to result panel, in one test, on a real toolchain.
   *
   * The three are written in three different packages and the seam between them
   * is a text format, so nothing type-checks it: a harness that stops emitting
   * TAP compiles, runs, grades correctly, and quietly turns the whole result
   * panel into a log — which is exactly what happened. This is the only place
   * that holds them together.
   */
  it("prints per-case results the result panel reads back as cases", async () => {
    const harness = buildHarness({ problem: PROBLEM, language: "cpp", cases: CASES });
    if (!harness.supported) throw new Error(harness.reason);
    /* A wrong solution on purpose: a passing run proves the parser reads points,
       and a failing one proves it reads the diagnostic block underneath them. */
    const files = {
      ...harness.files,
      [harness.entryPath]: harness.files[harness.entryPath]!.replace(
        /\/\/ spar:solution:start[\s\S]*\/\/ spar:solution:end/,
        "// spar:solution:start\nclass Solution {\npublic:\n    int maxProfit(vector<int>& prices) {\n        return prices.empty() ? 0 : prices[0];\n    }\n};\n// spar:solution:end",
      ),
    };
    const root = await materialize(files);
    try {
      const run = await runPlan(root, files);
      const report = parseTestOutput(run.output);

      expect(report.parsed).toBe(true);
      expect(report.cases.map((item) => item.status)).toEqual(["failed", "failed"]);
      expect(report.cases[0]).toMatchObject({ ordinal: 1, name: "Example 1 (statement)" });
      expect(report.cases[0]?.failure).toMatchObject({ expected: "5", actual: "7" });
      // The exit code is the verdict and the printed cases are how it is read; they must agree.
      expect(run.exitCode).not.toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("runs a complete Codeforces stdin/stdout program without linking its main twice", async () => {
    const source = { ...PROBLEM, source: "codeforces", slug: "4/A", externalId: "4/A", displayId: "4/A", url: "https://codeforces.com/problemset/problem/4/A", signature: null, languages: [{ language: "cpp", slug: "cpp", starter: "#include <bits/stdc++.h>\nusing namespace std;\nint main(){ int w; cin >> w; cout << (w > 2 && w % 2 == 0 ? \"YES\" : \"NO\"); return 0; }" }] } as PracticeProblem;
    const harness = buildProgramHarness({ problem: source, language: "cpp", cases: [{ name: "Example 1", input: ["8"], expected: "YES", origin: "source" }, { name: "Example 2", input: ["3"], expected: "NO", origin: "source" }] });
    if (!harness.supported) throw new Error(harness.reason);
    const root = await materialize(harness.files);
    try {
      const run = await runPlan(root, harness.files);
      expect(run.exitCode, run.output).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 120_000);
});

describe("C++ build planning", () => {
  it("rejects separator aliases before clang links one source twice", () => {
    const plan=planCppBuild({files:["src/trace.cpp","src\\trace.cpp","tests/visible.test.cpp"],outputDir:"/out",command:"test"});
    expect("error" in plan&&plan.error).toContain("both identify src/trace.cpp");
    expect("error" in plan&&plan.error).toContain("no compiler was started");
  });

  it("gives each test file its own binary so visible and hidden tests never collide", () => {
    const plan = planCppBuild({ files: Object.keys(layout), outputDir: "/out", command: "test" });
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.binaries).toHaveLength(2);
    // Every test links the implementation, and no binary links two mains.
    for (const stage of plan.stages.filter((item) => item.bin === "clang++")) {
      expect(stage.args.filter((argument) => /\.test\.cpp$/.test(argument))).toHaveLength(1);
      expect(stage.args).toContain("src/window.cpp");
    }
  });

  it("puts the implementation's header directory on the include path", () => {
    const plan = planCppBuild({ files: Object.keys(layout), outputDir: "/out", command: "test" });
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.stages[0]?.args).toContain("-Isrc");
  });

  it("explains an unbuildable layout instead of failing silently", () => {
    const plan = planCppBuild({ files: ["src/window.cpp"], outputDir: "/out", command: "test" });
    expect("error" in plan && plan.error).toContain("No C++ test sources found");
  });

  it("builds and passes the ordinary header-beside-implementation layout", async () => {
    const root = await materialize(layout);
    try {
      expect(await runPlan(root, layout)).toMatchObject({ exitCode: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("fails only the hidden test when the implementation carries the targeted misconception", async () => {
    // Off-by-one: reports the run length as the number of repeats, so a run of
    // two still looks right and only a longer run disagrees.
    const incorrect = { ...layout, "src/window.cpp": "#include \"window.h\"\nint longest_run(const std::vector<int>& values) {\n  int best = 0, run = 0;\n  for (size_t i = 0; i < values.size(); ++i) { run = (i > 0 && values[i] == values[i-1]) ? run + 1 : 1; if (run > best) best = run; }\n  return best > 2 ? 2 : best;\n}\n" };
    const visibleOnly = { ...incorrect, "tests/hidden.test.cpp": undefined } as Record<string, string | undefined>;
    const visibleFiles = Object.fromEntries(Object.entries(visibleOnly).filter((entry): entry is [string, string] => entry[1] !== undefined));

    const visibleRoot = await materialize(visibleFiles);
    const hiddenRoot = await materialize(incorrect);
    try {
      expect(await runPlan(visibleRoot, visibleFiles)).toMatchObject({ exitCode: 0 });
      expect((await runPlan(hiddenRoot, incorrect)).exitCode).not.toBe(0);
    } finally {
      await rm(visibleRoot, { recursive: true, force: true });
      await rm(hiddenRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
