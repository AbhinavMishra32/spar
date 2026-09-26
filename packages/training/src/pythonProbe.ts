import type { QuestionDesign } from "@spar/domain";

/*
 * Settling the misconception gate by execution instead of by another model round.
 *
 * The gate asks one thing of a candidate: a plausible wrong implementation passes
 * the visible tests and fails the hidden ones. Nearly every rejected Python
 * challenge in the traces failed it the same way. The "wrong" implementation was
 * not wrong. The canonical case is a sliding window whose shrinking `while`
 * became an `if`: over non-negative inputs the window just stops growing, and the
 * two functions return the same answer on every input the statement allows. No
 * hidden test can tell them apart, so every repair round that edited the tests
 * was spent on an impossible task. The redraft kept the same idea, and the next
 * `create_question` call wrote the same mutant again.
 *
 * The question "is there an input where these two differ?" is not one to ask a
 * model. The host can answer it by running both. So one sandbox run of the
 * harness below does four things, in order:
 *
 *  1. It executes the challenge's own tests against the reference with the
 *     target functions wrapped, recording every argument tuple the tests
 *     actually pass. That is the input domain, taken from the author's own
 *     examples rather than guessed from a signature.
 *  2. It generates more inputs of the same shape and within the same bounds:
 *     values from the observed ranges, list lengths near the observed ones, and
 *     order and distinctness kept when every example had them. Then it records
 *     the reference's answer for each. An input the reference raises on is
 *     outside the domain and is dropped.
 *  3. For each authored wrong implementation it reports whether it passes the
 *     visible tests, whether the hidden tests catch it, and the smallest input
 *     where it disagrees with the reference, if one exists.
 *  4. For single-site mutations of the reference it reports the same, which is
 *     both a pool of replacement misconceptions and a mutation score for the
 *     suite.
 *
 * The compiler then decides deterministically (see `settleMisconceptions`):
 *  - A difference was found and the hidden tests missed it: that input becomes
 *    a generated hidden case, with its expected value computed from the reference.
 *  - No difference was found: the wrong implementation is equivalent. It is
 *    replaced by a mutation that passes the visible tests and is caught by the
 *    hidden ones. If the visible tests already reject every mutation, the gate
 *    has nothing left to prove and is waived, but only when the hidden suite on
 *    its own rejects most of them, so a hidden file that never reaches the
 *    implementation cannot slip through that way.
 *  - Otherwise it names the fault as a misconception fault, so the repair edits
 *    `knownIncorrectFiles` and leaves the tests alone.
 */

export type ProbeCounterexample = {
  call: string;
  args: string;
  kwargs: string;
  expected: string;
  /** The arguments after the reference ran, when it mutates them in place. */
  expectedArgs: string | null;
  actual: string;
};

export type ProbeEvaluation = {
  loaded: boolean;
  /** Passes every visible test file. */
  visible: boolean;
  /** Passes every hidden test file: the hidden suite does not catch it. */
  hidden: boolean;
  /** A hidden case printed a failing verdict for it, rather than the run
   *  only crashing or hanging. */
  reported: boolean;
  /** A generated input made it disagree with the reference. */
  differs: boolean;
  counterexample: ProbeCounterexample | null;
  compared: number;
};

export type ProbeResult = {
  supported: boolean;
  names: string[];
  seeds: number;
  inputs: number;
  referencePasses: boolean;
  authored: ProbeEvaluation[];
  mutants: Array<ProbeEvaluation & { index: number }>;
};

export type PythonMutant = { label: string; source: string };

const PROBE_MARK = "__SPAR_PROBE__";
export const PYTHON_PROBE_PATH = "spar_probe_test.py";
const GENERATED_NAME = "spar_generated_test.py";
const MAX_MUTANTS = 36;

/** `src/solution.py` → `src.solution`, or null when a segment is not importable. */
export function pythonModuleName(path: string): string | null {
  if (!path.endsWith(".py")) return null;
  const segments = path.slice(0, -3).split("/");
  return segments.every((segment) => /^[A-Za-z_]\w*$/.test(segment)) ? segments.join(".") : null;
}

/**
 * Single-site mutations of a Python implementation: the mistakes people make in
 * code of this shape. They are candidates only. Whether one passes the visible
 * tests, is caught by the hidden ones, or never changes the answer at all is
 * measured, never assumed.
 */
export function pythonMutants(source: string): PythonMutant[] {
  const lines = source.split("\n");
  const found = new Map<string, string>();
  const add = (index: number, replacement: string, label: string) => {
    const next = [...lines];
    next[index] = replacement;
    const mutated = next.join("\n");
    if (mutated !== source && !found.has(mutated)) found.set(mutated, `line ${index + 1}: ${label}`);
  };
  /* Spans on a line that are code, not a string literal or a comment. A mutation
     inside a string changes a message, never behaviour. */
  const codeSpans = (line: string): Array<[number, number]> => {
    const spans: Array<[number, number]> = [];
    let start = 0;
    let quote: string | null = null;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!;
      if (quote) {
        if (character === "\\") index += 1;
        else if (character === quote) { quote = null; start = index + 1; }
        continue;
      }
      if (character === "#") { spans.push([start, index]); return spans; }
      if (character === "'" || character === '"') { spans.push([start, index]); quote = character; }
    }
    if (!quote) spans.push([start, line.length]);
    return spans;
  };
  const operators: Array<[RegExp, string | ((match: string) => string), string]> = [
    [/\bwhile\b/g, "if", "`while` → `if`"],
    [/<=/g, "<", "`<=` → `<`"],
    [/(?<![<>=!])<(?![<=])/g, "<=", "`<` → `<=`"],
    [/>=/g, ">", "`>=` → `>`"],
    [/(?<![<>=!-])>(?![>=])/g, ">=", "`>` → `>=`"],
    [/==/g, "!=", "`==` → `!=`"],
    [/!=/g, "==", "`!=` → `==`"],
    [/\brange\(([^()]*)\)/g, (match) => `${match.slice(0, -1)} + 1)`, "range bound one past the end"],
    [/ [+-] 1\b/g, "", "dropped `± 1`"],
    [/\bmax\(/g, "min(", "`max` → `min`"],
    [/\bmin\(/g, "max(", "`min` → `max`"],
    [/\band\b/g, "or", "`and` → `or`"],
    [/\bor\b/g, "and", "`or` → `and`"],
    [/\bbreak\b/g, "pass", "`break` dropped"],
    [/\bcontinue\b/g, "pass", "`continue` dropped"],
  ];
  const interesting = lines.map((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#") && !/^(?:def|class|import|from|@)\b/.test(trimmed) && !/^(?:"""|''')/.test(trimmed);
  });
  let docstring = false;
  const inDocstring = lines.map((line) => {
    const marks = (line.match(/"""|'''/g) ?? []).length;
    const inside = docstring || marks > 0;
    if (marks % 2 === 1) docstring = !docstring;
    return inside;
  });
  for (const [pattern, replacement, label] of operators) {
    lines.forEach((line, index) => {
      if (!interesting[index] || inDocstring[index]) return;
      for (const [from, to] of codeSpans(line)) {
        const segment = line.slice(from, to);
        for (const match of segment.matchAll(pattern)) {
          if (match.index === undefined) continue;
          const start = from + match.index;
          const text = typeof replacement === "string" ? replacement : replacement(match[0]);
          add(index, `${line.slice(0, start)}${text}${line.slice(start + match[0].length)}`, label);
        }
      }
    });
  }
  /* A forgotten update: the bookkeeping line inside a loop that the plausible
     wrong solution leaves out. */
  lines.forEach((line, index) => {
    if (!interesting[index] || inDocstring[index]) return;
    const indent = /^(\s*)/.exec(line)?.[1] ?? "";
    if (indent.length < 8) return;
    if (!/^\s+[A-Za-z_][\w.\[\]]*\s*(?:[+\-*/%]|\/\/)?=(?!=)/.test(line)) return;
    add(index, `${indent}pass`, `\`${line.trim().slice(0, 40)}\` dropped`);
  });
  return [...found.entries()].slice(0, MAX_MUTANTS).map(([mutated, label]) => ({ label, source: mutated }));
}

type ProbeSpec = {
  module: string;
  path: string;
  authored: string[];
  mutants: string[];
  visible: Record<string, string>;
  hidden: Record<string, string>;
  budget: number;
  materialize?: boolean;
};

/** The harness, as one standalone test file the Python runner will discover. */
export function pythonProbeHarness(spec: ProbeSpec): string {
  const encoded = Buffer.from(JSON.stringify(spec), "utf8").toString("base64");
  return PROBE_SOURCE.replace("__SPEC__", encoded).replace("__MARK__", PROBE_MARK);
}

export function parseProbe(stdout: string): ProbeResult | null {
  const result: ProbeResult = { supported: false, names: [], seeds: 0, inputs: 0, referencePasses: false, authored: [], mutants: [] };
  let seen = false;
  for (const line of stdout.split("\n")) {
    const at = line.indexOf(PROBE_MARK);
    if (at < 0) continue;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(line.slice(at + PROBE_MARK.length)) as Record<string, unknown>; } catch { continue; }
    seen = true;
    if (payload.kind === "reference") {
      result.supported = true;
      result.names = Array.isArray(payload.names) ? payload.names.map(String) : [];
      result.seeds = Number(payload.seeds) || 0;
      result.inputs = Number(payload.inputs) || 0;
      result.referencePasses = payload.visible === true && payload.hidden === true;
    } else if (payload.kind === "authored" && typeof payload.index === "number") {
      result.authored[payload.index] = evaluation(payload);
    } else if (payload.kind === "mutant" && typeof payload.index === "number") {
      result.mutants.push({ ...evaluation(payload), index: payload.index });
    }
  }
  return seen ? result : null;
}

function evaluation(payload: Record<string, unknown>): ProbeEvaluation {
  const raw = payload.counterexample as Record<string, unknown> | null | undefined;
  const counterexample = raw && typeof raw.call === "string" && typeof raw.args === "string" && typeof raw.expected === "string"
    ? {
        call: raw.call,
        args: raw.args,
        kwargs: typeof raw.kwargs === "string" ? raw.kwargs : "{}",
        expected: raw.expected,
        expectedArgs: typeof raw.expectedArgs === "string" ? raw.expectedArgs : null,
        actual: typeof raw.actual === "string" ? raw.actual : "",
      }
    : null;
  return {
    loaded: payload.loaded === true,
    visible: payload.visible === true,
    hidden: payload.hidden === true,
    reported: payload.reported === true,
    differs: payload.differs === true,
    counterexample,
    compared: Number(payload.compared) || 0,
  };
}

/** Which implementation file the probe works on: the one path every authored
 *  wrong implementation replaces. */
export function probeTarget(design: QuestionDesign): { path: string; module: string } | null {
  for (const path of Object.keys(design.referenceFiles)) {
    const module = pythonModuleName(path);
    if (!module) continue;
    if (design.knownIncorrectFiles.every((files) => typeof files[path] === "string")) return { path, module };
  }
  return null;
}

export function probeFiles(design: QuestionDesign, target: { path: string; module: string }, mutants: PythonMutant[], budgetSeconds: number): Record<string, string> {
  return {
    ...design.starterFiles,
    ...design.referenceFiles,
    [PYTHON_PROBE_PATH]: pythonProbeHarness({
      module: target.module,
      path: target.path,
      authored: design.knownIncorrectFiles.map((files) => files[target.path] ?? ""),
      mutants: mutants.map((mutant) => mutant.source),
      visible: design.visibleTests,
      hidden: design.hiddenTests,
      budget: budgetSeconds,
    }),
  };
}

/** The one-run harness that rewrites hidden expected literals from the reference. */
export function materializeFiles(design: QuestionDesign, target: { path: string; module: string }): Record<string, string> {
  return {
    ...design.starterFiles,
    ...design.referenceFiles,
    [PYTHON_PROBE_PATH]: pythonProbeHarness({ module: target.module, path: target.path, authored: [], mutants: [], visible: design.visibleTests, hidden: design.hiddenTests, budget: 8, materialize: true }),
  };
}

export function parseMaterialized(stdout: string): { visible: boolean; files: Record<string, string>; rewrites: number } | null {
  for (const line of stdout.split("\n")) {
    const at = line.indexOf(PROBE_MARK);
    if (at < 0) continue;
    try {
      const payload = JSON.parse(line.slice(at + PROBE_MARK.length)) as Record<string, unknown>;
      if (payload.kind !== "materialized") continue;
      const files = payload.files && typeof payload.files === "object" ? Object.fromEntries(Object.entries(payload.files as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
      return { visible: payload.visible === true, files, rewrites: Number(payload.rewrites) || 0 };
    } catch {}
  }
  return null;
}

export type Settlement = {
  design: QuestionDesign;
  /** Informational checks: what the host did and why. Always passed. */
  notes: Array<{ name: string; passed: boolean; detail: string }>;
  /** Indices whose gate is settled by mutation analysis; their runs are skipped. */
  waived: Map<number, string>;
  /** Indices whose authored misconception is equivalent and could not be
   *  replaced: a hard verdict aimed at `knownIncorrectFiles`, not the tests. */
  equivalent: Map<number, string>;
  /** Indices whose files or tests changed and need their runs repeated. */
  changed: Set<number>;
};

/**
 * Turn a probe into edits and verdicts. Nothing here trusts the model's claims
 * about its own misconception. Every branch rests on something the harness
 * executed.
 */
export function settleMisconceptions(design: QuestionDesign, target: { path: string; module: string }, mutants: PythonMutant[], probe: ProbeResult, failing: Set<number>): Settlement {
  const settlement: Settlement = { design, notes: [], waived: new Map(), equivalent: new Map(), changed: new Set() };
  if (!probe.supported || !probe.referencePasses) return settlement;
  const knownIncorrectFiles = design.knownIncorrectFiles.map((files) => ({ ...files }));
  const cases: Array<{ index: number; counterexample: ProbeCounterexample }> = [];
  const used = new Set<number>();
  const byIndex = new Map(probe.mutants.map((mutant) => [mutant.index, mutant]));
  /* A mutant the tests can tell from the reference: some test fails on it, or
     the differential saw it disagree. The denominator for the mutation score.
     Mutants that never change an answer say nothing about the tests. */
  const killable = probe.mutants.filter((mutant) => mutant.loaded && (mutant.differs || !mutant.visible || !mutant.hidden));
  const killedByHidden = killable.filter((mutant) => !mutant.hidden);
  const survivors = killable.filter((mutant) => mutant.visible && mutant.hidden);
  const replacement = () => {
    const candidates = [...byIndex.values()].filter((mutant) => mutant.loaded && mutant.visible && !used.has(mutant.index));
    return candidates.find((mutant) => !mutant.hidden && mutant.reported) ?? candidates.find((mutant) => mutant.hidden && mutant.counterexample);
  };

  for (const index of failing) {
    const authored = probe.authored[index];
    if (!authored?.loaded) continue;
    const which = index + 1;
    if (authored.visible && authored.hidden && authored.counterexample) {
      cases.push({ index, counterexample: authored.counterexample });
      settlement.changed.add(index);
      settlement.notes.push({ name: `known incorrect ${which} counterexample`, passed: true, detail: `The hidden tests missed this misconception, but running it beside the reference found an input where they disagree. The host added that input as a generated hidden case, with its expected value computed from the reference.` });
      continue;
    }
    const equivalent = authored.visible && authored.hidden && !authored.differs;
    if (!equivalent && authored.visible) continue;
    const why = equivalent
      ? `The authored wrong implementation returned the reference's answer on all ${authored.compared} probed inputs drawn from the tests' own domain, so it is not actually wrong and no test can catch it`
      : `The authored wrong implementation already fails the visible tests, so the hidden tests are never what catches it`;
    const mutant = replacement();
    if (mutant) {
      used.add(mutant.index);
      knownIncorrectFiles[index] = { ...knownIncorrectFiles[index], [target.path]: mutants[mutant.index]!.source };
      if (mutant.hidden && mutant.counterexample) cases.push({ index, counterexample: mutant.counterexample });
      settlement.changed.add(index);
      settlement.notes.push({ name: `known incorrect ${which} replaced`, passed: true, detail: `${why}. The host replaced it with a single-site mutation of the reference (${mutants[mutant.index]!.label}) that passes the visible tests and ${mutant.hidden ? "fails a generated hidden case computed from the reference" : "fails the hidden tests"}.` });
      continue;
    }
    if (killable.length >= 3 && !survivors.length && killedByHidden.length * 2 >= killable.length) {
      const detail = `${why}. Every one of the ${killable.length} host mutations of the reference that changes an answer is already rejected by the tests, and the hidden tests alone reject ${killedByHidden.length} of them, so the suite demonstrably grades this implementation. Gate settled by mutation analysis.`;
      settlement.waived.set(index, detail);
      continue;
    }
    settlement.equivalent.set(index, equivalent
      ? `${why}. This is a fault in knownIncorrectFiles[${index}], not in the tests. Do not edit visibleTests or hiddenTests for it. Replace only knownIncorrectFiles[${index}] with an implementation that returns a wrong answer on some input the statement allows, and name that input to yourself before writing it.`
      : `${why}. Make knownIncorrectFiles[${index}] wrong only on inputs the visible tests do not contain, or move the visible case that exposes it into hiddenTests.`);
  }

  if (!cases.length && !settlement.changed.size) return settlement;
  const hiddenTests = { ...design.hiddenTests };
  if (cases.length) {
    const directory = Object.keys(design.hiddenTests)[0]?.split("/").slice(0, -1).join("/") ?? "";
    hiddenTests[directory ? `${directory}/${GENERATED_NAME}` : GENERATED_NAME] = generatedHiddenTest(target.module, cases.map((entry) => entry.counterexample));
  }
  settlement.design = { ...design, knownIncorrectFiles, hiddenTests };
  return settlement;
}

/** A hidden test file for the host's counterexamples, in the same one verdict
 *  line per case protocol as the author's. Its expected values come from the
 *  reference, so it cannot be wrong about the answer. */
export function generatedHiddenTest(module: string, cases: ProbeCounterexample[]): string {
  const names = [...new Set(cases.map((entry) => entry.call))];
  const rows = cases.map((entry) => `    (${JSON.stringify(entry.call)}, ${entry.call}, ${entry.args}, ${entry.kwargs}, ${entry.expected}, ${entry.expectedArgs ?? "None"}),`).join("\n");
  return `# Generated by Spar from the reference solution: inputs where a plausible wrong
# implementation disagrees with it. Expected values are the reference's own.
import copy
import math
from ${module} import ${names.join(", ")}


def _same(left, right):
    if isinstance(left, float) or isinstance(right, float):
        try:
            return math.isclose(left, right, rel_tol=1e-9, abs_tol=1e-9)
        except TypeError:
            return False
    if isinstance(left, (list, tuple)) and isinstance(right, (list, tuple)):
        return type(left) is type(right) and len(left) == len(right) and all(_same(a, b) for a, b in zip(left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(_same(left[key], right[key]) for key in left)
    return left == right


def _agrees(actual, expected):
    if _same(actual, expected):
        return True
    # Order is not part of what these cases check.
    if isinstance(actual, list) and isinstance(expected, list) and len(actual) == len(expected):
        return sorted(map(repr, actual)) == sorted(map(repr, expected))
    return False


CASES = [
${rows}
]


if __name__ == "__main__":
    failed = False
    for name, function, args, kwargs, expected, expected_args in CASES:
        shown = f"{name}({', '.join([repr(value) for value in args] + [f'{key}={value!r}' for key, value in kwargs.items()])})"
        call_args = copy.deepcopy(args)
        try:
            actual = function(*call_args, **copy.deepcopy(kwargs))
        except Exception as error:
            actual = f"raised {type(error).__name__}: {error}"
        ok = _agrees(actual, expected) and (expected_args is None or _same(tuple(call_args), tuple(expected_args)))
        if ok:
            print(f"ok - {shown[:120]}")
        else:
            failed = True
            print(f"not ok - {shown[:120]}")
            print(f"  expected: {expected!r}" + ("" if expected_args is None else f" with arguments left as {expected_args!r}"))
            print(f"  actual: {actual!r}" + ("" if expected_args is None else f" with arguments left as {tuple(call_args)!r}"))
    if failed:
        raise SystemExit(1)
`;
}

/* The harness. Kept free of `${` and backticks so it can live in a raw template. */
const PROBE_SOURCE = String.raw`# Spar host probe: not a learner test. Compares implementations by execution.
import ast, base64, contextlib, copy, importlib, inspect, io, json, math, random, signal, sys, time, types

SPEC = json.loads(base64.b64decode("__SPEC__").decode("utf-8"))
MARK = "__MARK__"
START = time.monotonic()
DEADLINE = START + SPEC["budget"]


class _Timeout(BaseException):
    pass


def _alarm(signum, frame):
    raise _Timeout()


signal.signal(signal.SIGALRM, _alarm)


@contextlib.contextmanager
def limit(seconds):
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


def emit(kind, payload):
    payload["kind"] = kind
    sys.__stdout__.write(MARK + json.dumps(payload) + "\n")
    sys.__stdout__.flush()


def literal(value):
    try:
        return ast.literal_eval(repr(value)) == value
    except Exception:
        return False


def same(left, right):
    if isinstance(left, float) or isinstance(right, float):
        try:
            return math.isclose(left, right, rel_tol=1e-9, abs_tol=1e-9)
        except TypeError:
            return False
    if isinstance(left, (list, tuple)) and isinstance(right, (list, tuple)):
        return type(left) is type(right) and len(left) == len(right) and all(same(a, b) for a, b in zip(left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(same(left[key], right[key]) for key in left)
    try:
        return bool(left == right)
    except Exception:
        return False


def order_only(left, right):
    if isinstance(left, list) and isinstance(right, list) and len(left) == len(right):
        return sorted(map(repr, left)) == sorted(map(repr, right))
    return False


def kind_of(value):
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "str"
    if isinstance(value, list):
        return "list"
    if isinstance(value, tuple):
        return "tuple"
    return "other"


try:
    target = importlib.import_module(SPEC["module"])
except BaseException:
    emit("unsupported", {"reason": "reference does not import"})
    sys.exit(0)

names = [name for name, value in vars(target).items() if inspect.isfunction(value) and getattr(value, "__module__", None) == target.__name__ and not name.startswith("_")]
originals = {name: getattr(target, name) for name in names}
if not names:
    emit("unsupported", {"reason": "no public functions"})
    sys.exit(0)


def patch(functions):
    for name, function in functions.items():
        setattr(target, name, function)


def run_tests(sources, seconds, verdicts=None):
    passed = True
    for path, source in sources.items():
        out = io.StringIO()
        try:
            code = compile(source, path, "exec")
        except SyntaxError:
            return False
        scope = {"__name__": "__main__", "__file__": path, "__builtins__": __builtins__}
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
                with limit(seconds):
                    exec(code, scope)
        except SystemExit as stop:
            if stop.code not in (None, 0):
                passed = False
        except BaseException:
            passed = False
        if any(line.strip().lower().startswith("not ok") for line in out.getvalue().splitlines()):
            passed = False
            if verdicts is not None:
                verdicts.append(path)
    return passed


def callee(node):
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return None


def evaluated(node):
    try:
        return True, ast.literal_eval(node)
    except Exception:
        return False, None


def comparable(left, right):
    numbers = ("int", "float")
    return kind_of(left) == kind_of(right) or (kind_of(left) in numbers and kind_of(right) in numbers)


def rewrite(source, calls):
    """Replace hand-written expected literals with the reference's answers.

    Two shapes, both where the literal is unambiguously the expectation for a
    recorded call: f(args) == expected, and a case row or helper call that
    ends with the call's arguments followed by the expected value."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source, 0
    edits = {}
    conflicts = set()

    def propose(node, value):
        key = (node.lineno, node.col_offset, node.end_lineno, node.end_col_offset)
        if key in edits and not same(edits[key], value):
            conflicts.add(key)
        edits[key] = value

    for node in ast.walk(tree):
        if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq):
            for call, expected_node in ((node.left, node.comparators[0]), (node.comparators[0], node.left)):
                if not (isinstance(call, ast.Call) and callee(call) in names) or any(isinstance(arg, ast.Starred) for arg in call.args):
                    continue
                parts = [evaluated(arg) for arg in call.args]
                named = dict((keyword.arg, evaluated(keyword.value)) for keyword in call.keywords if keyword.arg)
                ok, expected = evaluated(expected_node)
                if not ok or not all(flag for flag, _ in parts) or not all(flag for flag, _ in named.values()) or len(named) != len(call.keywords):
                    continue
                args = tuple(value for _, value in parts)
                kwargs = dict((key, value) for key, (_, value) in named.items())
                for name, recorded_args, recorded_kwargs, value in calls:
                    if name == callee(call) and same(recorded_args, args) and same(recorded_kwargs, kwargs):
                        if literal(value) and comparable(value, expected) and not same(value, expected):
                            propose(expected_node, value)
                        break
        rows = None
        if isinstance(node, (ast.Tuple, ast.List)):
            rows = node.elts
        elif isinstance(node, ast.Call) and callee(node) not in names:
            rows = node.args
        if not rows or len(rows) < 2 or any(isinstance(item, ast.Starred) for item in rows):
            continue
        values = [evaluated(item) for item in rows]
        ok, expected = values[-1]
        if not ok:
            continue
        for name, args, kwargs, value in calls:
            width = len(args)
            if kwargs or not width:
                continue
            window = values[len(rows) - 1 - width:len(rows) - 1]
            spread = all(flag for flag, _ in window) and same(tuple(item for _, item in window), tuple(args))
            # Or packed: (name, (limit, nums), expected) called as f(*args).
            packed, bundle = values[-2]
            packed = packed and isinstance(bundle, (tuple, list)) and same(tuple(bundle), tuple(args))
            if spread or packed:
                if literal(value) and comparable(value, expected) and not same(value, expected):
                    propose(rows[-1], value)
                break
    applied = [(key, value) for key, value in edits.items() if key not in conflicts]
    if not applied:
        return source, 0
    lines = source.splitlines(keepends=True)
    starts = [0]
    for line in lines:
        starts.append(starts[-1] + len(line))

    def offset(lineno, column):
        return starts[lineno - 1] + len(lines[lineno - 1].encode("utf-8")[:column].decode("utf-8", "ignore"))

    output = source
    for (line, column, end_line, end_column), value in sorted(applied, key=lambda item: item[0], reverse=True):
        output = output[:offset(line, column)] + repr(value) + output[offset(end_line, end_column):]
    return output, len(applied)


if SPEC.get("materialize"):
    # The reference is the oracle only when it satisfies the learner's own
    # contract: every visible case. Visible expectations are never rewritten.
    if not run_tests(SPEC["visible"], 4):
        emit("materialized", {"visible": False, "files": {}, "rewrites": 0})
        sys.exit(0)
    files = {}
    total = 0
    for path, source in SPEC["hidden"].items():
        calls = []

        def capture(name, function):
            def captured(*args, **kwargs):
                if depth[0] == 0 and len(calls) < 2000:
                    before = (copy.deepcopy(args), copy.deepcopy(kwargs))
                    depth[0] += 1
                    try:
                        value = function(*args, **kwargs)
                    finally:
                        depth[0] -= 1
                    calls.append((name, before[0], before[1], copy.deepcopy(value)))
                    return value
                return function(*args, **kwargs)
            return captured

        # A suite that stops at its first failing case never reaches the rest,
        # so rewrite and rerun until a pass leaves nothing to correct.
        rewritten = source
        for _ in range(12):
            calls.clear()
            depth = [0]
            patch(dict((name, capture(name, originals[name])) for name in names))
            try:
                clean = run_tests({path: rewritten}, 5)
            finally:
                patch(originals)
            rewritten, count = rewrite(rewritten, calls)
            total += count
            if clean or not count:
                break
        if rewritten != source:
            files[path] = rewritten
    emit("materialized", {"visible": True, "files": files, "rewrites": total})
    sys.exit(0)


# 1. Harvest the argument tuples the tests actually pass.
seeds = {}
depth = [0]


def recorder(name, function):
    def recorded(*args, **kwargs):
        if depth[0] == 0 and len(seeds.setdefault(name, [])) < 400:
            try:
                if literal(args) and literal(kwargs):
                    seeds[name].append((copy.deepcopy(args), copy.deepcopy(kwargs)))
            except Exception:
                pass
        depth[0] += 1
        try:
            return function(*args, **kwargs)
        finally:
            depth[0] -= 1
    return recorded


patch({name: recorder(name, originals[name]) for name in names})
clock = time.monotonic()
reference_visible = run_tests(SPEC["visible"], 4)
visible_seconds = time.monotonic() - clock
clock = time.monotonic()
reference_hidden = run_tests(SPEC["hidden"], 5)
hidden_seconds = time.monotonic() - clock
patch(originals)


def ascending(values, strict):
    try:
        return all((a < b) if strict else (a <= b) for a, b in zip(values, values[1:]))
    except TypeError:
        return False


class Profile:
    def __init__(self, values):
        self.values = values
        kinds = set(kind_of(value) for value in values)
        self.kind = kinds.pop() if len(kinds) == 1 else "mixed"
        if self.kind in ("int", "float"):
            self.lo, self.hi = min(values), max(values)
        if self.kind == "str":
            self.alphabet = sorted(set(character for value in values for character in value))
            lengths = [len(value) for value in values]
            self.min_len, self.max_len = min(lengths), max(lengths)
        if self.kind in ("list", "tuple"):
            lengths = [len(value) for value in values]
            self.min_len, self.max_len = min(lengths), max(lengths)
            elements = [element for value in values for element in value]
            self.element = Profile(elements) if elements else None
            several = [list(value) for value in values if len(value) >= 2]
            evidence = any(len(value) >= 3 for value in several)
            self.sorted = evidence and all(ascending(value, False) for value in several)
            self.strict = self.sorted and all(ascending(value, True) for value in several)
            self.distinct = evidence and all(len(set(map(repr, value))) == len(value) for value in several)

    def fresh(self, rng, small):
        kind = self.kind
        if kind == "bool":
            return rng.random() < 0.5
        if kind == "int":
            roll = rng.random()
            if roll < 0.35:
                return rng.choice(self.values)
            if roll < 0.7:
                return max(self.lo, min(self.hi, rng.choice(self.values) + rng.randint(-2, 2)))
            return rng.randint(self.lo, self.hi)
        if kind == "float":
            if rng.random() < 0.4:
                return rng.choice(self.values)
            return round(rng.uniform(self.lo, self.hi), 2)
        if kind == "str":
            if not self.alphabet or rng.random() < 0.2:
                return rng.choice(self.values)
            top = self.max_len + 1 if not small else max(self.min_len, min(self.max_len + 1, 6))
            return "".join(rng.choice(self.alphabet) for _ in range(rng.randint(self.min_len, max(self.min_len, top))))
        if kind in ("list", "tuple"):
            if self.element is None:
                return rng.choice(self.values)
            top = self.max_len + 2 if not small else max(self.min_len, min(self.max_len + 2, 7))
            items = [self.element.fresh(rng, small) for _ in range(rng.randint(self.min_len, max(self.min_len, top)))]
            return self.shape(items)
        return copy.deepcopy(rng.choice(self.values))

    def shape(self, items):
        if self.kind not in ("list", "tuple"):
            return items
        if self.distinct or self.strict:
            unique, seen = [], set()
            for item in items:
                if repr(item) not in seen:
                    seen.add(repr(item))
                    unique.append(item)
            items = unique
        if self.sorted:
            try:
                items = sorted(items)
            except TypeError:
                pass
        if len(items) < self.min_len:
            return None
        return tuple(items) if self.kind == "tuple" else items

    def nudge(self, rng, value, small):
        if self.kind not in ("list", "tuple") or self.element is None or not value:
            return self.fresh(rng, small)
        items = list(copy.deepcopy(value))
        move = rng.randrange(4)
        if move == 0 and len(items) >= 2:
            i, j = rng.randrange(len(items)), rng.randrange(len(items))
            items[i], items[j] = items[j], items[i]
        elif move == 1:
            items[rng.randrange(len(items))] = self.element.fresh(rng, small)
        elif move == 2 and len(items) > self.min_len:
            items.pop(rng.randrange(len(items)))
        else:
            items.insert(rng.randrange(len(items) + 1), copy.deepcopy(rng.choice(items)))
        return self.shape(items)


def generator(name):
    groups = {}
    for args, kwargs in seeds.get(name, []):
        groups.setdefault((len(args), tuple(sorted(kwargs))), []).append((args, kwargs))
    if not groups:
        return
    group = max(groups.values(), key=len)
    arity = len(group[0][0])
    keys = sorted(group[0][1])
    columns = [Profile([args[i] for args, _ in group]) for i in range(arity)]
    keyed = dict((key, Profile([kwargs[key] for _, kwargs in group])) for key in keys)
    # Relations every example obeyed: an integer bounded by a sequence's length,
    # one integer never above another.
    bounds = []
    order = []
    for p in range(arity):
        if columns[p].kind != "int":
            continue
        for q in range(arity):
            if p != q and columns[q].kind in ("list", "tuple", "str"):
                gaps = [args[p] - len(args[q]) for args, _ in group]
                if max(gaps) <= 0:
                    bounds.append((p, q, max(gaps)))
            if p < q and columns[q].kind == "int":
                pairs = [(args[p], args[q]) for args, _ in group]
                if all(a <= b for a, b in pairs) and any(a < b for a, b in pairs):
                    order.append((p, q))

    def valid(args):
        if any(value is None for value in args):
            return False
        for p, q, gap in bounds:
            if args[p] > len(args[q]) + gap:
                return False
        for p, q in order:
            if args[p] > args[q]:
                return False
        return True

    for args, kwargs in group:
        yield copy.deepcopy(args), copy.deepcopy(kwargs)
    rng = random.Random(20260925)
    produced = 0
    misses = 0
    while produced < 6000 and misses < 4000:
        small = produced < 2500
        if rng.random() < 0.4:
            base, base_kwargs = rng.choice(group)
            args = list(copy.deepcopy(base))
            if arity:
                position = rng.randrange(arity)
                args[position] = columns[position].nudge(rng, args[position], small)
            kwargs = copy.deepcopy(base_kwargs)
        else:
            args = [column.fresh(rng, small) for column in columns]
            kwargs = dict((key, profile.fresh(rng, small)) for key, profile in keyed.items())
        for p, q, gap in bounds:
            if args[p] is not None and args[q] is not None and args[p] > len(args[q]) + gap:
                args[p] = len(args[q]) + gap
                if args[p] < columns[p].lo:
                    args[p] = None
        if not valid(args):
            misses += 1
            continue
        produced += 1
        yield tuple(args), kwargs


def outcome(function, args, kwargs, seconds):
    call_args = copy.deepcopy(args)
    call_kwargs = copy.deepcopy(kwargs)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        with limit(seconds):
            value = function(*call_args, **call_kwargs)
    return value, call_args


# 2. The reference's answer on every generated input it accepts.
cache = []
seen = set()
reference_stop = min(DEADLINE, START + SPEC["budget"] * 0.4)
for name in names:
    for args, kwargs in generator(name) or []:
        if time.monotonic() > reference_stop or len(cache) >= 2500:
            break
        key = repr((name, args, kwargs))
        if key in seen:
            continue
        seen.add(key)
        try:
            value, after = outcome(originals[name], args, kwargs, 0.25)
        except BaseException:
            continue
        cache.append((name, args, kwargs, value, after))

emit("reference", {"names": names, "seeds": sum(len(v) for v in seeds.values()), "inputs": len(cache), "visible": reference_visible, "hidden": reference_hidden})


def differential(functions, stop):
    found = []
    compared = 0
    hung = False
    for name, args, kwargs, expected, expected_after in cache:
        if time.monotonic() > stop or len(found) >= 6:
            break
        function = functions.get(name)
        if function is None:
            continue
        compared += 1
        try:
            actual, actual_after = outcome(function, args, kwargs, 0.25)
            raised = None
        except _Timeout:
            raised = "did not finish"
        except BaseException as error:
            raised = "raised " + type(error).__name__
        if raised is None:
            if (same(actual, expected) or order_only(actual, expected)) and same(tuple(actual_after), tuple(expected_after)):
                continue
        elif raised == "did not finish":
            # Different, but a generated case that hangs reports nothing, and
            # waiting out the rest of its inputs only spends the budget.
            hung = True
            break
        mutated = not same(tuple(expected_after), tuple(args))
        if not (literal(args) and literal(kwargs) and literal(expected) and (not mutated or literal(tuple(expected_after)))):
            continue
        found.append({
            "call": name,
            "args": repr(tuple(args)),
            "kwargs": repr(kwargs),
            "expected": repr(expected),
            "expectedArgs": repr(tuple(expected_after)) if mutated else None,
            "actual": (raised or repr(actual))[:200],
        })
    found.sort(key=lambda entry: len(entry["args"]) + len(entry["kwargs"]))
    return (found[0] if found else None), compared, hung


def evaluate(source, stop):
    module = types.ModuleType("_spar_candidate")
    module.__file__ = SPEC["path"]
    try:
        with contextlib.redirect_stdout(io.StringIO()), limit(2):
            exec(compile(source, SPEC["path"], "exec"), module.__dict__)
    except BaseException:
        return {"loaded": False}
    functions = dict((name, getattr(module, name)) for name in names if callable(getattr(module, name, None)))
    patch(dict(originals, **functions))
    # A mutation that never terminates would otherwise spend the whole budget;
    # anything far slower than the reference on the same suite has hung.
    left = max(0.3, DEADLINE - time.monotonic())
    try:
        visible = run_tests(SPEC["visible"], min(left / 3, max(0.3, visible_seconds * 5)))
        reported = []
        hidden = run_tests(SPEC["hidden"], min(left / 2, max(0.5, hidden_seconds * 5)), reported)
    finally:
        patch(originals)
    counterexample, compared, hung = differential(functions, stop)
    # "reported": a hidden case printed its own failing verdict. A crash or a
    # hang also fails the run, but says nothing the learner could read.
    return {"loaded": True, "visible": visible, "hidden": hidden, "reported": bool(reported), "differs": counterexample is not None or hung, "counterexample": counterexample, "compared": compared}


# 3. The authored wrong implementations.
for index, source in enumerate(SPEC["authored"]):
    remaining = DEADLINE - time.monotonic()
    emit("authored", dict(index=index, **evaluate(source, time.monotonic() + max(0.2, remaining * 0.3))))

# 4. Single-site mutations of the reference: replacements and a mutation score.
for index, source in enumerate(SPEC["mutants"]):
    remaining = DEADLINE - time.monotonic()
    if remaining <= 0.3:
        break
    emit("mutant", dict(index=index, **evaluate(source, time.monotonic() + max(0.1, remaining / max(1, len(SPEC["mutants"]) - index)))))

emit("done", {})
`;
