import { createHash, randomUUID } from "node:crypto";
import { questionDesignSchema, type QuestionDesign } from "@pracai/domain";

export type ValidationRun = { exitCode: number; stdout: string; stderr: string; durationMs: number };
export type ValidationRunner = (files: Record<string,string>, command: string, limits: { timeoutMs: number; memoryMb: number }) => Promise<ValidationRun>;
export type ValidationReport = { id: string; valid: boolean; contentHash: string; checks: Array<{ name: string; passed: boolean; detail: string }>; validatedAt: string };

export async function compileQuestion(untrustedDesign: unknown, run: ValidationRunner): Promise<{ design: QuestionDesign; report: ValidationReport }> {
  const design = questionDesignSchema.parse(untrustedDesign); const checks: ValidationReport["checks"] = [];
  const reference = await run({ ...design.starterFiles, ...design.referenceFiles, ...design.visibleTests, ...design.hiddenTests }, design.runCommand, { timeoutMs: 8_000, memoryMb: 512 });
  checks.push({ name: "reference solution", passed: reference.exitCode === 0, detail: summarize(reference) });
  for (const [index, incorrect] of design.knownIncorrectFiles.entries()) {
    const result = await run({ ...design.starterFiles, ...incorrect, ...design.visibleTests, ...design.hiddenTests }, design.runCommand, { timeoutMs: 8_000, memoryMb: 512 });
    checks.push({ name: `known incorrect ${index + 1}`, passed: result.exitCode !== 0, detail: result.exitCode !== 0 ? "Rejected as expected" : "Incorrect implementation passed all tests" });
  }
  const visibleOnly = await run({ ...design.starterFiles, ...design.referenceFiles, ...design.visibleTests }, design.runCommand, { timeoutMs: 8_000, memoryMb: 512 });
  checks.push({ name: "visible test agreement", passed: visibleOnly.exitCode === 0, detail: summarize(visibleOnly) });
  checks.push({ name: "targeted hidden coverage", passed: design.hiddenTests && Object.keys(design.hiddenTests).length > 0 && design.expectedFailureSignatures.length > 0, detail: `${Object.keys(design.hiddenTests).length} hidden files cover ${design.expectedFailureSignatures.length} expected signatures` });
  checks.push({ name: "accidental difficulty budget", passed: design.accidentalDifficulty.length <= 3, detail: design.accidentalDifficulty.join(", ") || "No incidental complexity declared" });
  const contentHash = createHash("sha256").update(stableJson(design)).digest("hex");
  return { design, report: { id: randomUUID(), valid: checks.every((check) => check.passed), contentHash, checks, validatedAt: new Date().toISOString() } };
}
function summarize(run: ValidationRun) { const output = `${run.stdout}\n${run.stderr}`.trim().slice(0,500); return `${run.exitCode === 0 ? "Passed" : `Exited ${run.exitCode}`} in ${run.durationMs}ms${output ? `: ${output}` : ""}`; }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`; return JSON.stringify(value); }

