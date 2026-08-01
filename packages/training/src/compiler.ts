import { createHash, randomUUID } from "node:crypto";
import { questionDesignSchema, type QuestionDesign } from "@spar/domain";

export type ValidationRun = { exitCode: number; stdout: string; stderr: string; durationMs: number };
export type ValidationRunner = (files: Record<string,string>, command: string, limits: { timeoutMs: number; memoryMb: number }) => Promise<ValidationRun>;
export type ValidationReport = { id: string; valid: boolean; contentHash: string; checks: Array<{ name: string; passed: boolean; detail: string }>; validatedAt: string };

export async function compileQuestion(untrustedDesign: unknown, run: ValidationRunner): Promise<{ design: QuestionDesign; report: ValidationReport }> {
  let design = normalizeFileDescriptors(questionDesignSchema.parse(untrustedDesign));
  let differentialDiagnostics: string[] = [];
  if (design.language === "javascript") {
    design = await materializeJavascriptOracles(design, run);
    const differential = await materializeDifferentialHiddenTests(design, run);
    design = differential.design;
    differentialDiagnostics = differential.diagnostics;
  }
  const checks: ValidationReport["checks"] = [];
  const reference = await run({ ...design.starterFiles, ...design.referenceFiles, ...design.visibleTests, ...design.hiddenTests }, design.runCommand, { timeoutMs: 8_000, memoryMb: 512 });
  checks.push({ name: "reference solution", passed: reference.exitCode === 0, detail: summarize(reference) });
  for (const [index, incorrect] of design.knownIncorrectFiles.entries()) {
    const incorrectPaths = Object.keys(incorrect);
    const referencePaths = Object.keys(design.referenceFiles);
    const replacedPaths = incorrectPaths.filter((file) => Object.hasOwn(design.referenceFiles, file));
    const replacesImplementation = replacedPaths.length > 0;
    checks.push({
      name: `known incorrect ${index + 1} replaces reference implementation`,
      passed: replacesImplementation,
      detail: replacesImplementation
        ? `Replaces ${replacedPaths.join(", ")}`
        : `Known-incorrect paths (${incorrectPaths.join(", ") || "none"}) do not replace any reference path (${referencePaths.join(", ") || "none"}). Use the exact same implementation path.`,
    });
    if (!replacesImplementation) {
      checks.push({ name: `known incorrect ${index + 1} passes visible`, passed: false, detail: "Not executed because the misconception does not replace the implementation imported by the tests" });
      checks.push({ name: `known incorrect ${index + 1} fails hidden`, passed: false, detail: "Not executed because the misconception does not replace the implementation imported by the tests" });
      continue;
    }
    const visibleResult = await run({ ...design.starterFiles, ...incorrect, ...design.visibleTests }, design.runCommand, { timeoutMs: 8_000, memoryMb: 512 });
    checks.push({ name: `known incorrect ${index + 1} passes visible`, passed: visibleResult.exitCode === 0, detail: visibleResult.exitCode === 0 ? "Plausible misconception passes the learner-visible contract" : summarize(visibleResult) });
    const hiddenResult = await run({ ...design.starterFiles, ...incorrect, ...design.visibleTests, ...design.hiddenTests }, design.runCommand, { timeoutMs: 8_000, memoryMb: 512 });
    checks.push({ name: `known incorrect ${index + 1} fails hidden`, passed: hiddenResult.exitCode !== 0, detail: hiddenResult.exitCode !== 0 ? "Targeted hidden tests rejected the misconception" : differentialDiagnostics[index] ?? "Incorrect implementation passed visible and hidden tests" });
  }
  const visibleOnly = await run({ ...design.starterFiles, ...design.referenceFiles, ...design.visibleTests }, design.runCommand, { timeoutMs: 8_000, memoryMb: 512 });
  checks.push({ name: "visible test agreement", passed: visibleOnly.exitCode === 0, detail: summarize(visibleOnly) });
  checks.push({ name: "targeted hidden coverage", passed: design.hiddenTests && Object.keys(design.hiddenTests).length > 0 && design.expectedFailureSignatures.length > 0, detail: `${Object.keys(design.hiddenTests).length} hidden files cover ${design.expectedFailureSignatures.length} expected signatures` });
  checks.push({ name: "accidental difficulty budget", passed: design.accidentalDifficulty.length <= 3, detail: design.accidentalDifficulty.join(", ") || "No incidental complexity declared" });
  const contentHash = createHash("sha256").update(stableJson(design)).digest("hex");
  return { design, report: { id: randomUUID(), valid: checks.every((check) => check.passed), contentHash, checks, validatedAt: new Date().toISOString() } };
}
function summarize(run: ValidationRun) { const output = `${run.stdout}\n${run.stderr}`.trim().slice(0,2_000); return `${run.exitCode === 0 ? "Passed" : `Exited ${run.exitCode}`} in ${run.durationMs}ms${output ? `: ${output}` : ""}`; }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`; return JSON.stringify(value); }

function normalizeFileDescriptors(design: QuestionDesign): QuestionDesign {
  return {
    ...design,
    knownIncorrectFiles: design.knownIncorrectFiles.map((files) => {
      if (typeof files.path === "string" && typeof files.content === "string" && Object.keys(files).every((key) => key === "path" || key === "content")) {
        return { [files.path]: files.content };
      }
      return files;
    }),
  };
}

async function materializeJavascriptOracles(design: QuestionDesign, run: ValidationRunner): Promise<QuestionDesign> {
  const materialize = async (tests: Record<string, string>) => {
    const entries = await Promise.all(Object.entries(tests).map(async ([file, source]) => {
      const calls = findAssertionCalls(source);
      if (!calls.length) return [file, source] as const;
      const instrumented = rewriteAssertions(source, calls, calls.map((call, index) => `globalThis.__sparOracle(${index}, (${call.arguments[0]}))`));
      const oracleSource = `globalThis.__sparOracle = (index, actual) => console.log("__SPAR_ORACLE__" + JSON.stringify({ index, actual }));\n${instrumented}`;
      const result = await run({ ...design.starterFiles, ...design.referenceFiles, [file]: oracleSource }, design.runCommand, { timeoutMs: 8_000, memoryMb: 512 });
      if (result.exitCode !== 0) return [file, source] as const;
      const actualByIndex = new Map<number, unknown>();
      for (const match of result.stdout.matchAll(/__SPAR_ORACLE__(\{[^\r\n]*\})/g)) {
        try {
          const value = JSON.parse(match[1] ?? "") as { index?: unknown; actual?: unknown };
          if (typeof value.index === "number") actualByIndex.set(value.index, value.actual);
        } catch {}
      }
      if (actualByIndex.size !== calls.length) return [file, source] as const;
      const replacements = calls.map((call, index) => {
        const literal = JSON.stringify(actualByIndex.get(index));
        if (literal === undefined) return source.slice(call.start, call.end);
        return `assert.${call.method}(${[call.arguments[0], literal, ...call.arguments.slice(2)].join(", ")})`;
      });
      return [file, rewriteAssertions(source, calls, replacements)] as const;
    }));
    return Object.fromEntries(entries);
  };
  return { ...design, visibleTests: await materialize(design.visibleTests), hiddenTests: await materialize(design.hiddenTests) };
}

type AssertionCall = { start: number; end: number; method: string; arguments: string[] };

function findAssertionCalls(source: string): AssertionCall[] {
  const calls: AssertionCall[] = [];
  const matcher = /assert\.(strictEqual|equal|deepStrictEqual|deepEqual)\s*\(/g;
  for (let match = matcher.exec(source); match; match = matcher.exec(source)) {
    const opening = source.indexOf("(", match.index);
    const parsed = parseArguments(source, opening + 1);
    if (!parsed || parsed.arguments.length < 2) continue;
    calls.push({ start: match.index, end: parsed.end + 1, method: match[1] ?? "strictEqual", arguments: parsed.arguments });
    matcher.lastIndex = parsed.end + 1;
  }
  return calls;
}

function parseArguments(source: string, start: number): { arguments: string[]; end: number } | null {
  const argumentsList: string[] = [];
  let argumentStart = start;
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") { quote = character; continue; }
    if (character === "(" || character === "[" || character === "{") { depth += 1; continue; }
    if (character === ")") {
      if (depth === 0) {
        argumentsList.push(source.slice(argumentStart, index).trim());
        return { arguments: argumentsList, end: index };
      }
      depth -= 1;
      continue;
    }
    if (character === "]" || character === "}") { depth -= 1; continue; }
    if (character === "," && depth === 0) {
      argumentsList.push(source.slice(argumentStart, index).trim());
      argumentStart = index + 1;
    }
  }
  return null;
}

function rewriteAssertions(source: string, calls: AssertionCall[], replacements: string[]): string {
  let output = source;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (!call) continue;
    output = `${output.slice(0, call.start)}${replacements[index] ?? output.slice(call.start, call.end)}${output.slice(call.end)}`;
  }
  return output;
}

async function materializeDifferentialHiddenTests(design: QuestionDesign, run: ValidationRunner): Promise<{ design: QuestionDesign; diagnostics: string[] }> {
  let hiddenTests = { ...design.hiddenTests };
  const knownIncorrectFiles = design.knownIncorrectFiles.map((files) => ({ ...files }));
  const diagnostics: string[] = [];
  for (const [index, incorrect] of knownIncorrectFiles.entries()) {
    const implementationPath = Object.keys(incorrect).find((file) => Object.hasOwn(design.referenceFiles, file));
    if (!implementationPath) continue;
    const referenceSource = design.referenceFiles[implementationPath];
    const incorrectSource = incorrect[implementationPath];
    if (!referenceSource || !incorrectSource) continue;
    const exportName = referenceSource.match(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)?.[1]
      ?? referenceSource.match(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/)?.[1]
      ?? referenceSource.match(/module\.exports\s*=\s*\{\s*([A-Za-z_$][\w$]*)/)?.[1];
    if (!exportName) continue;
    const moduleStyle: "esm" | "commonjs" = /\bexport\s+(?:async\s+)?(?:function|const|let|class)\b/.test(referenceSource) ? "esm" : "commonjs";
    const seedArguments = extractCallArguments({ ...design.visibleTests, ...hiddenTests }, exportName);
    if (!seedArguments.length) continue;
    const directory = implementationPath.includes("/") ? implementationPath.slice(0, implementationPath.lastIndexOf("/")) : "";
    const basename = implementationPath.slice(implementationPath.lastIndexOf("/") + 1);
    const incorrectName = `.spar-incorrect-${index + 1}-${basename}`;
    const incorrectPath = directory ? `${directory}/${incorrectName}` : incorrectName;
    const harnessPath = directory ? `${directory}/.spar-differential-${index + 1}.test.js` : `.spar-differential-${index + 1}.test.js`;
    const referenceImport = `./${basename}`;
    const incorrectImport = `./${incorrectName}`;
    const harness = differentialHarness(exportName, referenceImport, incorrectImport, seedArguments, moduleStyle);
    let foundCounterexample = false;
    for (const candidateSource of [incorrectSource, ...synthesizeTargetedMutants(referenceSource)]) {
      const visible = await run({ ...design.starterFiles, [implementationPath]: candidateSource, ...design.visibleTests }, design.runCommand, { timeoutMs: 8_000, memoryMb: 512 });
      if (visible.exitCode !== 0) continue;
      const discovery = await run({ ...design.starterFiles, ...design.referenceFiles, [incorrectPath]: candidateSource, [harnessPath]: harness }, design.runCommand, { timeoutMs: 8_000, memoryMb: 512 });
      if (discovery.exitCode !== 0) continue;
      const marker = discovery.stdout.match(/__SPAR_COUNTEREXAMPLE__(\{[^\r\n]*\})/)?.[1];
      if (!marker) continue;
      try {
        const counterexample = JSON.parse(marker) as { args?: unknown[]; expected?: unknown };
        if (!Array.isArray(counterexample.args) || counterexample.expected === undefined) continue;
        const args = counterexample.args.map((argument) => JSON.stringify(argument)).join(", ");
        const expected = JSON.stringify(counterexample.expected);
        if (expected === undefined) continue;
        knownIncorrectFiles[index] = { ...incorrect, [implementationPath]: candidateSource };
        const hiddenPath = directory ? `${directory}/.spar-generated-${index + 1}.hidden.test.js` : `.spar-generated-${index + 1}.hidden.test.js`;
        hiddenTests[hiddenPath] = moduleStyle === "esm"
          ? `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { ${exportName} } from ${JSON.stringify(referenceImport)};\n\ntest("generated counterexample for targeted misconception ${index + 1}", () => {\n  assert.deepStrictEqual(${exportName}(${args}), ${expected});\n});\n`
          : `const test = require("node:test");\nconst assert = require("node:assert/strict");\nconst { ${exportName} } = require(${JSON.stringify(referenceImport)});\n\ntest("generated counterexample for targeted misconception ${index + 1}", () => {\n  assert.deepStrictEqual(${exportName}(${args}), ${expected});\n});\n`;
        foundCounterexample = true;
        break;
      } catch {}
    }
    if (!foundCounterexample) diagnostics[index] = "Bounded differential search found no observable difference between the reference, the proposed misconception, and targeted mutants. The challenge return contract may hide the target weakness. Change the observable operation or representation (for repeated invariant restoration, prefer counting valid windows or returning restored state instead of only a monotone maximum), then provide a misconception that differs on that contract.";
  }
  return { design: { ...design, hiddenTests, knownIncorrectFiles }, diagnostics };
}

function synthesizeTargetedMutants(referenceSource: string): string[] {
  const candidates = [
    referenceSource.replace(/\bwhile\s*\(/, "if ("),
    referenceSource.replace(/return\s+([A-Za-z_$][\w$]*)\.slice\([^;]+\)/, "return $1"),
    referenceSource.replace(/Math\.max\s*\(/, "Math.min("),
    referenceSource.replace(/>=/, ">"),
    referenceSource.replace(/<=/, "<"),
  ];
  return [...new Set(candidates)].filter((candidate) => candidate !== referenceSource);
}

function extractCallArguments(tests: Record<string, string>, functionName: string): string[][] {
  const seeds: string[][] = [];
  const matcher = new RegExp(`\\b${functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`, "g");
  for (const source of Object.values(tests)) {
    for (let match = matcher.exec(source); match; match = matcher.exec(source)) {
      const opening = source.indexOf("(", match.index);
      const parsed = parseArguments(source, opening + 1);
      if (!parsed) continue;
      seeds.push(parsed.arguments);
      matcher.lastIndex = parsed.end + 1;
    }
  }
  return seeds.slice(0, 20);
}

function differentialHarness(exportName: string, referenceImport: string, incorrectImport: string, seedArguments: string[][], moduleStyle: "esm" | "commonjs"): string {
  const imports = moduleStyle === "esm"
    ? `import test from "node:test";\nimport { isDeepStrictEqual } from "node:util";\nimport { ${exportName} as reference } from ${JSON.stringify(referenceImport)};\nimport { ${exportName} as misconception } from ${JSON.stringify(incorrectImport)};`
    : `const test = require("node:test");\nconst { isDeepStrictEqual } = require("node:util");\nconst { ${exportName}: reference } = require(${JSON.stringify(referenceImport)});\nconst { ${exportName}: misconception } = require(${JSON.stringify(incorrectImport)});`;
  return `${imports}

const seeds = [${seedArguments.map((argumentsList) => `[${argumentsList.join(", ")}]`).join(",\n")}];
function variants(value) {
  if (typeof value === "string") {
    const alphabet = [...new Set((value + "abc01").split(""))].slice(0, 4);
    const output = new Set(["", value, value + value, ...alphabet]);
    let layer = [""];
    for (let length = 1; length <= 7; length += 1) {
      layer = layer.flatMap((prefix) => alphabet.map((character) => prefix + character)).slice(0, 1200);
      for (const candidate of layer) output.add(candidate);
    }
    return [...output].slice(0, 1400);
  }
  if (typeof value === "number") return [...new Set([0, 1, 2, 3, 4, 5, value - 1, value, value + 1])].filter(Number.isFinite);
  if (typeof value === "boolean") return [false, true];
  if (Array.isArray(value)) {
    const atoms = [...new Set([...value, 0, 1, 2, "a", "b"])].slice(0, 5);
    const output = [[], value, [...value, ...value], ...atoms.map((atom) => [atom]), ...atoms.flatMap((left) => atoms.map((right) => [left, right]))];
    return output.slice(0, 100);
  }
  return [value];
}
function candidates(seed) {
  let rows = [[]];
  for (const value of seed) {
    const next = [];
    for (const row of rows) for (const variant of variants(value)) {
      next.push([...row, variant]);
      if (next.length >= 2500) break;
    }
    rows = next;
  }
  return rows;
}
test("bounded differential counterexample discovery", async () => {
  let inspected = 0;
  for (const seed of seeds) for (const args of candidates(seed)) {
    if (inspected++ >= 5000) return;
    try {
      const expected = await reference(...args);
      const actual = await misconception(...args);
      if (!isDeepStrictEqual(expected, actual) && expected !== undefined) {
        console.log("__SPAR_COUNTEREXAMPLE__" + JSON.stringify({ args, expected, actual }));
        return;
      }
    } catch {}
  }
});
`;
}
