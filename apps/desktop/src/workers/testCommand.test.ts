import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseTestOutput } from "../shared/testReport.js";
import { TEST_FLAGS } from "./testCommand.js";

/**
 * The contract between the runner and the result panel, checked against the
 * runtime that actually runs the tests.
 *
 * This is the failure it exists for: Electron's Node defaults to the `spec`
 * reporter even on a pipe, so every run in the app produced human-readable text
 * with no per-case detail, and the panel could never show a test case — while
 * the same command under system Node emitted TAP and looked perfectly fine. A
 * unit test on the parser cannot catch that. This one runs the real binary.
 */
describe("the test command's own output", () => {
  it("parses into per-case results under the runtime that runs it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "spar-reporter-"));
    try {
      await writeFile(path.join(root, "sum.js"), "export function sum(a, b) { return a + b - 1; }\n");
      await writeFile(
        path.join(root, "sum.test.js"),
        [
          `import test from "node:test";`,
          `import assert from "node:assert";`,
          `import { sum } from "./sum.js";`,
          `test("adds two numbers", () => { assert.strictEqual(sum(1, 2), 3); });`,
          // Passes against the same off-by-one, so the run reports one of each.
          `test("adds nothing", () => { assert.strictEqual(sum(0, 1), 0); });`,
          "",
        ].join("\n"),
      );

      // process.execPath is the same binary the runner spawns: this suite runs
      // under Electron as node, exactly as the utility process does.
      const output = await promisify(execFile)(process.execPath, [...TEST_FLAGS, "sum.test.js"], {
        cwd: root,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      }).then((result) => result.stdout, (error: { stdout?: string }) => error.stdout ?? "");

      const report = parseTestOutput(output);
      expect(report.parsed).toBe(true);
      expect(report.cases.map((item) => [item.name, item.status])).toEqual([
        ["adds two numbers", "failed"],
        ["adds nothing", "passed"],
      ]);
      // The pair a learner is shown for the failure has to survive the round trip.
      expect(report.cases[0]?.failure?.expected).toBe("3");
      expect(report.cases[0]?.failure?.actual).toBe("2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
