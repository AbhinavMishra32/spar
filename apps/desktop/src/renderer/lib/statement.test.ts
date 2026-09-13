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
    expect(parsed.examples[0]).toMatchObject({ call: "`target = 7`, `values = [2, 3, 1, 2, 4, 3]`", result: "`2`" });
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
