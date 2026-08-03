import type { QuestionDesign } from "@spar/domain";

type Language = QuestionDesign["language"];

/**
 * The last resort when every model-authored candidate has been rejected.
 *
 * A session that ends with "challenge generation stopped after 15 rejected
 * attempts" has taught the learner nothing and left them nowhere to go. These
 * designs are held to the same bar as any other candidate — they are compiled
 * and validated by the host like everything else, never trusted — but they are
 * written against the build contract rather than guessed at, so validation
 * passes. The trade is honest and worth naming: a fixed exercise is less
 * targeted than one written for this learner's gap, and the caller marks it as
 * a fallback so nothing downstream reads it as a bespoke challenge.
 *
 * Each carries a genuine, plausible misconception — accumulating the whole
 * input after the invariant is already satisfied — which passes the visible
 * contract and fails the hidden one, so the attempt still produces real
 * evidence about whether the learner traces state or pattern-matches.
 */
export function fallbackDesign(language: Language): QuestionDesign {
  return DESIGNS[language];
}

export const FALLBACK_TITLE = "Stop at the first sufficient prefix";

const STATEMENT =
  "Given a list of positive weights and a threshold, return how many leading items are needed before the running total first reaches that threshold. Stop as soon as the threshold is reached — later items must not change the answer. Return 0 when the total of every item is still below the threshold.";

const javascript: QuestionDesign = {
  title: FALLBACK_TITLE,
  language: "javascript",
  kind: "function",
  difficulty: "foundation",
  statement: STATEMENT,
  starterFiles: { "src/prefix.js": "export function prefixLength(weights, threshold) {\n  throw new Error(\"implement prefixLength\");\n}\n" },
  referenceFiles: { "src/prefix.js": "export function prefixLength(weights, threshold) {\n  let total = 0;\n  for (let index = 0; index < weights.length; index += 1) {\n    total += weights[index];\n    if (total >= threshold) return index + 1;\n  }\n  return 0;\n}\n" },
  visibleTests: { "tests/visible.test.js": "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { prefixLength } from \"../src/prefix.js\";\n\ntest(\"counts the leading items that reach the threshold\", () => {\n  assert.strictEqual(prefixLength([2, 3], 5), 2);\n});\n\ntest(\"returns 0 when the total never reaches the threshold\", () => {\n  assert.strictEqual(prefixLength([1, 1], 9), 0);\n});\n" },
  hiddenTests: { "tests/hidden.test.js": "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { prefixLength } from \"../src/prefix.js\";\n\ntest(\"stops at the first sufficient prefix and ignores later items\", () => {\n  assert.strictEqual(prefixLength([3, 3, 9], 5), 2);\n});\n" },
  knownIncorrectFiles: [{ "src/prefix.js": "export function prefixLength(weights, threshold) {\n  let total = 0;\n  for (const weight of weights) total += weight;\n  return total >= threshold ? weights.length : 0;\n}\n" }],
  runCommand: "node --test",
  accidentalDifficulty: [],
  expectedFailureSignatures: ["accumulates the complete input after the threshold is already reached"],
};

const typescript: QuestionDesign = {
  ...javascript,
  language: "typescript",
  starterFiles: { "src/prefix.ts": "export function prefixLength(weights: number[], threshold: number): number {\n  throw new Error(\"implement prefixLength\");\n}\n" },
  referenceFiles: { "src/prefix.ts": "export function prefixLength(weights: number[], threshold: number): number {\n  let total = 0;\n  for (let index = 0; index < weights.length; index += 1) {\n    total += weights[index]!;\n    if (total >= threshold) return index + 1;\n  }\n  return 0;\n}\n" },
  visibleTests: { "tests/visible.test.ts": "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { prefixLength } from \"../src/prefix.js\";\n\ntest(\"counts the leading items that reach the threshold\", () => {\n  assert.strictEqual(prefixLength([2, 3], 5), 2);\n});\n\ntest(\"returns 0 when the total never reaches the threshold\", () => {\n  assert.strictEqual(prefixLength([1, 1], 9), 0);\n});\n" },
  hiddenTests: { "tests/hidden.test.ts": "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { prefixLength } from \"../src/prefix.js\";\n\ntest(\"stops at the first sufficient prefix and ignores later items\", () => {\n  assert.strictEqual(prefixLength([3, 3, 9], 5), 2);\n});\n" },
  knownIncorrectFiles: [{ "src/prefix.ts": "export function prefixLength(weights: number[], threshold: number): number {\n  let total = 0;\n  for (const weight of weights) total += weight;\n  return total >= threshold ? weights.length : 0;\n}\n" }],
};

const HEADER = "#pragma once\n#include <vector>\n\nint prefix_length(const std::vector<int>& weights, int threshold);\n";

const cpp: QuestionDesign = {
  ...javascript,
  language: "cpp",
  starterFiles: {
    "src/prefix.h": HEADER,
    "src/prefix.cpp": "#include \"prefix.h\"\n\nint prefix_length(const std::vector<int>& weights, int threshold) {\n  (void)weights;\n  (void)threshold;\n  return -1; // implement prefix_length\n}\n",
  },
  referenceFiles: {
    "src/prefix.h": HEADER,
    "src/prefix.cpp": "#include \"prefix.h\"\n\nint prefix_length(const std::vector<int>& weights, int threshold) {\n  int total = 0;\n  for (std::size_t index = 0; index < weights.size(); ++index) {\n    total += weights[index];\n    if (total >= threshold) return static_cast<int>(index) + 1;\n  }\n  return 0;\n}\n",
  },
  visibleTests: { "tests/visible.test.cpp": "#include \"prefix.h\"\n#include <cassert>\n\nint main() {\n  assert(prefix_length({2, 3}, 5) == 2);\n  assert(prefix_length({1, 1}, 9) == 0);\n  return 0;\n}\n" },
  hiddenTests: { "tests/hidden.test.cpp": "#include \"prefix.h\"\n#include <cassert>\n\nint main() {\n  assert(prefix_length({3, 3, 9}, 5) == 2);\n  return 0;\n}\n" },
  knownIncorrectFiles: [{
    "src/prefix.cpp": "#include \"prefix.h\"\n\nint prefix_length(const std::vector<int>& weights, int threshold) {\n  int total = 0;\n  for (std::size_t index = 0; index < weights.size(); ++index) total += weights[index];\n  return total >= threshold ? static_cast<int>(weights.size()) : 0;\n}\n",
  }],
  runCommand: "clang++ && run tests",
};

const DESIGNS: Record<Language, QuestionDesign> = { javascript, typescript, cpp };
