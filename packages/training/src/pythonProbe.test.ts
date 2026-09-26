import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compileQuestion, type ValidationRunner } from "./compiler.js";
import { pythonModuleName, pythonMutants } from "./pythonProbe.js";

const hasPython = spawnSync("python3", ["--version"]).status === 0;

/** The host runner's Python contract: each discovered test file run directly
 *  with python3 from the root, PYTHONPATH=., stopping at the first failure. */
const python: ValidationRunner = async (files) => {
  const root = await mkdtemp(path.join(tmpdir(), "spar-probe-"));
  const started = Date.now();
  try {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    for (const test of Object.keys(files).filter((file) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(file)).sort()) {
      const result = spawnSync("python3", [test], { cwd: root, env: { ...process.env, PYTHONPATH: "." }, timeout: 12_000, encoding: "utf8" });
      stdout += result.stdout ?? "";
      stderr += result.stderr ?? "";
      if (result.status !== 0) { exitCode = result.status ?? 1; break; }
    }
    return { exitCode, stdout, stderr, durationMs: Date.now() - started };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const harness = (cases: string) => `from src.solution import max_subarray_len

def check(name, limit, nums, expected):
    actual = max_subarray_len(limit, nums)
    if actual == expected:
        print(f"ok - {name}")
        return True
    print(f"not ok - {name}\\n  expected: {expected}\\n  actual: {actual}")
    return False

if __name__ == "__main__":
    failed = False
    for case in [
${cases}
    ]:
        if not check(*case):
            failed = True
    if failed:
        raise SystemExit(1)
`;

const reference = `def max_subarray_len(limit, nums):
    left = 0
    running_sum = 0
    best = 0
    for right, value in enumerate(nums):
        running_sum += value
        while running_sum > limit:
            running_sum -= nums[left]
            left += 1
        best = max(best, right - left + 1)
    return best
`;

const visible = harness(`        ("ordinary longest range", 7, [2, 1, 5, 1, 3], 3),
        ("exact limit qualifies", 3, [2, 1], 2),
        ("no single item fits", 2, [3, 4], 0),
        ("empty input", 5, [], 0),`);

const sweep = Array.from({ length: 24 }, (_, index) => {
  const nums = Array.from({ length: 2 + (index % 5) }, (_, at) => ((index * 7 + at * 3) % 6) + 1);
  const limit = 3 + (index % 7);
  let best = 0;
  for (let start = 0; start < nums.length; start += 1) {
    let total = 0;
    for (let end = start; end < nums.length; end += 1) {
      total += nums[end]!;
      if (total <= limit) best = Math.max(best, end - start + 1);
    }
  }
  return `        ("case ${index}", ${limit}, [${nums.join(", ")}], ${best}),`;
}).join("\n");

/** The traced 2026-09-25 candidate, reduced: the "wrong" solution turns the
 *  shrinking `while` into `if`, which over positive values never changes the
 *  answer. */
const traced = {
  title: "Longest range within a limit",
  language: "python",
  kind: "function",
  statement: "Return the length of the longest contiguous run of positive integers whose sum is at most limit.",
  starterFiles: { "src/solution.py": "def max_subarray_len(limit, nums):\n    pass\n" },
  referenceFiles: { "src/solution.py": reference },
  visibleTests: { "tests/visible_test.py": visible },
  hiddenTests: { "tests/hidden_test.py": harness(sweep) },
  knownIncorrectFiles: [{ "src/solution.py": reference.replace("while running_sum > limit", "if running_sum > limit") }],
};

describe.skipIf(!hasPython)("python misconception probe", () => {
  it("settles an equivalent misconception by execution instead of sending it back", async () => {
    const { design, report } = await compileQuestion(traced, python);
    const failed = report.checks.filter((check) => !check.passed);
    expect(failed, JSON.stringify(failed)).toEqual([]);
    const settled = report.checks.find((check) => /^known incorrect 1 (gate|replaced)$/.test(check.name));
    expect(settled?.detail).toContain("not actually wrong");
    if (settled?.name === "known incorrect 1 replaced") expect(design.knownIncorrectFiles[0]?.["src/solution.py"]).not.toBe(traced.knownIncorrectFiles[0]!["src/solution.py"]);
  }, 60_000);

  it("replaces hand-computed hidden expectations with the reference's answers", async () => {
    // (5, [2, 2, 2, 1]) is 3 — [2, 2, 1] sums to exactly 5 — not the 2 the traced candidate wrote.
    const wrong = { ...traced, hiddenTests: { "tests/hidden_test.py": harness(`        ("shrink repeatedly", 5, [2, 2, 2, 1], 2),\n${sweep}`) } };
    const { design, report } = await compileQuestion(wrong, python);
    expect(report.checks.find((check) => check.name === "hidden expectations from the reference")?.detail).toContain("1 hand-written hidden expected value");
    expect(design.hiddenTests["tests/hidden_test.py"]).toContain('("shrink repeatedly", 5, [2, 2, 2, 1], 3)');
    expect(report.checks.find((check) => check.name === "reference solution")?.passed).toBe(true);
  }, 60_000);

  it("never rewrites a visible expectation: the learner's contract is not the reference's to change", async () => {
    const contradicted = { ...traced, visibleTests: { "tests/visible_test.py": visible.replace('("exact limit qualifies", 3, [2, 1], 2)', '("exact limit qualifies", 3, [2, 1], 1)') } };
    const { design, report } = await compileQuestion(contradicted, python);
    expect(report.valid).toBe(false);
    expect(report.checks.find((check) => check.name === "reference solution")?.passed).toBe(false);
    expect(design.visibleTests["tests/visible_test.py"]).toContain('("exact limit qualifies", 3, [2, 1], 1)');
  }, 60_000);

  it("refuses to wave through weak hidden tests when the misconception fails the visible ones", async () => {
    const weakHidden = harness(Array.from({ length: 24 }, (_, index) => `        ("fits whole ${index}", ${100 + index}, [${index % 3 + 1}, 2, 3], 3),`).join("\n"));
    const candidate = { ...traced, hiddenTests: { "tests/hidden_test.py": weakHidden }, knownIncorrectFiles: [{ "src/solution.py": reference.replace("while running_sum > limit", "while running_sum >= limit and left <= right") }] };
    const { report } = await compileQuestion(candidate, python);
    expect(report.valid).toBe(false);
    expect(report.checks.find((check) => check.name === "known incorrect 1 is a real misconception")?.detail).toContain("already fails the visible tests");
  }, 60_000);

  it("adds the input the hidden tests missed as a generated hidden case", async () => {
    // Wrong only when the limit is met exactly by a longer window, which no hidden case exercises.
    const narrowHidden = harness(Array.from({ length: 24 }, (_, index) => `        ("fits whole ${index}", ${100 + index}, [${index % 3 + 1}, 2, 3], 3),`).join("\n"));
    const candidate = {
      ...traced,
      visibleTests: { "tests/visible_test.py": harness(`        ("ordinary", 9, [4, 4, 4], 2),\n        ("nothing fits", 2, [3, 4], 0),\n        ("empty", 5, [], 0),\n        ("all fit", 50, [1, 2], 2),`) },
      hiddenTests: { "tests/hidden_test.py": narrowHidden },
      knownIncorrectFiles: [{ "src/solution.py": reference.replace("while running_sum > limit", "while running_sum >= limit and left <= right") }],
    };
    const { design, report } = await compileQuestion(candidate, python);
    const failed = report.checks.filter((check) => !check.passed);
    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(report.checks.some((check) => /^known incorrect 1 (counterexample|replaced)$/.test(check.name))).toBe(true);
    expect(design.hiddenTests["tests/spar_generated_test.py"]).toMatch(/CASES = \[\n {4}\("max_subarray_len", max_subarray_len, \(/);
  }, 60_000);
});

describe("python mutants", () => {
  it("mutates code, never strings or comments", () => {
    const mutants = pythonMutants(`def f(xs):\n    """while here is prose"""\n    total = 0  # while in a comment\n    i = 0\n    while i < len(xs):\n        total += xs[i]\n        i += 1\n    return max(total, 0) if "<=" else 0\n`);
    const labels = mutants.map((mutant) => mutant.label);
    expect(labels).toContain("line 5: `while` → `if`");
    expect(labels).toContain("line 5: `<` → `<=`");
    expect(labels).toContain("line 8: `max` → `min`");
    expect(labels.some((label) => label.startsWith("line 2:") || label.startsWith("line 3:"))).toBe(false);
    expect(mutants.every((mutant) => mutant.source.includes('"<="'))).toBe(true);
  });

  it("maps implementation paths to importable module names", () => {
    expect(pythonModuleName("src/solution.py")).toBe("src.solution");
    expect(pythonModuleName("solution.py")).toBe("solution");
    expect(pythonModuleName("src/my-solution.py")).toBeNull();
  });
});
