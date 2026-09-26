import { describe, expect, it } from "vitest";
import { parseStatement } from "./statement";

/**
 * The statement the agent writes today: its own headings, numbered examples with
 * Input and Output, a Constraints tail. Rendered as written it draws a second
 * hierarchy on top of the panel's own — and three examples written as three
 * separate lists all number themselves `1.`.
 */
const WRITTEN = `## Problem description

Implement \`min_subarray_len(target, values)\` to return the length of the shortest contiguous subarray whose values have a sum greater than or equal to \`target\`. Every value in \`values\` is a positive integer.

Return \`0\` when no such subarray exists. Do not modify \`values\`.

## Examples

1. **Input:** \`target = 7\`, \`values = [2, 3, 1, 2, 4, 3]\`

**Output:** \`2\`

**Explanation:** The subarray \`[4, 3]\` reaches the target and has the smallest length.

1. **Input:** \`target = 4\`, \`values = [1, 4, 4]\`

**Output:** \`1\`

1. **Input:** \`target = 20\`, \`values = [2, 3, 1, 2]\`

**Output:** \`0\`

**Explanation:** The sum of the entire list is less than the target, so no qualifying subarray exists.

## Constraints

- \`1 <= len(values) <= 10000\`
- Export the function at module level.`;

describe("a statement that wrote its own headings", () => {
  const parsed = parseStatement(WRITTEN);

  it("is read out rather than printed, so the panel draws the hierarchy once", () => {
    expect(parsed.structured).toBe(true);
    expect(parsed.lead).toContain("shortest contiguous subarray");
    // The heading names themselves are gone: the surface already says what each part is.
    expect(parsed.lead).not.toContain("Problem description");
    expect(JSON.stringify(parsed)).not.toContain("## ");
  });

  it("keeps every example, and the explanation with the example it explains", () => {
    expect(parsed.examples).toHaveLength(3);
    expect(parsed.examples[0]).toMatchObject({ call: "target = 7, values = [2, 3, 1, 2, 4, 3]", result: "2" });
    expect(parsed.examples[0]?.note).toContain("smallest length");
    // The one with no explanation simply has none, rather than borrowing its neighbour's.
    expect(parsed.examples[1]?.note).toBeUndefined();
    expect(parsed.examples[2]?.note).toContain("less than the target");
  });

  it("turns the rules into the requirement lines, without their markers", () => {
    expect(parsed.requirements).toEqual(["Return `0` when no such subarray exists.", "Do not modify `values`."]);
    expect(parsed.note).toContain("Export the function at module level.");
  });
});

describe("statements that should be left as they were written", () => {
  it("leaves a bare paragraph under a heading alone — there is nothing to group", () => {
    expect(parseStatement("## Problem\n\nWrite a function that reverses a list.").structured).toBe(false);
  });

  it("still re-groups the unstructured blob the parser was written for", () => {
    const blob = "Write `total(values)` returning the sum. Ignore negatives. Return 0 for an empty list. Examples: `total([1,2])` returns `3`.";
    const parsed = parseStatement(blob);
    expect(parsed.structured).toBe(true);
    expect(parsed.examples).toEqual([{ call: "total([1,2])", result: "3" }]);
  });
});

describe("saved statements with escaped line breaks", () => {
  it("recovers the same sections, examples and constraints as real Markdown", () => {
    expect(parseStatement(WRITTEN.replaceAll("\n", "\\n"))).toEqual(parseStatement(WRITTEN));
  });
  it("returns repaired Markdown even when no custom grouping is needed", () => {
    expect(parseStatement("Read this.\\n\\nThen implement it.").lead).toBe("Read this.\n\nThen implement it.");
  });
});

it("recovers the holdout question alongside host-appended requirements", () => {
  const source = String.raw`Implement \`evaluate_holdout(records, test_indices)\`.\n\n- Exclude held-out records.\n- Preserve test order.\n\n**Examples**\n\n1. **Input:** \`records = [[1, 10], [2, 30], [3, 20], [4, 40]]\`, \`test_indices = [1, 3]\`\n   **Output:** \`{"predictions": [15.0, 15.0], "mae": 20.0}\`\n   **Explanation:** Training labels 10 and 20 average to 15.\n\n**Constraints**\n\n- At least one training record.`.replaceAll('\\`', '`') + "\n\n## How this must be solved\n\n- Keep held-out data out of training.";
  const parsed = parseStatement(source);
  expect(parsed.structured).toBe(true);
  expect(parsed.requirements).toEqual(["Exclude held-out records.", "Preserve test order."]);
  expect(parsed.examples).toHaveLength(1);
  expect(parsed.examples[0]?.result).toContain('"mae": 20.0');
  expect(parsed.note).toContain("At least one training record.");
  expect(parsed.note).toContain("Keep held-out data out of training.");
  expect(parsed.lead).not.toContain("\\n");
});

/* LeetCode 700 as `statementToMarkdown` writes it. The constraints are the only
   bullets, and keeping only the bullets used to leave the problem as its first
   sentence and its constraints — the task itself and the tree were gone. */
it("keeps the prose, figure and examples around a statement's bullets", () => {
  const source = [
    "You are given the `root` of a binary search tree (BST) and an integer `val`.",
    "",
    "Find the node in the BST that the node's value equals `val` and return the subtree rooted with that node. If such a node does not exist, return `null`.",
    "",
    "**Example 1:**",
    "",
    "![](https://assets.leetcode.com/uploads/2021/01/12/tree1.jpg)",
    "",
    "```",
    "Input: root = [4,2,7,1,3], val = 2",
    "Output: [2,1,3]",
    "```",
    "",
    "**Constraints:**",
    "",
    "- The number of nodes in the tree is in the range `[1, 5000]`.",
    "- `1 <= Node.val <= 10^7`",
  ].join("\n");
  const parsed = parseStatement(source);
  expect(parsed.lead).toContain("Find the node in the BST");
  expect(parsed.lead).toContain("![](https://assets.leetcode.com/uploads/2021/01/12/tree1.jpg)");
  expect(parsed.lead).toContain("Input: root = [4,2,7,1,3], val = 2");
  expect(parsed.requirements).toEqual([
    "The number of nodes in the tree is in the range `[1, 5000]`.",
    "`1 <= Node.val <= 10^7`",
  ]);
});

describe("figures in a statement", () => {
  const figure = '{"type":"tree","values":[3,9,20,null,null,15,7]}';

  it("gives a figure written above an example's Input to that example", () => {
    const parsed = parseStatement(`Return the maximum depth of the tree.\n\n## Examples\n\n\`\`\`figure\n${figure}\n\`\`\`\n\nInput: root = [3,9,20,null,null,15,7]\nOutput: 3\n\nInput: root = [1]\nOutput: 1\n\n## Constraints\n\n- up to 10^4 nodes`);
    expect(parsed.examples).toHaveLength(2);
    expect(parsed.examples[0]!.figure).toBe(figure);
    expect(parsed.examples[1]!.figure).toBeUndefined();
  });

  it("keeps a figure between Input and Output with its own example", () => {
    const parsed = parseStatement(`Return the maximum depth.\n\n## Examples\n\nInput: root = [1]\nOutput: 1\n\nInput: root = [3,9,20,null,null,15,7]\n\`\`\`figure\n${figure}\n\`\`\`\nOutput: 3`);
    expect(parsed.examples[1]!.figure).toBe(figure);
    expect(parsed.examples[0]!.figure).toBeUndefined();
  });

  it("keeps a figure in a prose body instead of reading its JSON as sentences", () => {
    const parsed = parseStatement(`Return the maximum depth.\n\nThe depth counts nodes. A leaf has depth one.\n\n\`\`\`figure\n${figure}\n\`\`\`\n\n## Examples\n\nInput: root = [1]\nOutput: 1`);
    expect(parsed.requirements.join(" ")).not.toContain("values");
    expect(parsed.lead).toContain("```figure");
    expect(parsed.lead).toContain(figure);
  });
});

describe("example cards", () => {
  it("does not run the next example's label into an explanation", () => {
    const parsed = parseStatement([
      "Return the children of the root.",
      "",
      "- Return a pair.",
      "- Use None for a missing child.",
      "",
      "## Examples",
      "",
      "**Example 1**",
      "Input: `root = Node(8, Node(3), Node(10))`",
      "Output: `(3, 10)`",
      "Explanation: The left child is `3` and the right is `10`.",
      "**Example 2**",
      "Input: `root = Node(5, None, Node(7))`",
      "Output: `(None, 7)`",
      "Explanation: No left child. **Example 3**",
      "Input: `root = Node(6)`",
      "Output: `(None, None)`",
    ].join("\n"));
    expect(parsed.examples.map((example) => [example.call, example.result])).toEqual([
      ["root = Node(8, Node(3), Node(10))", "(3, 10)"],
      ["root = Node(5, None, Node(7))", "(None, 7)"],
      ["root = Node(6)", "(None, None)"],
    ]);
    expect(parsed.examples[0]?.note).toBe("The left child is `3` and the right is `10`.");
    expect(parsed.examples[1]?.note).toBe("No left child.");
  });
});
