import type { Language } from "@spar/domain";
import type { PracticeCase, PracticeProblem, PracticeSignature } from "./types.js";

/**
 * Turning a sourced problem into a workspace the local runner can grade.
 *
 * This is what makes a practice source usable when it cannot judge for itself —
 * and what lets the learner press *run* twenty times without spending twenty
 * submissions on the source that can. The generated layout is deliberately the
 * same shape a generated Spar challenge has (an implementation under `src/`,
 * tests under `tests/`, graded by exit code) so nothing downstream needs to know
 * where the challenge came from: the runner, the result panel and the replay all
 * see the shape they already understand.
 *
 * Two constraints drive every decision here.
 *
 * **The learner's file has to stay submittable.** Whatever is between the markers
 * is exactly what gets posted to the source's judge, byte for byte. So the file
 * cannot require an `export` inside the region, cannot renumber lines, and cannot
 * be reformatted on the way out. `submittableCode` is the other half of that
 * contract, and the marker text is part of the file's meaning rather than a
 * comment.
 *
 * **A case Spar cannot express must be refused, not approximated.** A design
 * problem with no single entry point, or a signature taking a `TreeNode*`, cannot
 * be driven by a generated harness. Those come back `supported: false` with the
 * reason, and the host says so and leans on the remote judge. Emitting a harness
 * that compiles and tests the wrong thing would be the one failure the learner
 * could not diagnose.
 */

export const SOLUTION_START = "spar:solution:start";
export const SOLUTION_END = "spar:solution:end";

export type PracticeHarness =
  | {
    supported: true;
    /** The whole workspace, ready to write: implementation plus tests. */
    files: Record<string, string>;
    /** The one file the learner edits. Everything else is read-only. */
    entryPath: string;
    testPaths: string[];
    /** Cases the harness actually asserts, in order, so a per-case verdict read
     *  out of the runner's output can be named. */
    cases: PracticeCase[];
  }
  | { supported: false; reason: string; files: Record<string, string>; entryPath: string; testPaths: string[]; cases: PracticeCase[] };

/**
 * The code to send to the source's judge: what sits between the markers.
 *
 * Falls back to the whole file when the markers are gone, because a learner who
 * deleted them still deserves to have their solution submitted — and the file is
 * theirs to edit. The fallback is safe in the direction that matters: extra code
 * around a solution is accepted by every judge Spar talks to, while a missing
 * solution is not.
 */
export function submittableCode(content: string): string {
  const start = content.indexOf(SOLUTION_START);
  /* The *last* end marker, not the first. A solution that mentions the marker
     text — in a comment, or in a string — would otherwise truncate itself at
     that mention and submit nothing. */
  const end = content.lastIndexOf(SOLUTION_END);
  if (start < 0 || end <= start) return content.trim();
  const afterMarker = content.indexOf("\n", start);
  if (afterMarker < 0 || afterMarker > end) return content.trim();
  const lineBeforeEnd = content.lastIndexOf("\n", end);
  return content.slice(afterMarker + 1, lineBeforeEnd > afterMarker ? lineBeforeEnd : end).replace(/\s+$/, "");
}

export function buildHarness(input: { problem: PracticeProblem; language: Language; cases: PracticeCase[]; code?: string }): PracticeHarness {
  const { problem, language } = input;
  const starter = input.code ?? problem.languages.find((entry) => entry.language === language)?.starter ?? "";
  const signature = problem.signature;
  const paths = LAYOUT[language];

  const refuse = (reason: string): PracticeHarness => ({
    supported: false,
    reason,
    /* Still returns the solution file. A problem Spar cannot grade locally is
       still a problem the learner works on — they write it here and the source's
       judge decides. Refusing to produce the file would mean refusing the
       problem. */
    files: { [paths.entry]: solutionFile(language, starter, signature) },
    entryPath: paths.entry,
    testPaths: [],
    cases: [],
  });

  if (!starter.trim()) return refuse(`LeetCode publishes no ${LANGUAGE_NAME[language]} starter for this problem, so there is nothing to run locally.`);
  if (!signature) return refuse("This problem publishes no signature, so Spar cannot build a call to it. Use the source's own judge.");
  if (signature.classBased) return refuse("This is a design problem: it asks for a class with several methods rather than one function, so there is no single call for a generated test to make. Use the source's own judge.");

  const runnable = input.cases.filter((entry) => entry.input.length === signature.params.length && entry.expected.trim().length > 0);
  if (!runnable.length) {
    return refuse(
      problem.examples.length
        ? "None of this problem's published examples could be matched to its signature, so Spar has no case it can assert. Use the source's own judge, or write cases for it."
        : "This problem publishes no worked example with an expected answer, so Spar has no case it can assert. Use the source's own judge, or write cases for it.",
    );
  }

  if (language === "cpp") {
    const unsupported = unsupportedCppType(signature);
    if (unsupported) return refuse(`Spar's local C++ harness cannot build a value of type \`${unsupported}\`. Use the source's own judge for this one.`);
  }

  const files = {
    [paths.entry]: solutionFile(language, starter, signature),
    ...(language === "cpp"
      ? { [paths.test]: cppTest(signature, runnable), [paths.support as string]: CPP_SUPPORT }
      : { [paths.test]: scriptTest(language, signature, runnable) }),
  };
  return { supported: true, files, entryPath: paths.entry, testPaths: [paths.test], cases: runnable };
}

/** Builds a stdin/stdout workspace for conventional contest problems.
 *
 * Unlike LeetCode's function contract, Codeforces submits a complete program.
 * The editable file therefore stays byte-for-byte submittable between the same
 * markers, while each read-only test launches (or includes) that program with a
 * published sample on stdin and compares normalized stdout. */
export function buildProgramHarness(input: { problem: PracticeProblem; language: Language; cases: PracticeCase[] }): PracticeHarness {
  const { problem, language } = input;
  const paths: Record<Language, string> = { javascript: "src/solution.js", typescript: "src/solution.ts", cpp: "src/main.cpp" };
  const entryPath = paths[language];
  const starter = problem.languages.find((candidate) => candidate.language === language)?.starter ?? programStarter(language);
  const cases = input.cases.filter((entry) => entry.input.length === 1 && entry.expected.trim());
  const comment = language === "cpp" ? "//" : "//";
  const solution = [
    `${comment} Everything between the markers is submitted to ${problem.source === "codeforces" ? "Codeforces" : "the source"}.`,
    `${comment} ${SOLUTION_START}`,
    starter.replace(/\s+$/, ""),
    `${comment} ${SOLUTION_END}`,
    "",
  ].join("\n");
  if (!cases.length) return { supported: false, reason: "This problem publishes no complete input/output example Spar can run locally.", files: { [entryPath]: solution }, entryPath, testPaths: [], cases: [] };

  const testPath = language === "cpp" ? "tests/examples.test.cpp" : `tests/examples.test.${language === "typescript" ? "ts" : "js"}`;
  const test = language === "cpp" ? cppProgramTest(cases) : scriptProgramTest(entryPath, cases);
  const support = language === "cpp" ? { "include/bits/stdc++.h": `#pragma once\n${CPP_INCLUDES}\n` } : {};
  return { supported: true, files: { [entryPath]: solution, [testPath]: test, ...support }, entryPath, testPaths: [testPath, ...Object.keys(support)], cases };
}

function programStarter(language: Language): string {
  if (language === "cpp") return "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n\n  // Read input, solve the problem, and print the answer.\n  return 0;\n}";
  if (language === "typescript") return "import * as fs from \"fs\";\n\nconst input: string = fs.readFileSync(0, \"utf8\").trim();\n// Parse input, solve the problem, and print the answer.\nvoid input;";
  return "const fs = require(\"fs\");\n\nconst input = fs.readFileSync(0, \"utf8\").trim();\n// Parse input, solve the problem, and print the answer.\nvoid input;";
}

function scriptProgramTest(entryPath: string, cases: PracticeCase[]): string {
  const rows = cases.map((entry) => ({ name: entry.name, input: entry.input[0] ?? "", expected: entry.expected }));
  return [
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import { spawnSync } from "node:child_process";',
    'import { fileURLToPath } from "node:url";',
    `const solution = fileURLToPath(new URL("../${entryPath}", import.meta.url));`,
    `const cases = ${JSON.stringify(rows, null, 2)};`,
    'const clean = (value) => value.replace(/\\r\\n/g, "\\n").trimEnd().split("\\n").map((line) => line.trimEnd()).join("\\n");',
    'for (const item of cases) test(item.name, () => {',
    '  const run = spawnSync(process.execPath, [solution], { input: item.input, encoding: "utf8", timeout: 5000 });',
    '  assert.equal(run.status, 0, run.stderr || `program exited with ${run.status}`);',
    '  assert.equal(clean(run.stdout), clean(item.expected));',
    '});',
    '',
  ].join("\n");
}

function cppProgramTest(cases: PracticeCase[]): string {
  const rows = cases.map((entry) => ({ name: entry.name, input: entry.input[0] ?? "", expected: entry.expected }));
  return [
    '#include <iostream>', '#include <sstream>', '#include <string>', '#include <vector>',
    '#define main spar_solution_main', '#include "../src/main.cpp"', '#undef main',
    'struct Sample { std::string name, input, expected; };',
    'static std::string clean(std::string value) { while (!value.empty() && (value.back() == \'\\n\' || value.back() == \'\\r\' || value.back() == \' \')) value.pop_back(); return value; }',
    'int main() {',
    `  const std::vector<Sample> samples = ${cppSamples(rows)};`,
    '  for (const auto& sample : samples) {',
    '    std::istringstream input(sample.input); std::ostringstream output;',
    '    std::cin.clear(); std::cout.clear(); auto* oldIn = std::cin.rdbuf(input.rdbuf()); auto* oldOut = std::cout.rdbuf(output.rdbuf());',
    '    const int status = spar_solution_main(); std::cout.flush(); std::cin.rdbuf(oldIn); std::cout.rdbuf(oldOut); std::cin.clear(); std::cout.clear();',
    '    if (status != 0 || clean(output.str()) != clean(sample.expected)) { std::cerr << sample.name << " failed\\nexpected:\\n" << sample.expected << "\\nactual:\\n" << output.str() << "\\n"; return 1; }',
    '  }',
    '  return 0;',
    '}', '',
  ].join("\n");
}

function cppSamples(rows: Array<{ name: string; input: string; expected: string }>): string {
  const raw = (value: string) => { let delimiter = "SPAR"; while (value.includes(`)${delimiter}\"`)) delimiter += "_"; return `R\"${delimiter}(${value})${delimiter}\"`; };
  return `{${rows.map((row) => `{${raw(row.name)},${raw(row.input)},${raw(row.expected)}}`).join(",")}}`;
}

const LANGUAGE_NAME: Record<Language, string> = { javascript: "JavaScript", typescript: "TypeScript", cpp: "C++" };

const LAYOUT: Record<Language, { entry: string; test: string; support?: string }> = {
  javascript: { entry: "src/solution.js", test: "tests/examples.test.js" },
  typescript: { entry: "src/solution.ts", test: "tests/examples.test.ts" },
  cpp: { entry: "src/solution.h", test: "tests/examples.test.cpp", support: "tests/spar_check.h" },
};

/**
 * The file the learner works in.
 *
 * The source's starter goes between the markers untouched — including its
 * doc comment, which is where LeetCode states the parameter types for JavaScript
 * and is the only type information that language's starter carries. Everything
 * Spar needs in order to test it goes outside, so the region stays exactly what
 * the judge expects to receive.
 */
function solutionFile(language: Language, starter: string, signature: PracticeSignature | null): string {
  const body = starter.replace(/\s+$/, "");
  const entry = signature && !signature.classBased ? signature.name : "";
  if (language === "cpp") {
    return [
      "#pragma once",
      "",
      CPP_INCLUDES,
      "using namespace std;",
      "",
      `// ${SOLUTION_START}`,
      body,
      `// ${SOLUTION_END}`,
      "",
    ].join("\n");
  }
  return [
    `// ${SOLUTION_START}`,
    body,
    `// ${SOLUTION_END}`,
    "",
    ...(entry ? [`export { ${entry} as entry };`, ""] : []),
  ].join("\n");
}

/**
 * The generated test for JavaScript and TypeScript.
 *
 * Cases are embedded as JSON and compared with `deepStrictEqual`, which is the
 * right comparison for the answers LeetCode problems return: arrays and objects
 * by value, and no coercion. Two accommodations are worth naming:
 *
 * - Some problems accept any of several correct answers, and the statement's
 *   example shows one of them. There is no way to detect that from the API, so a
 *   failure is reported as a difference from *the published example* rather than
 *   as a wrong answer — the wording matters, because the learner may well be
 *   right and the local harness wrong. The source's judge is the authority and
 *   the message says so.
 * - An expected value that is not valid JSON is compared as text against the
 *   result's JSON form, which is what makes the handful of problems whose
 *   statements write answers loosely still testable.
 */
function scriptTest(language: Language, signature: PracticeSignature, cases: PracticeCase[]): string {
  const importPath = language === "typescript" ? "../src/solution.js" : "../src/solution.js";
  const rows = cases.map((entry) => ({
    name: entry.name,
    origin: entry.origin,
    args: entry.input.map((value) => value.trim()),
    expected: entry.expected.trim(),
  }));
  return [
    `import test from "node:test";`,
    `import assert from "node:assert/strict";`,
    `import { entry } from "${importPath}";`,
    "",
    "/* Generated from the problem's own published examples. Read-only: these are",
    "   the cases the source states, so editing them would be editing the problem. */",
    `const cases = ${JSON.stringify(rows, null, 2)};`,
    "",
    "const parse = (text) => { try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, value: text }; } };",
    "",
    "for (const item of cases) {",
    `  test(\`${signature.name} — \${item.name}\`, () => {`,
    "    const args = item.args.map((raw) => parse(raw).value);",
    `    const actual = entry(...args);`,
    "    const expected = parse(item.expected);",
    "    if (expected.ok) {",
    "      assert.deepStrictEqual(actual, expected.value, `${item.name}: expected ${item.expected}, got ${JSON.stringify(actual)}. This is the answer the problem statement publishes for this input; if your answer is also valid, submit and let the judge decide.`);",
    "      return;",
    "    }",
    "    assert.strictEqual(String(JSON.stringify(actual)), String(item.expected), `${item.name}: expected ${item.expected}, got ${JSON.stringify(actual)}.`);",
    "  });",
    "}",
    "",
  ].join("\n");
}

/** The C++ standard library surface LeetCode's own environment exposes. Listed
 *  rather than pulled in through `<bits/stdc++.h>`, which is a libstdc++ header
 *  and does not exist on the clang toolchain Spar builds with. */
const CPP_INCLUDES = [
  "#include <algorithm>", "#include <array>", "#include <bitset>", "#include <climits>", "#include <cmath>",
  "#include <cstdint>", "#include <cstdio>", "#include <cstring>", "#include <deque>", "#include <functional>",
  "#include <iostream>", "#include <limits>", "#include <map>", "#include <numeric>", "#include <queue>",
  "#include <set>", "#include <sstream>", "#include <stack>", "#include <string>", "#include <tuple>",
  "#include <unordered_map>", "#include <unordered_set>", "#include <utility>", "#include <vector>",
].join("\n");

/**
 * How a C++ result is compared.
 *
 * The comparison is done on a canonical text form rather than on the typed value,
 * for one reason: the expected answer arrives as text (from the statement) and
 * parsing it into the right C++ type would need a parser per type. Rendering the
 * *result* into the statement's own notation is the same problem solved once,
 * with whitespace normalised on both sides so `[0, 1]` and `[0,1]` agree.
 */
const CPP_SUPPORT = `#pragma once

/* Generated by Spar. Renders a result in the notation a LeetCode statement uses,
   so an answer can be compared against the expected text the problem publishes. */

#include <cmath>
#include <cstdio>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

namespace spar {

inline std::string render(bool value) { return value ? "true" : "false"; }
inline std::string render(int value) { return std::to_string(value); }
inline std::string render(long long value) { return std::to_string(value); }
inline std::string render(unsigned long long value) { return std::to_string(value); }
inline std::string render(char value) { return std::string("\\"") + value + "\\""; }
inline std::string render(const std::string& value) { return "\\"" + value + "\\""; }

/* Doubles are rendered to five decimals and trailing zeros trimmed, which is the
   precision LeetCode's own statements use for the problems that return one. */
inline std::string render(double value) {
  std::ostringstream out;
  out << std::fixed << std::setprecision(5) << value;
  std::string text = out.str();
  if (text.find('.') != std::string::npos) {
    while (!text.empty() && text.back() == '0') text.pop_back();
    if (!text.empty() && text.back() == '.') text.pop_back();
  }
  return text;
}

template <typename T>
inline std::string render(const std::vector<T>& values) {
  std::string out = "[";
  for (std::size_t index = 0; index < values.size(); ++index) {
    if (index) out += ",";
    out += render(values[index]);
  }
  return out + "]";
}

/** Whitespace is not meaningful in either notation, so it is removed from both
 *  sides before comparing. Nothing else is touched: a difference in quoting or
 *  in ordering is a real difference and must be reported. */
inline std::string canonical(const std::string& text) {
  std::string out;
  for (char character : text) {
    if (character != ' ' && character != '\\n' && character != '\\t' && character != '\\r') out += character;
  }
  return out;
}

inline bool matches(const std::string& actual, const std::string& expected) {
  return canonical(actual) == canonical(expected);
}

/** A value as a single-quoted TAP scalar: the quote doubled, and newlines flattened
 *  so one case's diagnostic block stays one block. */
inline std::string escape(const std::string& text) {
  std::string out;
  for (char character : text) {
    if (character == '\\'') out += "''";
    else if (character == '\\n' || character == '\\r') out += ' ';
    else out += character;
  }
  return out;
}

} // namespace spar
`;

/**
 * The generated C++ test: one translation unit with its own `main`, which is the
 * contract Spar's C++ runner already builds against. Every case is asserted and
 * the first failure prints both sides and returns non-zero, because the exit code
 * is the verdict and the printed diff is the only thing the learner can act on.
 */
function cppTest(signature: PracticeSignature, cases: PracticeCase[]): string {
  const lines = [
    `#include "solution.h"`,
    `#include "spar_check.h"`,
    "",
    "#include <iostream>",
    "#include <string>",
    "",
    "static int failures = 0;",
    "static int ordinal = 0;",
    "",
    /* TAP 13, byte for byte what `node --test` emits, because Spar reads a run's
       per-case verdicts out of TAP and had no reader for anything else — so a C++
       challenge produced a wall of raw output where a JavaScript one produced
       cases. The failing point carries its expected and actual in the diagnostic
       block, which is what puts the two values side by side in the result panel
       instead of leaving them to be read out of a log. */
    "static void check(const std::string& name, const std::string& actual, const std::string& expected) {",
    "  ++ordinal;",
    "  if (spar::matches(actual, expected)) {",
    "    std::cout << \"ok \" << ordinal << \" - \" << name << \"\\n\";",
    "    return;",
    "  }",
    "  ++failures;",
    "  std::cout << \"not ok \" << ordinal << \" - \" << name << \"\\n\"",
    "            << \"  ---\\n\"",
    "            << \"  error: 'expected \" << spar::escape(expected) << \", got \" << spar::escape(actual) << \"'\\n\"",
    "            << \"  expected: '\" << spar::escape(expected) << \"'\\n\"",
    "            << \"  actual: '\" << spar::escape(actual) << \"'\\n\"",
    "            << \"  ...\\n\";",
    "}",
    "",
    "int main() {",
    "  std::cout << \"TAP version 13\\n\";",
  ];
  cases.forEach((entry, index) => {
    const args = signature.params.map((param, position) => cppLiteral(entry.input[position] ?? "", metaTypeToCpp(param.type) ?? param.type));
    lines.push(`  {`);
    lines.push(`    Solution solution;`);
    signature.params.forEach((param, position) => {
      /* Bound to a named local because LeetCode's signatures take most containers
         by non-const reference, and a temporary will not bind to one. */
      lines.push(`    ${metaTypeToCpp(param.type) ?? "auto"} arg${position} = ${args[position]};`);
    });
    const call = `solution.${signature.name}(${signature.params.map((_param, position) => `arg${position}`).join(", ")})`;
    lines.push(`    check(${JSON.stringify(`${entry.name} (${entry.origin})`)}, spar::render(${call}), ${JSON.stringify(entry.expected.trim())});`);
    lines.push(`  }`);
    if (index < cases.length - 1) lines.push("");
  });
  lines.push("");
  lines.push("  std::cout << \"1..\" << ordinal << \"\\n\"");
  lines.push("            << \"# tests \" << ordinal << \"\\n\"");
  lines.push("            << \"# pass \" << (ordinal - failures) << \"\\n\"");
  lines.push("            << \"# fail \" << failures << \"\\n\";");
  /* The exit code is still the verdict. TAP is what the panel reads; the runner
     grades on the code, and the two must never disagree. */
  lines.push("  return failures == 0 ? 0 : 1;");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

/** The declared type, normalised: the reference and any `const` dropped, because
 *  what is being declared here is a local the call can bind to. */
function cppType(declared: string): string {
  return declared.replace(/\s*&\s*$/, "").replace(/^\s*const\s+/, "").trim();
}

/**
 * A `metaData` type, as C++.
 *
 * This mapping is required rather than convenient: a problem's signature comes
 * from `metaData`, and `metaData` is written in LeetCode's own language-neutral
 * type vocabulary — `integer`, `character[][]`, `list<integer>` — not in C++.
 * Reading those as C++ types is how a perfectly ordinary Two Sum ends up
 * declaring `integer[] arg0` and failing to compile for a reason that has nothing
 * to do with the learner.
 *
 * Returns null for a type the harness cannot construct, which is what
 * `unsupportedCppType` reports and what sends the problem to the remote judge.
 * Real C++ spellings are accepted too, so a source that publishes them directly
 * needs no second mapping.
 */
export function metaTypeToCpp(declared: string): string | null {
  const type = cppType(declared);
  if (!type) return null;
  const scalar = CPP_SCALAR[type.toLowerCase()];
  if (scalar) return scalar;
  const wrapped = /^(?:list|vector)<(.*)>$/is.exec(type);
  if (wrapped) {
    const inner = metaTypeToCpp((wrapped[1] ?? "").trim());
    return inner ? `vector<${inner}>` : null;
  }
  const suffixed = /^(.*)\[\]$/s.exec(type);
  if (suffixed) {
    const inner = metaTypeToCpp((suffixed[1] ?? "").trim());
    return inner ? `vector<${inner}>` : null;
  }
  return null;
}

/** LeetCode's scalar type names on the left, and the C++ spellings its own
 *  starters use on the right. `long` is `long long` deliberately: LeetCode's
 *  `long` problems overflow 32 bits, which is the entire reason they use it. */
const CPP_SCALAR: Record<string, string> = {
  integer: "int", int: "int",
  long: "long long", "long long": "long long", int64: "long long",
  double: "double", float: "double",
  string: "string",
  character: "char", char: "char",
  boolean: "bool", bool: "bool",
  void: "void",
};

/**
 * A JSON literal from the statement, as a C++ initialiser.
 *
 * The transformation is textual and narrow by design: JSON's brackets become
 * braces, and a JSON string becomes a character literal when the target element
 * type is `char`. It is only ever reached for the types `unsupportedCppType` has
 * already allowed, so it never has to guess what a value means.
 */
export function cppLiteral(value: string, declaredType: string): string {
  const type = cppType(declaredType);
  const text = value.trim();
  if (!text) return type.startsWith("vector") ? "{}" : "{}";
  if (/^(string)$/.test(type)) return /^".*"$/s.test(text) ? text : JSON.stringify(text);
  if (type === "char") return `'${text.replace(/^"|"$/g, "")}'`;
  if (type === "bool") return text.toLowerCase() === "true" ? "true" : "false";
  if (/^(int|long|long long|unsigned|double|float)$/.test(type)) return text;
  // Containers: JSON arrays are brace-initialised, elementwise.
  const elementType = type.replace(/^vector<(.*)>$/s, "$1").trim();
  const inner = text.replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return "{}";
  const parts = splitTopLevel(inner);
  return `{${parts.map((part) => cppLiteral(part, elementType)).join(", ")}}`;
}

/** Splits a JSON array body on its own commas, ignoring commas nested inside
 *  brackets or strings — which is the only correct way to walk a matrix. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] as string;
    if (quoted) {
      current += character;
      if (character === "\\") { current += body[index + 1] ?? ""; index += 1; }
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; current += character; continue; }
    if (character === "[" || character === "{") depth += 1;
    if (character === "]" || character === "}") depth -= 1;
    if (character === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += character;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim());
}

/** The first parameter or return type the local C++ harness cannot build, or
 *  null when it can build all of them. Pointer types — `ListNode*`, `TreeNode*`
 *  — are the common case, and they need the source's own judge. */
function unsupportedCppType(signature: PracticeSignature): string | null {
  for (const declared of [...signature.params.map((param) => param.type), signature.returnType]) {
    const type = cppType(declared);
    if (!type || type.toLowerCase() === "void") continue;
    if (!metaTypeToCpp(type)) return declared;
  }
  return null;
}

/**
 * A case block in the source's own wire format: one argument per line, cases
 * concatenated. This is what a remote run has to be posted with, and it is
 * generated from the same cases the local harness asserts so the two paths test
 * the same thing.
 */
export function judgeInputBlock(cases: Array<Pick<PracticeCase, "input">>): string {
  return cases.map((entry) => entry.input.map((value) => value.trim()).join("\n")).join("\n");
}
