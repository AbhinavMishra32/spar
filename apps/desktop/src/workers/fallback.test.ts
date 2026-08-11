import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Language } from "@spar/domain";
import { compileQuestion, fallbackDesign, type ValidationRun } from "@spar/training";
import { resolveLanguageStages } from "./languageStages.js";

/**
 * The fallback only guarantees a challenge if it genuinely validates, so it is
 * held to the real bar: the same compiler, the same runner semantics, no
 * shortcuts. A template that quietly stopped compiling would turn the safety
 * net into the very failure it exists to prevent.
 */
async function execute(files: Record<string, string>, language: Language): Promise<ValidationRun> {
  const root = await mkdtemp(path.join(tmpdir(), "spar-fallback-"));
  const started = Date.now();
  try {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    const resolved=resolveLanguageStages(root,language,"test");if("error"in resolved)return{exitCode:1,stdout:"",stderr:resolved.error,durationMs:Date.now()-started};const stages=resolved.stages;
    let stdout = "";
    let stderr = "";
    for (const stage of stages) {
      try {
        const result = await promisify(execFile)(stage.bin, stage.args, { cwd: root, timeout: 120_000,env:{...process.env,GO111MODULE:"off",PYTHONPATH:"."} });
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

describe("guaranteed fallback challenge", () => {
  for (const language of ["javascript","typescript","python","java","c","cpp","go","rust","swift","ruby"] as const) {
    it(`compiles and validates the ${language} fallback`, async () => {
      const design = fallbackDesign(language);
      const compiled = await compileQuestion(design, (files) => execute(files, language));
      const failures = compiled.report.checks.filter((check) => !check.passed);
      expect(failures.map((check) => `${check.name}: ${check.detail}`)).toEqual([]);
      expect(compiled.report.valid).toBe(true);
    }, 120_000);
  }
});
