import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { traceSchema } from "../../trace.js";
import { emptyDraft } from "../../inputs.js";
import { composeSetup } from "./compose.js";
import { PYTHON_PRELUDE } from "./index.js";
import { pythonTracerPath } from "./host.js";
import { specFromAnalysis, specFromSignature, type PythonAnalysis } from "./shapes.js";

/**
 * The tracer, actually run.
 *
 * The unit tests above cover the mapping and the composition, which is the half
 * that is pure. This is the half that is a subprocess, and it is worth testing
 * for one specific reason: every claim the rest of the feature makes rests on
 * the tracer preserving object identity across snapshots. That is not something
 * a mock can check — it is a property of `sys.settrace` and of the encoder — so
 * the only honest test of it runs the thing.
 *
 * Skipped rather than failed when there is no interpreter. A machine without
 * `python3` cannot use the visualiser at all, and a red suite would be
 * reporting that as a bug in this package.
 */
const python = spawnSync("python3", ["-c", "print(1)"], { encoding: "utf8" });
const available = python.status === 0;
const run = available ? describe : describe.skip;

function invoke(input: unknown): unknown {
  const result = spawnSync("python3", ["-I", "-S", pythonTracerPath()], { encoding: "utf8", input: JSON.stringify(input), maxBuffer: 32_000_000 });
  expect(result.stderr, "the tracer wrote to stderr").toBe("");
  return JSON.parse(result.stdout);
}

const REVERSE = `class Solution:
    def reverseList(self, head):
        prev = None
        while head:
            nxt = head.next
            head.next = prev
            prev = head
            head = nxt
        return prev
`;

run("the Python tracer", () => {
  it("traces a linked-list reversal and keeps each node's identity across steps", () => {
    const trace = traceSchema.parse(invoke({ mode: "trace", code: REVERSE, setup: "head = linked_list([1, 2, 3])\nprint(show(Solution().reverseList(head)))", maxSteps: 1500 }));
    expect(trace.error).toBeNull();
    expect(trace.truncated).toBe(false);
    expect(trace.frames.length).toBeGreaterThan(5);

    // The property everything else rests on: a node that survives a step is
    // the same `@n` on both sides of it. Without this the canvas would be
    // redrawing rather than animating, and "what changed" would be unanswerable.
    const withNodes = trace.frames.filter((frame) => Object.values(frame.heap).some((object) => object.kind === "linked"));
    const identities = withNodes.map((frame) => Object.values(frame.heap).filter((object) => object.kind === "linked").map((object) => object.id).sort().join(","));
    expect(new Set(identities).size).toBe(1);
  });

  it("renders a returned chain the way the problem states it", () => {
    const trace = traceSchema.parse(invoke({ mode: "trace", code: REVERSE, setup: "print(show(Solution().reverseList(linked_list([1, 2, 3]))))", maxSteps: 1500 }));
    // Top level rather than on a frame: the call happens outside the traced
    // file, so the printed answer exists nowhere else.
    expect(trace.output.trim()).toBe("[3, 2, 1]");
  });

  it("reports which way a branch actually went, at the moment it was decided", () => {
    const trace = traceSchema.parse(invoke({
      mode: "trace",
      code: "def f(n):\n    if n > 2:\n        return 'big'\n    return 'small'\n",
      setup: "print(f(1))",
      maxSteps: 500,
    }));
    const condition = trace.frames.find((frame) => frame.condition)?.condition;
    expect(condition).toMatchObject({ expression: "n > 2", result: false, kind: "if", branch: "Take false branch" });
  });

  it("keeps the frames up to an exception and reports it, rather than losing the run", () => {
    const trace = traceSchema.parse(invoke({ mode: "trace", code: "def f(xs):\n    total = 0\n    return xs[9]\n", setup: "print(f([1]))", maxSteps: 500 }));
    expect(trace.error).toContain("IndexError");
    expect(trace.frames.length).toBeGreaterThan(0);
  });

  it("truncates a program that does not terminate instead of hanging", () => {
    const trace = traceSchema.parse(invoke({ mode: "trace", code: "def f():\n    n = 0\n    while True:\n        n += 1\n", setup: "f()", maxSteps: 200 }));
    expect(trace.truncated).toBe(true);
    expect(trace.frames.length).toBeLessThanOrEqual(200);
  });

  it("reports a syntax error as an analysable fact, with its line", () => {
    const analysis = invoke({ mode: "analyze", code: "def f(:\n    pass\n" }) as PythonAnalysis;
    expect(analysis.error).toMatch(/^Line \d+:/);
    expect(specFromAnalysis(analysis).entryPoints).toEqual([]);
  });

  it("finds the LeetCode shape and prefers the Solution method", () => {
    const analysis = invoke({ mode: "analyze", code: `${REVERSE}\ndef helper(x):\n    return x\n` }) as PythonAnalysis;
    expect(analysis.preferred).toBe("Solution.reverseList");
    expect(specFromAnalysis(analysis).entryPoints.map((entry) => entry.id)).toEqual(["Solution.reverseList", "helper"]);
  });

  it("classifies a learner's own node class by its fields, not its name", () => {
    const analysis = invoke({ mode: "analyze", code: "class Cell:\n    def __init__(self, v):\n        self.v = v\n        self.next = None\n" }) as PythonAnalysis;
    expect(analysis.classes[0]).toMatchObject({ name: "Cell", shape: "linked" });
  });

  it("refuses to build a class that needs constructor arguments, and says why", () => {
    const analysis = invoke({ mode: "analyze", code: "class Grid:\n    def __init__(self, size):\n        self.size = size\n    def area(self):\n        return self.size ** 2\n" }) as PythonAnalysis;
    expect(analysis.entryPoints[0]?.unsupported).toContain("constructor arguments");
  });

  /**
   * The standard library, actually reachable.
   *
   * The form can now compose a `Counter`, a `deque` and a set, and every one of
   * those is a `NameError` unless the traced program has the name in scope.
   * This runs one composed call that uses all of them, because the failure mode
   * is not subtle and not caught anywhere else.
   */
  it("gives the traced program the containers its inputs are built from", () => {
    const entry = specFromSignature({
      name: "solve",
      params: [{ name: "seen", type: "Set[int]" }, { name: "window", type: "Deque[int]" }, { name: "freq", type: "Counter[str]" }],
      returnType: "str",
      classBased: false,
    }).entryPoints[0]!;
    const setup = composeSetup(entry, { ...emptyDraft(entry), values: { seen: [3, 1], window: [4], freq: [["a", 2]] } });
    const code = `class Solution:
    def solve(self, seen, window, freq):
        window.appendleft(9)
        seen.add(7)
        return f"{sorted(seen)} {list(window)} {freq.most_common(1)} {type(freq).__name__}"
`;
    const trace = traceSchema.parse(invoke({ mode: "trace", code, setup, maxSteps: 500 }));
    expect(trace.error).toBeNull();
    expect(trace.output.trim()).toBe("[1, 3, 7] [9, 4] [('a', 2)] Counter");
  });

  /**
   * The prelude is the runtime's helpers, copied into an exported script. If the
   * two drift, Export produces a file that fails somewhere other than where the
   * learner is looking — so this runs the exported form standalone and checks it
   * agrees with what the tracer produced.
   */
  it("exports a script that runs outside Spar and agrees with the traced run", () => {
    const listEntry = specFromSignature({ name: "reverseList", params: [{ name: "head", type: "Optional[ListNode]" }], returnType: "Optional[ListNode]", classBased: false }).entryPoints[0]!;
    const setup = composeSetup(listEntry, { ...emptyDraft(listEntry), values: { head: [1, 2, 3] } });

    const traced = traceSchema.parse(invoke({ mode: "trace", code: REVERSE, setup, maxSteps: 1500 }));
    const standalone = spawnSync("python3", ["-I", "-S", "-c", `${PYTHON_PRELUDE}${REVERSE}\n${setup}\n`], { encoding: "utf8" });

    expect(standalone.stderr).toBe("");
    expect(standalone.stdout).toBe(traced.output);
    expect(standalone.stdout.trim()).toBe("[3, 2, 1]");
  });
});
