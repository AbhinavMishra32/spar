import { describe, expect, it } from "vitest";
import { parseExamples, splitExampleInput, statementToMarkdown } from "./statement.js";

/* A real LeetCode statement, trimmed but not tidied: the markup below is the
   shape the API actually returns, entities and non-breaking spaces included. */
const TWO_SUM = `<p>Given an array of integers <code>nums</code>&nbsp;and an integer <code>target</code>, return <em>indices of the two numbers such that they add up to <code>target</code></em>.</p>

<p>&nbsp;</p>
<p><strong class="example">Example 1:</strong></p>

<pre>
<strong>Input:</strong> nums = [2,7,11,15], target = 9
<strong>Output:</strong> [0,1]
<strong>Explanation:</strong> Because nums[0] + nums[1] == 9, we return [0, 1].
</pre>

<p><strong class="example">Example 2:</strong></p>

<pre>
<strong>Input:</strong> nums = [3,2,4], target = 6
<strong>Output:</strong> [1,2]
</pre>

<p><strong>Constraints:</strong></p>

<ul>
	<li><code>2 &lt;= nums.length &lt;= 10<sup>4</sup></code></li>
	<li><code>-10<sup>9</sup> &lt;= nums[i] &lt;= 10<sup>9</sup></code></li>
</ul>`;

describe("statementToMarkdown", () => {
  it("keeps the prose, the code spans and the constraint list", () => {
    const markdown = statementToMarkdown(TWO_SUM);
    expect(markdown).toContain("Given an array of integers `nums` and an integer `target`");
    expect(markdown).toContain("- `2 <= nums.length <= 10^4`");
    expect(markdown).toContain("**Constraints:**");
  });

  it("fences the example blocks so they are not reflowed", () => {
    const markdown = statementToMarkdown(TWO_SUM);
    expect(markdown).toContain("```\nInput: nums = [2,7,11,15], target = 9");
  });

  it("turns a non-breaking space into a plain one", () => {
    // A U+00A0 left in the statement is invisible in the pane and breaks every
    // string comparison a generated case tries to make.
    expect(statementToMarkdown("<p>a&nbsp;b</p>")).toBe("a b");
    expect(statementToMarkdown("<p>a&nbsp;b</p>")).not.toContain("\u00a0");
  });

  it("leaves an empty statement empty rather than producing whitespace", () => {
    expect(statementToMarkdown("")).toBe("");
  });
});

describe("parseExamples", () => {
  it("reads every example, with the explanation when there is one", () => {
    const examples = parseExamples(TWO_SUM);
    expect(examples).toHaveLength(2);
    expect(examples[0]).toEqual({
      input: "nums = [2,7,11,15], target = 9",
      output: "[0,1]",
      explanation: "Because nums[0] + nums[1] == 9, we return [0, 1].",
    });
    expect(examples[1]?.explanation).toBe("");
  });

  it("ignores a pre block that is not an example", () => {
    expect(parseExamples("<pre>some ascii art</pre>")).toEqual([]);
  });

  it("keeps a multi-line output whole", () => {
    const examples = parseExamples(`<pre>
<strong>Input:</strong> grid = [[1]]
<strong>Output:</strong> [[1,2],
[3,4]]
</pre>`);
    expect(examples[0]?.output).toBe("[[1,2],\n[3,4]]");
  });
});

describe("splitExampleInput", () => {
  it("splits on the declared parameter names, not on commas", () => {
    expect(splitExampleInput("nums = [2,7,11,15], target = 9", ["nums", "target"])).toEqual(["[2,7,11,15]", "9"]);
  });

  it("keeps signature order when the statement lists arguments in another", () => {
    expect(splitExampleInput("target = 9, nums = [1,2]", ["nums", "target"])).toEqual(["[1,2]", "9"]);
  });

  it("accepts a single argument written with or without its name", () => {
    expect(splitExampleInput("s = \"abc\"", ["s"])).toEqual(["\"abc\""]);
    expect(splitExampleInput("\"abc\"", ["s"])).toEqual(["\"abc\""]);
  });

  it("refuses rather than guessing when a name is absent", () => {
    // A mis-segmented argument list produces a test that fails for a reason
    // that has nothing to do with the learner.
    expect(splitExampleInput("[1,2], 9", ["nums", "target"])).toBeNull();
  });

  it("handles a string value that contains the other parameter's name", () => {
    expect(splitExampleInput('s = "target = 3", target = 3', ["s", "target"])).toEqual(['"target = 3"', "3"]);
  });
});
