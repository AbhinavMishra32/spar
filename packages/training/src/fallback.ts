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

const python:QuestionDesign={...javascript,language:"python",starterFiles:{"src/prefix.py":"def prefix_length(weights, threshold):\n    raise NotImplementedError(\"implement prefix_length\")\n"},referenceFiles:{"src/prefix.py":"def prefix_length(weights, threshold):\n    total = 0\n    for index, weight in enumerate(weights):\n        total += weight\n        if total >= threshold:\n            return index + 1\n    return 0\n"},visibleTests:{"tests/test_visible.py":"from src.prefix import prefix_length\nassert prefix_length([2, 3], 5) == 2\nassert prefix_length([1, 1], 9) == 0\n"},hiddenTests:{"tests/test_hidden.py":"from src.prefix import prefix_length\nassert prefix_length([3, 3, 9], 5) == 2\n"},knownIncorrectFiles:[{"src/prefix.py":"def prefix_length(weights, threshold):\n    return len(weights) if sum(weights) >= threshold else 0\n"}]};

const java:QuestionDesign={...javascript,language:"java",starterFiles:{"src/Prefix.java":"public final class Prefix {\n  public static int prefixLength(int[] weights, int threshold) { throw new UnsupportedOperationException(\"implement\"); }\n}\n"},referenceFiles:{"src/Prefix.java":"public final class Prefix {\n  public static int prefixLength(int[] weights, int threshold) { int total=0; for(int i=0;i<weights.length;i++){ total+=weights[i]; if(total>=threshold)return i+1; } return 0; }\n}\n"},visibleTests:{"tests/VisibleTest.java":"public final class VisibleTest { public static void main(String[] args) { assert Prefix.prefixLength(new int[]{2,3},5)==2; assert Prefix.prefixLength(new int[]{1,1},9)==0; } }\n"},hiddenTests:{"tests/HiddenTest.java":"public final class HiddenTest { public static void main(String[] args) { assert Prefix.prefixLength(new int[]{3,3,9},5)==2; } }\n"},knownIncorrectFiles:[{"src/Prefix.java":"public final class Prefix { public static int prefixLength(int[] weights,int threshold){ int total=0; for(int value:weights)total+=value; return total>=threshold?weights.length:0; } }\n"}]};

const C_HEADER="#ifndef PREFIX_H\n#define PREFIX_H\n#include <stddef.h>\nint prefix_length(const int *weights, size_t length, int threshold);\n#endif\n";
const c:QuestionDesign={...javascript,language:"c",starterFiles:{"src/prefix.h":C_HEADER,"src/prefix.c":"#include \"prefix.h\"\nint prefix_length(const int *weights, size_t length, int threshold) { (void)weights; (void)length; (void)threshold; return -1; }\n"},referenceFiles:{"src/prefix.h":C_HEADER,"src/prefix.c":"#include \"prefix.h\"\nint prefix_length(const int *weights, size_t length, int threshold) { int total=0; for(size_t i=0;i<length;i++){ total+=weights[i]; if(total>=threshold)return (int)i+1; } return 0; }\n"},visibleTests:{"tests/visible.test.c":"#include \"prefix.h\"\n#include <assert.h>\nint main(void){int a[]={2,3};int b[]={1,1};assert(prefix_length(a,2,5)==2);assert(prefix_length(b,2,9)==0);return 0;}\n"},hiddenTests:{"tests/hidden.test.c":"#include \"prefix.h\"\n#include <assert.h>\nint main(void){int a[]={3,3,9};assert(prefix_length(a,3,5)==2);return 0;}\n"},knownIncorrectFiles:[{"src/prefix.c":"#include \"prefix.h\"\nint prefix_length(const int *weights,size_t length,int threshold){int total=0;for(size_t i=0;i<length;i++)total+=weights[i];return total>=threshold?(int)length:0;}\n"}]};

const go:QuestionDesign={...javascript,language:"go",starterFiles:{"src/prefix.go":"package prefix\nfunc PrefixLength(weights []int, threshold int) int { panic(\"implement\") }\n"},referenceFiles:{"src/prefix.go":"package prefix\nfunc PrefixLength(weights []int, threshold int) int { total:=0; for i,value:=range weights { total+=value; if total>=threshold{return i+1} }; return 0 }\n"},visibleTests:{"src/prefix_visible_test.go":"package prefix\nimport \"testing\"\nfunc TestVisible(t *testing.T){if PrefixLength([]int{2,3},5)!=2{t.Fatal()};if PrefixLength([]int{1,1},9)!=0{t.Fatal()}}\n"},hiddenTests:{"src/prefix_hidden_test.go":"package prefix\nimport \"testing\"\nfunc TestHidden(t *testing.T){if PrefixLength([]int{3,3,9},5)!=2{t.Fatal()}}\n"},knownIncorrectFiles:[{"src/prefix.go":"package prefix\nfunc PrefixLength(weights []int,threshold int)int{total:=0;for _,value:=range weights{total+=value};if total>=threshold{return len(weights)};return 0}\n"}]};

const rust:QuestionDesign={...javascript,language:"rust",starterFiles:{"src/prefix.rs":"pub fn prefix_length(_weights: &[i32], _threshold: i32) -> usize { todo!(\"implement\") }\n"},referenceFiles:{"src/prefix.rs":"pub fn prefix_length(weights: &[i32], threshold: i32) -> usize { let mut total=0; for (index,value) in weights.iter().enumerate(){total+=value;if total>=threshold{return index+1;}} 0 }\n"},visibleTests:{"tests/visible_test.rs":"#[path = \"../src/prefix.rs\"] mod prefix;\n#[test] fn visible(){assert_eq!(prefix::prefix_length(&[2,3],5),2);assert_eq!(prefix::prefix_length(&[1,1],9),0);}\n"},hiddenTests:{"tests/hidden_test.rs":"#[path = \"../src/prefix.rs\"] mod prefix;\n#[test] fn hidden(){assert_eq!(prefix::prefix_length(&[3,3,9],5),2);}\n"},knownIncorrectFiles:[{"src/prefix.rs":"pub fn prefix_length(weights:&[i32],threshold:i32)->usize{if weights.iter().sum::<i32>()>=threshold{weights.len()}else{0}}\n"}]};

const swift:QuestionDesign={...javascript,language:"swift",starterFiles:{"src/Prefix.swift":"func prefixLength(_ weights: [Int], _ threshold: Int) -> Int { fatalError(\"implement\") }\n"},referenceFiles:{"src/Prefix.swift":"func prefixLength(_ weights: [Int], _ threshold: Int) -> Int { var total=0; for (index,value) in weights.enumerated(){total += value;if total >= threshold{return index+1}};return 0 }\n"},visibleTests:{"tests/visible.test.swift":"@main enum VisibleTest { static func main(){precondition(prefixLength([2,3],5)==2);precondition(prefixLength([1,1],9)==0)} }\n"},hiddenTests:{"tests/hidden.test.swift":"@main enum HiddenTest { static func main(){precondition(prefixLength([3,3,9],5)==2)} }\n"},knownIncorrectFiles:[{"src/Prefix.swift":"func prefixLength(_ weights:[Int],_ threshold:Int)->Int{weights.reduce(0,+) >= threshold ? weights.count : 0}\n"}]};

const ruby:QuestionDesign={...javascript,language:"ruby",starterFiles:{"src/prefix.rb":"def prefix_length(weights, threshold)\n  raise 'implement prefix_length'\nend\n"},referenceFiles:{"src/prefix.rb":"def prefix_length(weights, threshold)\n  total = 0\n  weights.each_with_index do |weight, index|\n    total += weight\n    return index + 1 if total >= threshold\n  end\n  0\nend\n"},visibleTests:{"tests/visible_test.rb":"require_relative '../src/prefix'\nraise unless prefix_length([2,3],5) == 2\nraise unless prefix_length([1,1],9) == 0\n"},hiddenTests:{"tests/hidden_test.rb":"require_relative '../src/prefix'\nraise unless prefix_length([3,3,9],5) == 2\n"},knownIncorrectFiles:[{"src/prefix.rb":"def prefix_length(weights, threshold)\n  weights.sum >= threshold ? weights.length : 0\nend\n"}]};

const DESIGNS: Record<Language, QuestionDesign> = { javascript, typescript, python, java, c, cpp, go, rust, swift, ruby };
