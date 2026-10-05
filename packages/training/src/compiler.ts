import { createHash, randomUUID } from "node:crypto";
import { questionDesignSchema, type QuestionDesign } from "@spar/domain";
import { runLimits } from "./limits.js";
import { materializeFiles, parseMaterialized, parseProbe, probeFiles, probeTarget, pythonModuleName, pythonMutants, settleHostMutants, settleMisconceptions } from "./pythonProbe.js";

export type ValidationRun = { exitCode: number; stdout: string; stderr: string; durationMs: number };
export type ValidationRunner = (files: Record<string,string>, command: string, limits: { timeoutMs: number; memoryMb: number }) => Promise<ValidationRun>;
export type ValidationReport = {
  id: string;
  valid: boolean;
  contentHash: string;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  /** Measured from the reference runs, not inferred from how many test files
   *  contain them. The renderer needs this before a fail-fast submission starts
   *  so every unvisited case can still have a grey place in the grid. */
  caseCounts?: { visible: number; hidden: number };
  validatedAt: string;
};

/**
 * One sandbox run of a candidate, reported as it starts and as it lands so the
 * authoring row can show the tests being run rather than only their verdict.
 *
 * Counts only, except for the learner-visible file: its case names are already
 * on the page the learner will read. Nothing here may carry a hidden case's name
 * or input, or a line of the reference — those are the answer.
 */
export type CompileProgress = {
  id: string;
  label: string;
  /** What this run is supposed to do: the reference passes, a known-incorrect
   *  implementation is caught. */
  expect: "pass" | "fail";
  state: "running" | "passed" | "failed";
  cases?: { total: number; passed: number; failed: number };
  /** Named visible cases and whether each passed, for the visible-only run. */
  visibleCases?: Array<{ name: string; passed: boolean }>;
  durationMs?: number;
};
export type CompileObserver = (event: CompileProgress) => void;

/** Cases, visible and hidden together, the reference must actually pass before
 *  a challenge is publishable — see the `case volume` check. */
const MIN_EXECUTED_CASES = { function: 12, module: 12, repair: 8, extension: 8, repository: 8 } as const;
/** Named, readable cases in the visible file: the contract the learner reads. */
const MIN_VISIBLE_CASES = 4;
/** Wall-clock the Python probe gives itself, inside the runner's own limit. */
const PROBE_BUDGET_SECONDS = 7;
/** Sandbox runs one compile may have in flight at once. */
const RUN_CONCURRENCY = 4;
/** Languages whose hidden tests the host can check with its own mutants of the
 *  reference, so a design may leave `knownIncorrectFiles` out. */
const HOST_MUTANT_LANGUAGES: ReadonlySet<QuestionDesign["language"]> = new Set(["javascript", "typescript", "python"]);

/**
 * Who wrote the candidate, which is the one thing the case-volume bar depends
 * on.
 *
 * The bar exists to break a habit of the model's: three hand-written cases,
 * which grade nothing. It does not apply to `host` — designs Spar itself wrote,
 * which today means the fixtures that exercise the other checks. Everything
 * else in this file applies to both, and the exemption is named at the call site
 * rather than inferred here.
 */
export type DesignOrigin = "authored" | "host";

export async function compileQuestion(untrustedDesign: unknown, execute: ValidationRunner, origin: DesignOrigin = "authored", observe?: CompileObserver): Promise<{ design: QuestionDesign; report: ValidationReport }> {
  let design = normalizeDesign(normalizeFileDescriptors(questionDesignSchema.parse(untrustedDesign)));
  /* Every sandbox run of one compile goes through one gate. Each run writes its
     own validation directory, so independent runs are safe side by side; the
     limit keeps a compile from starting a dozen toolchains at once. */
  const slot = concurrencyLimit(RUN_CONCURRENCY);
  const run: ValidationRunner = (files, command, limits) => slot(() => execute(files, command, limits));
  let runs = 0;
  /* A reported run. The oracle materialisation below uses the bare runner: it
     is the compiler preparing the tests, not a verdict on the candidate. */
  const observed = (label: string, expect: "pass" | "fail", files: Record<string, string>, command: string, limits: { timeoutMs: number; memoryMb: number }, visible = false): Promise<ValidationRun> => slot(async () => {
    const id = `run-${runs++}`;
    observe?.({ id, label, expect, state: "running" });
    const result = await execute(files, command, limits);
    const output = `${result.stdout}\n${result.stderr}`;
    const ok = expect === "pass" ? result.exitCode === 0 : result.exitCode !== 0;
    observe?.({
      id, label, expect, state: ok ? "passed" : "failed",
      cases: structuredVerdicts(output),
      ...(visible ? { visibleCases: namedVerdicts(output) } : {}),
      durationMs: result.durationMs,
    });
    return result;
  });

  // Shape is checked before anything is executed. A candidate whose tests can
  // never reach its implementation fails four sandbox runs and reports only
  // that the command exited non-zero; naming the structural fault directly is
  // both faster and the difference between a repairable rejection and a guess.
  const structural = preflight(design);
  observe?.({ id: "preflight", label: "Structural checks", expect: "pass", state: structural.every((check) => check.passed) ? "passed" : "failed", cases: { total: structural.length, passed: structural.filter((check) => check.passed).length, failed: structural.filter((check) => !check.passed).length } });
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
  // Whether each misconception replaces the implementation was already settled
  // structurally, so this only measures behaviour. Its two runs are independent.
  const misconception = async (index: number, incorrect: Record<string, string>, suffix = ""): Promise<ValidationReport["checks"]> => {
    const which = design.knownIncorrectFiles.length > 1 ? ` ${index + 1}` : "";
    const [visibleResult, hiddenResult] = await Promise.all([
      observed(`Plausible wrong solution${which} passes the visible tests${suffix}`, "pass", { ...design.starterFiles, ...incorrect, ...design.visibleTests }, design.runCommand, runLimits(design.language)),
      observed(`Hidden tests catch the wrong solution${which}${suffix}`, "fail", { ...design.starterFiles, ...incorrect, ...design.visibleTests, ...design.hiddenTests }, design.runCommand, runLimits(design.language)),
    ]);
    return [
      { name: `known incorrect ${index + 1} passes visible`, passed: visibleResult.exitCode === 0, detail: visibleResult.exitCode === 0 ? "Plausible misconception passes the learner-visible contract" : `${summarize(visibleResult)}${differentialDiagnostics[index] ? ` — ${differentialDiagnostics[index]}` : ""}` },
      structuredResultCheck(`known incorrect ${index + 1} visible case results`, visibleResult, "passed"),
      { name: `known incorrect ${index + 1} fails hidden`, passed: hiddenResult.exitCode !== 0, detail: hiddenResult.exitCode !== 0 ? "Targeted hidden tests rejected the misconception" : differentialDiagnostics[index] ?? uncaughtMisconception(hiddenResult) },
      structuredResultCheck(`known incorrect ${index + 1} failure case results`, hiddenResult, "failed"),
    ];
  };
  /* The reference, the visible-only run and every misconception pair do not
     depend on one another, so they run together. The checks are still pushed
     in the order they always were, and the runs start in that order too. */
  const referenceRun = observed("Reference solution against every test", "pass", { ...design.starterFiles, ...design.referenceFiles, ...design.visibleTests, ...design.hiddenTests }, design.runCommand, runLimits(design.language));
  const firstMisconceptions = Promise.all(design.knownIncorrectFiles.map((incorrect, index) => misconception(index, incorrect)));
  const visibleOnlyRun = observed("Visible tests against the reference", "pass", { ...design.starterFiles, ...design.referenceFiles, ...design.visibleTests }, design.runCommand, runLimits(design.language), true);
  let [reference, visibleOnly, perMisconception] = await Promise.all([referenceRun, visibleOnlyRun, firstMisconceptions]);
  /* The most common first rejection of a Python candidate: hidden expected
     values worked out by hand, and wrong — `(5, [2, 2, 2, 1])` expected 2 when
     `[2, 2, 1]` sums to exactly 5. When the reference passes every visible case,
     it is the learner's contract made executable, so it is the oracle for the
     hidden table: the host puts its answers in place of the literals that
     disagree, the same thing the JavaScript path does above. Visible
     expectations are never touched, and the rewrite is kept only if the
     reference then passes everything; otherwise the original failure stands. */
  if (design.language === "python" && reference.exitCode !== 0) {
    const target = probeTarget(design);
    if (target) {
      const materialized = parseMaterialized((await run(materializeFiles(design, target), design.runCommand, runLimits(design.language))).stdout);
      if (materialized?.visible && materialized.rewrites > 0) {
        const corrected = { ...design, hiddenTests: { ...design.hiddenTests, ...materialized.files } };
        const retried = await observed("Reference solution against every test (hidden expectations from the reference)", "pass", { ...corrected.starterFiles, ...corrected.referenceFiles, ...corrected.visibleTests, ...corrected.hiddenTests }, corrected.runCommand, runLimits(corrected.language));
        if (retried.exitCode === 0) {
          design = corrected;
          reference = retried;
          checks.push({ name: "hidden expectations from the reference", passed: true, detail: `${materialized.rewrites} hand-written hidden expected value${materialized.rewrites === 1 ? "" : "s"} disagreed with the reference, which passes every visible case. The host replaced ${materialized.rewrites === 1 ? "it" : "them"} with the reference's answers.` });
          // The hidden tests changed, so the misconceptions are measured again against them.
          perMisconception = await Promise.all(design.knownIncorrectFiles.map((incorrect, index) => misconception(index, incorrect)));
        }
      }
    }
  }
  checks.push({ name: "reference solution", passed: reference.exitCode === 0, detail: summarize(reference) });
  checks.push(structuredResultCheck("reference case results", reference, "passed"));
  /* Python has no oracle rewriting or differential search of its own inside the
     tests, and it is where nearly every rejected candidate was. When a
     misconception check fails, settle it by execution: find the input the hidden
     tests missed, or prove the misconception equivalent and replace it. See
     pythonProbe.ts. Only paid when something failed, and only once the
     reference passes, because a probe measured against a broken reference
     measures nothing. */
  const failing = new Set(perMisconception.flatMap((group, index) => group.some((check) => !check.passed) ? [index] : []));
  if (design.language === "python" && failing.size && reference.exitCode === 0) {
    const target = probeTarget(design);
    if (target) {
      const mutants = pythonMutants(design.referenceFiles[target.path] ?? "");
      const probeRun = await observed("Searching for inputs that separate the wrong solution", "pass", probeFiles(design, target, mutants, PROBE_BUDGET_SECONDS), design.runCommand, runLimits(design.language));
      const probe = parseProbe(probeRun.stdout);
      if (probe) {
        const settled = settleMisconceptions(design, target, mutants, probe, failing);
        design = settled.design;
        checks.push(...settled.notes);
        for (const [index, detail] of settled.equivalent) differentialDiagnostics[index] = detail;
        const rerun: Array<Promise<void>> = [];
        for (const index of failing) {
          const waived = settled.waived.get(index);
          if (waived) {
            perMisconception[index] = [{ name: `known incorrect ${index + 1} gate`, passed: true, detail: waived }];
            continue;
          }
          if (settled.equivalent.has(index)) {
            perMisconception[index] = [
              { name: `known incorrect ${index + 1} is a real misconception`, passed: false, detail: settled.equivalent.get(index)! },
              // The hidden-coverage advice would send the repair back to the tests.
              ...perMisconception[index]!.map((check) => check.name === `known incorrect ${index + 1} fails hidden` && !check.passed ? { ...check, detail: `No test can catch it — see "known incorrect ${index + 1} is a real misconception".` } : check),
            ];
          } else if (settled.changed.has(index)) {
            rerun.push(misconception(index, design.knownIncorrectFiles[index]!, " (host revision)").then((group) => { perMisconception[index] = group; }));
          }
        }
        await Promise.all(rerun);
      }
    }
  }
  checks.push(...perMisconception.flat());
  /* No authored wrong solution: the host makes its own. For JavaScript,
     TypeScript and Python the reference is mutated one site at a time and the
     hidden tests must reject those mutants, which is the question a
     known-incorrect file answers — do the hidden tests tell a wrong solution
     from a right one — asked of wrong solutions the model did not get to pick.
     Preflight already rejected an empty list for every other language. Only
     run against a passing reference, whose failure already rejects the design. */
  if (!design.knownIncorrectFiles.length && reference.exitCode === 0) {
    if (design.language === "python") {
      const path = Object.keys(design.referenceFiles).find((file) => Object.hasOwn(design.starterFiles, file) && pythonModuleName(file));
      const target = path ? { path, module: pythonModuleName(path)! } : null;
      if (!target) {
        checks.push({ name: "host mutant check", passed: false, detail: "No knownIncorrectFiles, and the host found no importable Python implementation shared by starterFiles and referenceFiles to mutate. Provide knownIncorrectFiles: one to three plausible wrong implementations at the reference's path." });
      } else {
        const mutants = pythonMutants(design.referenceFiles[target.path] ?? "");
        const probeRun = await observed("Hidden tests against host-made wrong solutions", "pass", probeFiles(design, target, mutants, PROBE_BUDGET_SECONDS), design.runCommand, runLimits(design.language));
        const settled = settleHostMutants(design, target, mutants, parseProbe(probeRun.stdout));
        design = settled.design;
        checks.push(...settled.checks);
      }
    } else {
      checks.push(await hostMutantCheck(design, run, reference.durationMs, observe));
    }
  }
  checks.push({ name: "visible test agreement", passed: visibleOnly.exitCode === 0, detail: summarize(visibleOnly) });
  checks.push(structuredResultCheck("visible case results", visibleOnly, "passed"));
  /* Whether the hidden tests catch the misconception is measured above. The
     declared signatures are the author's description of it: useful context,
     never a reason to reject a candidate that demonstrably works. */
  checks.push({ name: "targeted hidden coverage", passed: Object.keys(design.hiddenTests).length > 0, detail: `${Object.keys(design.hiddenTests).length} hidden files${design.expectedFailureSignatures.length ? ` cover ${design.expectedFailureSignatures.length} expected signatures` : ""}` });
  /**
   * How many cases actually ran, visible and hidden together.
   *
   * Measured from the reference run's own verdicts rather than counted off the
   * test source, so it is the number of cases that executed and agreed, not the
   * number somebody claims to have written. Three hand-written cases is what a
   * challenge tends to arrive with, and three cases is not a grader: it is a
   * spot check that a wrong solution passes routinely and a right one fails on
   * an edge nobody thought of.
   */
  const volume = structuredVerdicts(`${reference.stdout}\n${reference.stderr}`);
  const requiredCases = MIN_EXECUTED_CASES[design.kind];
  checks.push({
    name: "case volume",
    passed: origin === "host" || volume.total >= requiredCases,
    detail: volume.total >= requiredCases
      ? `${volume.total} cases executed against the reference`
      : design.kind === "function"
        ? `Only ${volume.total} cases ran across the visible and hidden tests; at least ${requiredCases} are required. Add hidden cases: targeted ones for the boundaries and the plausible mistakes, or a seeded sweep over generated inputs whose expected answers come from an oracle, with one verdict line per case and the input in the case name.`
        : `Only ${volume.total} cases ran across the visible and hidden tests; at least ${requiredCases} are required for a ${design.kind} challenge. Add meaningful hidden scenarios that exercise the task's behavior, boundaries, and interactions, with one verdict per case.`,
  });
  /* Curated cases are a separate requirement from volume, and pointed the other
     way: a suite that is only a sweep tells the learner nothing about what the
     problem means. The visible file is the contract they read. */
  const curated = structuredVerdicts(`${visibleOnly.stdout}\n${visibleOnly.stderr}`);
  checks.push({
    name: "curated visible cases",
    passed: origin === "host" || curated.total >= MIN_VISIBLE_CASES,
    detail: curated.total >= MIN_VISIBLE_CASES
      ? `${curated.total} named visible cases state the contract`
      : `Only ${curated.total} visible cases. Write at least ${MIN_VISIBLE_CASES} named by hand: the ordinary case and each boundary. The case that separates the right idea from the plausible wrong one belongs in hiddenTests, and a generated sweep does not belong in the visible file.`,
  });
  checks.push({ name: "accidental difficulty budget", passed: design.accidentalDifficulty.length <= 3, detail: design.accidentalDifficulty.join(", ") || "No incidental complexity declared" });
  const contentHash = createHash("sha256").update(stableJson(design)).digest("hex");
  return {
    design,
    report: {
      id: randomUUID(),
      valid: checks.every((check) => check.passed),
      contentHash,
      checks,
      caseCounts: { visible: curated.total, hidden: Math.max(0, volume.total - curated.total) },
      validatedAt: new Date().toISOString(),
    },
  };
}

/** At most `limit` of the given tasks in flight at once, in arrival order. */
function concurrencyLimit(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

/** Host mutants tried per JavaScript or TypeScript compile without authored wrong solutions. */
const MAX_HOST_MUTANTS = 12;

/**
 * The hidden-test gate for a JavaScript or TypeScript design that brought no
 * known-incorrect files.
 *
 * Single-site mutations of the reference stand in for them. Each mutant runs
 * against the hidden tests alone, and one the hidden tests let through runs
 * against the visible ones too. A mutant neither file rejects may not change
 * any answer at all, so it is not counted against the suite; what is required
 * is that the tests reject some mutant, that the hidden tests on their own
 * reject at least half of the ones the suite rejects, and that a rejection is
 * reported as a failing case verdict rather than only an exit code.
 */
async function hostMutantCheck(design: QuestionDesign, run: ValidationRunner, referenceMs: number, observe?: CompileObserver): Promise<ValidationReport["checks"][number]> {
  const name = "host mutant check";
  const rules = LANGUAGE_RULES[design.language];
  const path = Object.keys(design.referenceFiles).find((file) => Object.hasOwn(design.starterFiles, file) && rules.extensions.some((extension) => file.endsWith(extension)));
  const source = path ? design.referenceFiles[path] ?? "" : "";
  const mutants = path ? synthesizeTargetedMutants(source, true).slice(0, MAX_HOST_MUTANTS) : [];
  if (!path || !mutants.length) {
    return { name, passed: false, detail: "No knownIncorrectFiles, and the host could not make single-site mutations of the reference implementation to check the hidden tests with. Provide knownIncorrectFiles: one to three plausible wrong implementations at the reference's path." };
  }
  /* A mutant that never terminates (`i++` turned `i--`) would hold a slot for
     the whole language limit. It is rejected either way, so it gets a few times
     what the full reference run took, which still covers a cold toolchain. */
  const limits = { ...runLimits(design.language), timeoutMs: Math.min(runLimits(design.language).timeoutMs, Math.max(3_000, referenceMs * 4)) };
  const label = "Hidden tests against host-made wrong solutions";
  observe?.({ id: "host-mutants", label, expect: "fail", state: "running" });
  const started = Date.now();
  const results = await Promise.all(mutants.map(async (mutant) => {
    const files = { ...design.starterFiles, ...design.referenceFiles, [path]: mutant };
    const hidden = await run({ ...files, ...design.hiddenTests }, design.runCommand, limits);
    if (hidden.exitCode !== 0) return { killed: true, byHidden: true, reported: structuredVerdicts(`${hidden.stdout}\n${hidden.stderr}`).failed > 0 };
    const visible = await run({ ...files, ...design.visibleTests }, design.runCommand, limits);
    return { killed: visible.exitCode !== 0, byHidden: false, reported: false };
  }));
  const killable = results.filter((result) => result.killed).length;
  const byHidden = results.filter((result) => result.byHidden).length;
  const reported = results.some((result) => result.reported);
  const passed = killable > 0 && byHidden * 2 >= killable && reported;
  observe?.({ id: "host-mutants", label, expect: "fail", state: passed ? "passed" : "failed", cases: { total: mutants.length, passed: byHidden, failed: mutants.length - byHidden }, durationMs: Date.now() - started });
  const tally = `Of ${mutants.length} single-site mutations of the reference, the tests rejected ${killable} and the hidden tests alone rejected ${byHidden}.`;
  if (passed) return { name, passed, detail: `${tally} The hidden tests separate wrong solutions from the reference.` };
  if (!killable) return { name, passed, detail: `${tally} No test rejects any mutation of the reference, so nothing shows the tests reach the implementation. Add hidden cases whose answers change when a comparison, bound or update in the reference changes, or provide knownIncorrectFiles.` };
  if (byHidden * 2 < killable) return { name, passed, detail: `${tally} The hidden tests miss most of the mistakes the visible tests catch, so they barely grade the implementation. Add hidden cases that cover the boundaries and the ordinary path, not only one corner, or provide knownIncorrectFiles.` };
  return { name, passed, detail: `${tally} The hidden tests failed without printing a failing case verdict. Catch each comparison, print \`not ok - case name\` with expected/actual values, continue the remaining cases, and exit non-zero after reporting them.` };
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
        /* The misconception did not fail at all. This used to say it "failed but
           emitted no failing case verdict", which is false whenever the run
           passed, and it sent every repair round off to rework how the harness
           prints — six rounds in the traced case, each leaving the hidden tests
           exactly as unable to catch the mistake as before. Say which of the two
           it actually is. */
        : run.exitCode === 0
          ? `No hidden case failed (${verdicts.passed} ok, 0 not ok), so there is no failing verdict to report. This is the same fault as the "fails hidden" check, not a harness-format fault: do not change how cases are printed, change what the hidden cases test.`
          : "The targeted misconception failed but emitted no failing case verdict. Catch each comparison, print `not ok - case name` with expected/actual values, continue the remaining cases, and exit non-zero after reporting them.",
  };
}

/**
 * What to say when the known-incorrect implementation passes every hidden case.
 *
 * "Incorrect implementation passed visible and hidden tests" is true and does
 * not say what to do, and a repair model reading it tends to add more of the
 * same cases — another sweep over inputs that never reach the mistake. The
 * actionable fact is that no hidden input distinguishes the two
 * implementations, and there are only two ways out: find an input that does, or
 * admit the "incorrect" implementation is not wrong.
 */
function uncaughtMisconception(run: ValidationRun): string {
  const verdicts = structuredVerdicts(`${run.stdout}\n${run.stderr}`);
  const counted = verdicts.total ? ` — all ${verdicts.passed} hidden case verdicts were ok` : "";
  return `Incorrect implementation passed visible and hidden tests${counted}. No hidden input reaches its mistake, so adding more cases of the same shape will not help. Read the known-incorrect implementation beside the reference, name the exact input condition where they diverge, trace both on one small concrete input that meets it, and add that input to hiddenTests as a named case expecting the reference's answer (keep any sweep, but make its generator produce that condition). If no input makes them differ, the known-incorrect implementation is actually correct: replace it with one whose mistake a specific hidden case exposes.`;
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
/** Each `ok N - name` line as a named verdict. Only ever read off the visible
 *  run, whose case names are the learner's own contract. */
function namedVerdicts(output: string): Array<{ name: string; passed: boolean }> {
  const named: Array<{ name: string; passed: boolean }> = [];
  for (const line of output.replace(/\r\n/g, "\n").split("\n")) {
    const point = /^(not ok|ok)(?:\s+\d+)?(?:\s*[-–]\s*(.*?))?(?:\s+#\s*(?:SKIP|TODO).*)?$/i.exec(line.trim());
    if (!point) continue;
    named.push({ name: (point[2] ?? "").trim() || `case ${named.length + 1}`, passed: point[1]?.toLowerCase() === "ok" });
  }
  return named;
}
function summarize(run: ValidationRun) {
  if (run.exitCode === 0) return `Passed in ${run.durationMs}ms`;
  return `Exited ${run.exitCode} in ${run.durationMs}ms: ${diagnose(run)}`;
}


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

  const tapFraming = (line: string) => /^\s*error:\s*(?:\|-|'\d+ subtests? failed')\s*$/.test(line);
  const compiler = lines.filter((line) => !tapFraming(line) && (/\b(?:fatal error|error):/i.test(line) || /^\s*(?:Undefined symbols|ld:|clang|duplicate symbol)/.test(line)));
  if (compiler.length) {
    const duplicateMain = compiler.some((line) => /duplicate symbol .*\bmain\b/.test(line));
    const detail = clamp(compiler);
    return duplicateMain
      ? `${detail} — two test files each define main(). Give every test file its own file and let the host build them separately; never define main() in more than one file linked together.`
      : detail;
  }

  const failedAt = lines.findIndex((line) => /^not ok\b/.test(line.trim()));
  if (failedAt >= 0) {
    const caseName = lines.slice(0, failedAt).reverse().find((line) => /^#\s*Subtest:/.test(line)) ?? lines[failedAt] ?? "test failed";
    const details = lines.slice(failedAt + 1).filter((line) => !tapFraming(line) && /^\s*(?:error|expected|actual|operator|code):/.test(line));
    return clamp([caseName, ...details]);
  }

  // node:test reports the failing case as a subtest header plus an assertion
  // body; both together are what identifies which expectation disagreed.
  const failing = lines.filter((line) => /^#\s*Subtest:/.test(line) || (!tapFraming(line) && /^\s*(?:error|expected|actual|operator|code):/.test(line)));
  if (failing.length) return clamp(failing);

  const assertion = lines.filter((line) => /Assertion failed|AssertionError|Error:|Exception|Segmentation fault|abort|terminate called/i.test(line));
  if (assertion.length) return clamp(assertion);

  return clamp(lines);
}

const DIAGNOSTIC_CHARS = 2_000;

function clamp(lines: string[]): string {
  // "# Subtest:" is TAP framing around the failing case's name; the name is the
  // information, so the marker is dropped once the line has been classified.
  const joined = lines.map((line) => line.trim().replace(/^#\s*Subtest:\s*/, "")).join(" | ");
  /* Read by the model that repairs the candidate. The failing lines lead, so
     the cut keeps what identifies the fault and says how much it left out. */
  return joined.length > DIAGNOSTIC_CHARS ? `${joined.slice(0, DIAGNOSTIC_CHARS)}… (${joined.length - DIAGNOSTIC_CHARS} more characters of output)` : joined;
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
  /* A test file the runner will not discover is decidable from its name alone.
     `tests/visible.test.py` is plainly a Python test that wants to be
     `tests/visible_test.py`, and nothing imports a test file, so renaming it
     costs nothing. Rejecting it cost a repair round. */
  const discoverable = (files: Record<string, string>) => Object.fromEntries(Object.entries(cleanMap(files)).map(([file, content]) => [testPath(design.language, file), content]));
  return {
    ...design,
    starterFiles: cleanMap(design.starterFiles),
    referenceFiles: cleanMap(design.referenceFiles),
    visibleTests: discoverable(design.visibleTests),
    hiddenTests: discoverable(design.hiddenTests),
    knownIncorrectFiles: design.knownIncorrectFiles.map(cleanMap),
    // The host runner selects the toolchain from `language`; the declared
    // command is descriptive only, so a wrong one is corrected, never rejected.
    runCommand: LANGUAGE_RULES[design.language].runCommand,
  };
}

/** The discoverable spelling of a misnamed test path, where one is obvious. */
function testPath(language: QuestionDesign["language"], file: string): string {
  const rules = LANGUAGE_RULES[language];
  if (rules.test.test(file)) return file;
  const slash = file.lastIndexOf("/");
  const directory = file.slice(0, slash + 1);
  const name = file.slice(slash + 1);
  // Only a name that says it is a test. A helper module the tests import keeps its name.
  if (!/(?:^|[._-])(?:test|tests|spec|visible|hidden)(?:[._-]|$)/i.test(name)) return file;
  let renamed: string | null = null;
  if (language === "python" && name.endsWith(".py")) renamed = `${name.slice(0, -3).replace(/[.-](?:test|spec)$/, "").replace(/[^\w]/g, "_")}_test.py`;
  if (language === "javascript" && /\.(?:m|c)?js$/.test(name)) renamed = name.replace(/(?:\.spec)?\.(?:m|c)?js$/, ".test.js");
  if (language === "typescript" && /\.tsx?$/.test(name)) renamed = name.replace(/(?:\.spec)?\.tsx?$/, ".test.ts");
  return renamed && rules.test.test(`${directory}${renamed}`) ? `${directory}${renamed}` : file;
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

  if (!design.knownIncorrectFiles.length) {
    if (HOST_MUTANT_LANGUAGES.has(design.language)) pass("known incorrect solutions", "None authored: the host checks the hidden tests against its own mutations of the reference");
    else fail("known incorrect solutions present", `knownIncorrectFiles is empty. For ${design.language} provide one to three plausible wrong implementations at the reference's path; the host generates its own only for JavaScript, TypeScript and Python.`);
  }
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
  if (design.language === "python") checks.push(...preflightStandalonePythonTests(design));


  return checks;
}

/** Spar runs each Python test file as `python3 <file>`. A pytest-style
 * `def test_*` without an invocation silently executes zero cases: the process
 * exits successfully, so the ordinary reference check is misleading. Name the
 * actual runner contract before any expensive sandbox runs or model repairs. */
function preflightStandalonePythonTests(design: QuestionDesign): ValidationReport["checks"] {
  const checks: ValidationReport["checks"] = [];
  for (const [path, source] of Object.entries({ ...design.visibleTests, ...design.hiddenTests })) {
    const definitions = [...source.matchAll(/^\s*(?:async\s+)?def\s+(test_\w+)\s*\(/gm)].map((match) => match[1]!);
    if (!definitions.length) continue;
    const withoutDefinitions = source.replace(/^\s*(?:async\s+)?def\s+test_\w+\s*\([^\n]*/gm, "");
    if (definitions.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(withoutDefinitions))) continue;
    checks.push({
      name: `python test entrypoint: ${path}`,
      passed: false,
      detail: `Spar executes ${path} directly with python3; it does not invoke pytest or unittest, and the candidate's runCommand does not change that. The file defines ${definitions.join(", ")} but never calls it, so zero cases run. Call the test function from an if __name__ == "__main__": block, or execute the cases at module top level.`,
    });
  }
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

/** Validate each runner's test naming, then check Node tests for imports. */
function preflightNode(design: QuestionDesign, testPaths: string[], testPattern: RegExp): ValidationReport["checks"] {
  const checks: ValidationReport["checks"] = [];
  const misnamed = testPaths.filter((file) => !testPattern.test(file));
  if (misnamed.length) {
    checks.push({ name: "tests use the runner's naming", passed: false, detail: `${misnamed.join(", ")} will not be discovered for ${design.language}. Test files must match ${testPattern.source}; rename them.` });
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
      const actualByIndex = new Map<number, unknown[]>();
      for (const match of result.stdout.matchAll(/__SPAR_ORACLE__(\{[^\r\n]*\})/g)) {
        try {
          const value = JSON.parse(match[1] ?? "") as { index?: unknown; actual?: unknown };
          if (typeof value.index === "number") {
            const values = actualByIndex.get(value.index) ?? [];
            values.push(value.actual);
            actualByIndex.set(value.index, values);
          }
        } catch {}
      }
      if (actualByIndex.size !== calls.length) return [file, source] as const;
      const replacements = calls.map((call, index) => {
        // A call inside a loop executes once per case. Replacing its expected
        // expression with the final observed value makes every earlier case
        // fail, even when the reference and the original oracle agree.
        const values = actualByIndex.get(index);
        if (values?.length !== 1) return source.slice(call.start, call.end);
        const literal = JSON.stringify(values[0]);
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
