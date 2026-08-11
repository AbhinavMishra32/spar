import { createHash, randomUUID } from "node:crypto";
import { questionDesignSchema, type QuestionDesign } from "@spar/domain";
import { runLimits } from "./limits.js";

export type ValidationRun = { exitCode: number; stdout: string; stderr: string; durationMs: number };
export type ValidationRunner = (files: Record<string,string>, command: string, limits: { timeoutMs: number; memoryMb: number }) => Promise<ValidationRun>;
export type ValidationReport = { id: string; valid: boolean; contentHash: string; checks: Array<{ name: string; passed: boolean; detail: string }>; validatedAt: string };

export async function compileQuestion(untrustedDesign: unknown, run: ValidationRunner): Promise<{ design: QuestionDesign; report: ValidationReport }> {
  let design = normalizeDesign(normalizeFileDescriptors(questionDesignSchema.parse(untrustedDesign)));

  // Shape is checked before anything is executed. A candidate whose tests can
  // never reach its implementation fails four sandbox runs and reports only
  // that the command exited non-zero; naming the structural fault directly is
  // both faster and the difference between a repairable rejection and a guess.
  const structural = preflight(design);
  if (structural.some((check) => !check.passed)) {
    return { design, report: { id: randomUUID(), valid: false, contentHash: createHash("sha256").update(stableJson(design)).digest("hex"), checks: structural, validatedAt: new Date().toISOString() } };
  }

  let differentialDiagnostics: string[] = [];
  if (design.language === "javascript") {
    design = await materializeJavascriptOracles(design, run);
    const differential = await materializeDifferentialHiddenTests(design, run);
    design = differential.design;
    differentialDiagnostics = differential.diagnostics;
  }
  const checks: ValidationReport["checks"] = [...structural];
  const reference = await run({ ...design.starterFiles, ...design.referenceFiles, ...design.visibleTests, ...design.hiddenTests }, design.runCommand, runLimits(design.language));
  checks.push({ name: "reference solution", passed: reference.exitCode === 0, detail: summarize(reference) });
  checks.push(structuredResultCheck("reference case results", reference, "passed"));
  // Whether each misconception replaces the implementation was already settled
  // structurally, so this loop only measures behaviour.
  for (const [index, incorrect] of design.knownIncorrectFiles.entries()) {
    const visibleResult = await run({ ...design.starterFiles, ...incorrect, ...design.visibleTests }, design.runCommand, runLimits(design.language));
    checks.push({ name: `known incorrect ${index + 1} passes visible`, passed: visibleResult.exitCode === 0, detail: visibleResult.exitCode === 0 ? "Plausible misconception passes the learner-visible contract" : summarize(visibleResult) });
    checks.push(structuredResultCheck(`known incorrect ${index + 1} visible case results`, visibleResult, "passed"));
    const hiddenResult = await run({ ...design.starterFiles, ...incorrect, ...design.visibleTests, ...design.hiddenTests }, design.runCommand, runLimits(design.language));
    checks.push({ name: `known incorrect ${index + 1} fails hidden`, passed: hiddenResult.exitCode !== 0, detail: hiddenResult.exitCode !== 0 ? "Targeted hidden tests rejected the misconception" : differentialDiagnostics[index] ?? "Incorrect implementation passed visible and hidden tests" });
    checks.push(structuredResultCheck(`known incorrect ${index + 1} failure case results`, hiddenResult, "failed"));
  }
  const visibleOnly = await run({ ...design.starterFiles, ...design.referenceFiles, ...design.visibleTests }, design.runCommand, runLimits(design.language));
  checks.push({ name: "visible test agreement", passed: visibleOnly.exitCode === 0, detail: summarize(visibleOnly) });
  checks.push(structuredResultCheck("visible case results", visibleOnly, "passed"));
  checks.push({ name: "targeted hidden coverage", passed: design.hiddenTests && Object.keys(design.hiddenTests).length > 0 && design.expectedFailureSignatures.length > 0, detail: `${Object.keys(design.hiddenTests).length} hidden files cover ${design.expectedFailureSignatures.length} expected signatures` });
  checks.push({ name: "accidental difficulty budget", passed: design.accidentalDifficulty.length <= 3, detail: design.accidentalDifficulty.join(", ") || "No incidental complexity declared" });
  const contentHash = createHash("sha256").update(stableJson(design)).digest("hex");
  return { design, report: { id: randomUUID(), valid: checks.every((check) => check.passed), contentHash, checks, validatedAt: new Date().toISOString() } };
}

type VerdictKind = "passed" | "failed";

/**
 * A challenge is not publishable merely because its process exits correctly.
 * The learner-facing runner needs one protocol point per case. TAP and Spar's
 * deliberately tiny `ok - name` protocol are both accepted because every
 * supported language can print the latter without a dependency.
 *
 * Checking a known-incorrect run is important: it proves the harness reports
 * its negative branch too. A harness that prints `ok` before calling assert
 * would otherwise pass reference validation and still collapse to raw output
 * precisely when the learner needs expected/actual evidence.
 */
function structuredResultCheck(name: string, run: ValidationRun, expected: VerdictKind): ValidationReport["checks"][number] {
  const verdicts = structuredVerdicts(`${run.stdout}\n${run.stderr}`);
  const matching = expected === "passed" ? verdicts.passed : verdicts.failed;
  const passed = verdicts.total > 0 && matching > 0;
  return {
    name,
    passed,
    detail: passed
      ? `${verdicts.total} structured case verdict${verdicts.total === 1 ? "" : "s"} (${verdicts.passed} passed, ${verdicts.failed} failed)`
      : expected === "passed"
        ? "The run emitted no passing case verdicts. Emit TAP, or one `ok - case name` / `not ok - case name` line per case; silent assert-only tests cannot power the structured Test Result UI."
        : "The targeted misconception failed but emitted no failing case verdict. Catch each comparison, print `not ok - case name` with expected/actual values, continue the remaining cases, and exit non-zero after reporting them.",
  };
}

function structuredVerdicts(output: string): { total: number; passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  for (const line of output.replace(/\r\n/g, "\n").split("\n")) {
    const point = /^(not ok|ok)(?:\s+\d+)?(?:\s*[-–]\s*.*)?(?:\s+#\s*(?:SKIP|TODO).*)?$/i.exec(line.trim());
    if (!point) continue;
    if (point[1]?.toLowerCase() === "ok") passed += 1;
    else failed += 1;
  }
  return { total: passed + failed, passed, failed };
}
function summarize(run: ValidationRun) {
  if (run.exitCode === 0) return `Passed in ${run.durationMs}ms`;
  return `Exited ${run.exitCode} in ${run.durationMs}ms: ${diagnose(run)}`;
}

const DIAGNOSTIC_BUDGET = 700;

/**
 * The agent repairs a rejected candidate from this string and nothing else.
 * Collapsing every failure to "test command failed" discarded the one thing
 * that said what was wrong, so a bounded retry budget was spent re-making the
 * same mistake. Quote the toolchain instead, in the order that identifies the
 * fault: a compiler diagnostic means no test ever ran, so it outranks any
 * assertion text further down the log.
 */
export function diagnose(run: ValidationRun): string {
  const lines = `${run.stdout}\n${run.stderr}`
    .replace(/\r/g, "")
    // Sandbox roots are regenerated per validation; the path tells the agent
    // nothing and the UUID in it is pure noise in a bounded feedback string.
    .replace(/(^|[\s"'(])\/\S*?\/validation\/[0-9a-f-]{36}\//g, "$1")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (!lines.length) return "the test command failed without output";

  /* A killed run outranks everything else in the log, because whatever is below it
     was cut off mid-sentence. It also has to be named for what it is: the agent
     that read `Process stopped after 8000ms` as an ordinary failure went looking
     for the infinite loop in a correct three-line scan and rewrote it until its
     retry budget was gone. The only two things it can mean are said here. */
  const stopped = lines.find((line) => /^Process stopped after \d+ms/.test(line.trim()));
  if (stopped) {
    return `${stopped.trim()} The command was killed at the time limit, so no test result came back. That is either a program that does not terminate on some input, or a build slower than the limit — check for the non-terminating case first, and do not redesign a candidate whose logic the earlier runs already agreed with.`;
  }

  const compiler = lines.filter((line) => /\b(?:fatal error|error):/i.test(line) || /^\s*(?:Undefined symbols|ld:|clang|duplicate symbol)/.test(line));
  if (compiler.length) {
    const duplicateMain = compiler.some((line) => /duplicate symbol .*\bmain\b/.test(line));
    const detail = clamp(compiler);
    return duplicateMain
      ? `${detail} — two test files each define main(). Give every test file its own file and let the host build them separately; never define main() in more than one file linked together.`
      : detail;
  }

  // node:test reports the failing case as a subtest header plus an assertion
  // body; both together are what identifies which expectation disagreed.
  const failing = lines.filter((line) => /^#\s*Subtest:/.test(line) || /^\s*(?:error|expected|actual|operator|code):/.test(line));
  if (failing.length) return clamp(failing);

  const assertion = lines.filter((line) => /Assertion failed|AssertionError|Error:|Exception|Segmentation fault|abort|terminate called/i.test(line));
  if (assertion.length) return clamp(assertion);

  return clamp(lines.slice(0, 6));
}

function clamp(lines: string[]): string {
  // "# Subtest:" is TAP framing around the failing case's name; the name is the
  // information, so the marker is dropped once the line has been classified.
  const joined = lines.map((line) => line.trim().replace(/^#\s*Subtest:\s*/, "")).join(" | ");
  return joined.length > DIAGNOSTIC_BUDGET ? `${joined.slice(0, DIAGNOSTIC_BUDGET)}…` : joined;
}
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`; return JSON.stringify(value); }

const LANGUAGE_RULES = {
  javascript: { extensions: [".js", ".mjs", ".cjs"], test: /\.test\.js$/, runCommand: "node --test" },
  typescript: { extensions: [".ts", ".tsx"], test: /\.test\.ts$/, runCommand: "node --test" },
  python: { extensions: [".py"], test: /(^|\/)(test_.*|.*_test)\.py$/, runCommand: "python3 tests" },
  java: { extensions: [".java"], test: /Test\.java$/, runCommand: "javac && java tests" },
  c: { extensions: [".c", ".h"], test: /\.test\.c$/, runCommand: "clang && run tests" },
  cpp: { extensions: [".cpp", ".cc", ".cxx", ".h", ".hpp"], test: /\.cpp$/, runCommand: "clang++ && run tests" },
  go: { extensions: [".go"], test: /_test\.go$/, runCommand: "go test ./..." },
  rust: { extensions: [".rs"], test: /(?:_test|\.test)\.rs$/, runCommand: "rustc --test" },
  swift: { extensions: [".swift"], test: /\.test\.swift$/, runCommand: "swiftc && run tests" },
  ruby: { extensions: [".rb"], test: /(?:_test|\.test)\.rb$/, runCommand: "ruby tests" },
} as const;

/**
 * Repairs the mechanical mistakes rather than spending a retry on them. A
 * candidate rejected for a leading "./" teaches the agent nothing and costs the
 * learner a compile cycle, so anything decidable here is simply fixed; only
 * faults that require rewriting the design reach `preflight`.
 */
function normalizeDesign(design: QuestionDesign): QuestionDesign {
  const cleanPath = (file: string) => file.replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\\/g, "/");
  const cleanMap = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([file, content]) => [cleanPath(file), content]));
  return {
    ...design,
    starterFiles: cleanMap(design.starterFiles),
    referenceFiles: cleanMap(design.referenceFiles),
    visibleTests: cleanMap(design.visibleTests),
    hiddenTests: cleanMap(design.hiddenTests),
    knownIncorrectFiles: design.knownIncorrectFiles.map(cleanMap),
    // The host runner selects the toolchain from `language`; the declared
    // command is descriptive only, so a wrong one is corrected, never rejected.
    runCommand: LANGUAGE_RULES[design.language].runCommand,
  };
}

/**
 * Structural checks that need no execution. Each failure names the exact edit
 * that fixes it, because this text is the whole of what the agent gets to
 * repair from.
 */
function preflight(design: QuestionDesign): ValidationReport["checks"] {
  const checks: ValidationReport["checks"] = [];
  const rules = LANGUAGE_RULES[design.language];
  const pass = (name: string, detail: string) => checks.push({ name, passed: true, detail });
  const fail = (name: string, detail: string) => checks.push({ name, passed: false, detail });

  const referencePaths = Object.keys(design.referenceFiles);
  const starterPaths = Object.keys(design.starterFiles);
  const visiblePaths = Object.keys(design.visibleTests);
  const hiddenPaths = Object.keys(design.hiddenTests);

  if (!referencePaths.length) fail("reference implementation present", "referenceFiles is empty. Provide the complete working implementation at the same path the starter file uses.");
  else if (!visiblePaths.length) fail("visible tests present", "visibleTests is empty. Provide at least one learner-visible test file.");
  else if (!hiddenPaths.length) fail("hidden tests present", "hiddenTests is empty. Provide at least one hidden test file that the targeted misconception fails.");
  else pass("challenge file set", `${referencePaths.length} reference, ${visiblePaths.length} visible, ${hiddenPaths.length} hidden`);

  // The tests import the implementation by path. If the reference does not
  // land on a starter path, the learner edits a file no test ever loads.
  const sharedPath = referencePaths.filter((file) => starterPaths.includes(file));
  if (referencePaths.length && starterPaths.length && !sharedPath.length) {
    fail("reference replaces starter implementation", `No reference path matches a starter path. Starter has (${starterPaths.join(", ")}) and reference has (${referencePaths.join(", ")}). Both maps must use the exact same implementation path so the reference replaces the file the learner edits.`);
  } else if (sharedPath.length) pass("reference replaces starter implementation", `Shares ${sharedPath.join(", ")}`);

  // Checked here rather than after four sandbox runs: a misconception that
  // does not replace the implementation cannot be distinguished by any test.
  for (const [index, incorrect] of design.knownIncorrectFiles.entries()) {
    const replaced = Object.keys(incorrect).filter((file) => referencePaths.includes(file));
    if (!replaced.length) fail(`known incorrect ${index + 1} replaces reference implementation`, `Known-incorrect paths (${Object.keys(incorrect).join(", ") || "none"}) do not replace any reference path (${referencePaths.join(", ") || "none"}). Use the exact same implementation path.`);
    else pass(`known incorrect ${index + 1} replaces reference implementation`, `Replaces ${replaced.join(", ")}`);
  }

  const testPaths = [...visiblePaths, ...hiddenPaths];
  const overlapping = testPaths.filter((file) => referencePaths.includes(file) || starterPaths.includes(file));
  if (overlapping.length) fail("tests are separate files", `${overlapping.join(", ")} appears both as a test and as implementation. Tests must live in their own files so the implementation can be swapped underneath them.`);
  else pass("tests are separate files", "Implementation and tests occupy distinct paths");

  const wrongExtension = [...referencePaths, ...starterPaths, ...testPaths].filter((file) => !rules.extensions.some((extension) => file.endsWith(extension)));
  if (wrongExtension.length) fail("file extensions match the language", `${wrongExtension.join(", ")} do not use a ${design.language} extension (${rules.extensions.join(", ")}).`);
  else pass("file extensions match the language", `All paths use ${design.language} extensions`);

  if (design.language === "cpp" || design.language === "c") checks.push(...preflightNative(design, testPaths));
  else checks.push(...preflightNode(design, testPaths, rules.test));

  if (!design.expectedFailureSignatures.length) fail("expected failure signatures declared", "expectedFailureSignatures is empty. Name at least one observable way the targeted misconception fails.");
  else pass("expected failure signatures declared", `${design.expectedFailureSignatures.length} declared`);

  return checks;
}

/**
 * C++ has no test runner, so each test file is its own program. The host builds
 * and runs them one at a time against the shared implementation, which only
 * works if exactly the test files carry `main`.
 */
function preflightNative(design: QuestionDesign, testPaths: string[]): ValidationReport["checks"] {
  const checks: ValidationReport["checks"] = [];
  const definesMain = (source: string) => /\bint\s+main\s*\(/.test(source);
  const allTests = { ...design.visibleTests, ...design.hiddenTests };

  const missingMain = testPaths.filter((file) => !definesMain(allTests[file] ?? ""));
  if (missingMain.length) {
    checks.push({ name: `each ${design.language} test defines main`, passed: false, detail: `${missingMain.join(", ")} does not define int main(). Every native test file must be a standalone program.` });
  } else checks.push({ name: `each ${design.language} test defines main`, passed: true, detail: `${testPaths.length} standalone test programs` });

  const implementationWithMain = Object.entries({ ...design.referenceFiles, ...design.starterFiles })
    .filter(([file, source]) => /\.(?:c|cpp|cc|cxx)$/.test(file) && definesMain(source))
    .map(([file]) => file);
  if (implementationWithMain.length) {
    checks.push({ name: "implementation defines no main", passed: false, detail: `${implementationWithMain.join(", ")} defines int main(). The implementation is linked into every test program, so a main() here collides with the test's own. Move it out and expose the behaviour as a function declared in a header.` });
  } else checks.push({ name: "implementation defines no main", passed: true, detail: "Implementation is a library translation unit" });

  // A test that includes a header nobody ships fails to compile, and the
  // resulting diagnostic points at the include rather than at the omission.
  const available = new Set([...Object.keys(design.starterFiles), ...Object.keys(design.referenceFiles), ...testPaths].map((file) => file.slice(file.lastIndexOf("/") + 1)));
  const missingHeaders = [...new Set(Object.values(allTests).flatMap((source) => [...source.matchAll(/#include\s+"([^"]+)"/g)].map((match) => match[1] ?? "")))]
    .filter((header) => header && !available.has(header.slice(header.lastIndexOf("/") + 1)));
  if (missingHeaders.length) {
    checks.push({ name: "included headers are provided", passed: false, detail: `Tests include ${missingHeaders.join(", ")}, which no starter, reference, or test file provides. Ship the header in starterFiles and referenceFiles, or include the implementation's actual header name.` });
  } else checks.push({ name: "included headers are provided", passed: true, detail: "Every quoted include resolves to a shipped file" });

  return checks;
}

/** Node's runner discovers `*.test.js`/`*.test.ts`, and a test that imports nothing cannot exercise the implementation. */
function preflightNode(design: QuestionDesign, testPaths: string[], testPattern: RegExp): ValidationReport["checks"] {
  const checks: ValidationReport["checks"] = [];
  const misnamed = testPaths.filter((file) => !testPattern.test(file));
  if (misnamed.length) {
    checks.push({ name: "tests use the runner's naming", passed: false, detail: `${misnamed.join(", ")} will not be discovered. Node's test runner only collects files matching ${testPattern.source}; rename them.` });
  } else checks.push({ name: "tests use the runner's naming", passed: true, detail: `${testPaths.length} discoverable test files` });

  // Deliberately not checked here: whether each test imports the implementation
  // relatively. A test that inlines the logic is already caught behaviourally —
  // the known-incorrect implementation would pass the hidden tests — and a
  // static check for it rejects legitimate designs that reach the
  // implementation indirectly. A false rejection costs a whole retry, so the
  // behavioural signal is the one worth trusting.
  return checks;
}

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
      const result = await run({ ...design.starterFiles, ...design.referenceFiles, [file]: oracleSource }, design.runCommand, runLimits(design.language));
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
    const candidateSources = [incorrectSource];
    for (let candidateIndex = 0; candidateIndex < candidateSources.length; candidateIndex += 1) {
      const candidateSource = candidateSources[candidateIndex];
      if (!candidateSource) continue;
      const visible = await run({ ...design.starterFiles, [implementationPath]: candidateSource, ...design.visibleTests }, design.runCommand, runLimits(design.language));
      if (candidateIndex === 0) candidateSources.push(...synthesizeTargetedMutants(referenceSource, visible.exitCode !== 0));
      if (visible.exitCode !== 0) continue;
      const existingHidden = await run({ ...design.starterFiles, [implementationPath]: candidateSource, ...design.visibleTests, ...hiddenTests }, design.runCommand, runLimits(design.language));
      if (existingHidden.exitCode !== 0) {
        knownIncorrectFiles[index] = { ...incorrect, [implementationPath]: candidateSource };
        foundCounterexample = true;
        break;
      }
      const discovery = await run({ ...design.starterFiles, ...design.referenceFiles, [incorrectPath]: candidateSource, [harnessPath]: harness }, design.runCommand, runLimits(design.language));
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

function synthesizeTargetedMutants(referenceSource: string, repairVisibleFailure = false): string[] {
  const candidates = new Set([
    referenceSource.replace(/\bwhile\s*\(/, "if ("),
    referenceSource.replace(/return\s+([A-Za-z_$][\w$]*)\.slice\([^;]+\)/, "return $1"),
    referenceSource.replace(/Math\.max\s*\(/, "Math.min("),
    referenceSource.replace(/>=/, ">"),
    referenceSource.replace(/<=/, "<"),
  ]);

  if (repairVisibleFailure) {
    // Neutralize one ordinary assignment at a time. This catches common
    // interview misconceptions such as updating only one branch while keeping
    // the candidate syntactically valid and lets the runner decide whether that
    // mutant is visible-safe and hidden-distinguishable.
    for (const match of referenceSource.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*=\s*([^;{}]+);/g)) {
      if (match.index === undefined || !match[0] || !match[1]) continue;
      candidates.add(replaceSpan(referenceSource, match.index, match.index + match[0].length, `${match[1]} = ${match[1]};`));
    }

    // Generate single-site operator mutations rather than mutating only the
    // first occurrence. Bounded differential execution remains the authority;
    // these strings are merely candidates and are never trusted directly.
    for (const [pattern, replacement] of [
      [/\bwhile\s*\(/g, "if ("],
      [/>=/g, ">"],
      [/<=/g, "<"],
      [/===/g, "!=="],
      [/!==/g, "==="],
      [/\+\+/g, "--"],
      [/--/g, "++"],
    ] as const) {
      for (const match of referenceSource.matchAll(pattern)) {
        if (match.index === undefined || !match[0]) continue;
        candidates.add(replaceSpan(referenceSource, match.index, match.index + match[0].length, replacement));
      }
    }
  }

  return [...candidates].filter((candidate) => candidate !== referenceSource).slice(0, 24);
}

function replaceSpan(source: string, start: number, end: number, replacement: string): string {
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
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
