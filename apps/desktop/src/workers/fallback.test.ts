import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { compileQuestion, fallbackDesign, type ValidationRun } from "@spar/training";
import { planCppBuild } from "./cppBuild.js";
import { TEST_FLAGS } from "./testCommand.js";

/**
 * The fallback only guarantees a challenge if it genuinely validates, so it is
 * held to the real bar: the same compiler, the same runner semantics, no
 * shortcuts. A template that quietly stopped compiling would turn the safety
 * net into the very failure it exists to prevent.
 */
async function execute(files: Record<string, string>, language: "javascript" | "typescript" | "cpp"): Promise<ValidationRun> {
  const root = await mkdtemp(path.join(tmpdir(), "spar-fallback-"));
  const started = Date.now();
  try {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    const stages = await resolveStages(root, files, language);
    let stdout = "";
    let stderr = "";
    for (const stage of stages) {
      try {
        const result = await promisify(execFile)(stage.bin, stage.args, { cwd: root, timeout: 20_000 });
        stdout += result.stdout;
        stderr += result.stderr;
      } catch (error) {
        const value = error as { stdout?: string; stderr?: string; code?: number };
        return { exitCode: Number(value.code ?? 1), stdout: stdout + (value.stdout ?? ""), stderr: stderr + (value.stderr ?? ""), durationMs: Date.now() - started };
      }
    }
    return { exitCode: 0, stdout, stderr, durationMs: Date.now() - started };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function resolveStages(root: string, files: Record<string, string>, language: "javascript" | "typescript" | "cpp") {
  const paths = Object.keys(files);
  if (language === "cpp") {
    const plan = planCppBuild({ files: paths, outputDir: path.join(root, ".spar"), command: "test" });
    if ("error" in plan) throw new Error(plan.error);
    await mkdir(path.join(root, ".spar"), { recursive: true });
    return plan.stages;
  }
  if (language === "typescript") {
    // The runner resolves this with import.meta.resolve, which vite's SSR
    // transform does not provide inside a test module; createRequire reaches
    // the same file.
    const tsx = createRequire(import.meta.url).resolve("tsx/cli");
    return [{ bin: process.execPath, args: [tsx, ...TEST_FLAGS, ...paths.filter((file) => file.endsWith(".test.ts"))] }];
  }
  return [{ bin: process.execPath, args: [...TEST_FLAGS, ...paths.filter((file) => file.endsWith(".test.js"))] }];
}

describe("guaranteed fallback challenge", () => {
  for (const language of ["javascript", "typescript", "cpp"] as const) {
    it(`compiles and validates the ${language} fallback`, async () => {
      const design = fallbackDesign(language);
      const compiled = await compileQuestion(design, (files) => execute(files, language));
      const failures = compiled.report.checks.filter((check) => !check.passed);
      expect(failures.map((check) => `${check.name}: ${check.detail}`)).toEqual([]);
      expect(compiled.report.valid).toBe(true);
    }, 120_000);
  }
});
