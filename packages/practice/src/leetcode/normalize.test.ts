import { describe, expect, it } from "vitest";
import { casesForProblem, normalizeProblem, normalizeProblemSummary } from "./normalize.js";

/* The wire shape, with every field LeetCode sends as something other than what
   it looks like: metaData and stats are JSON strings, similarQuestionList is a
   real array on global, hints may be absent, status is null when untouched. */
const NODE = {
  questionId: "3",
  questionFrontendId: "3",
  title: "Longest Substring Without Repeating Characters",
  titleSlug: "longest-substring-without-repeating-characters",
  isPaidOnly: false,
  difficulty: "Medium",
  content: `<p>Given a string <code>s</code>, find the length of the <strong>longest substring</strong> without duplicate characters.</p>
<p><strong class="example">Example 1:</strong></p>
<pre>
<strong>Input:</strong> s = "abcabcbb"
<strong>Output:</strong> 3
<strong>Explanation:</strong> The answer is "abc", with the length of 3.
</pre>
<p><strong class="example">Example 2:</strong></p>
<pre>
<strong>Input:</strong> s = "bbbbb"
<strong>Output:</strong> 1
</pre>`,
  status: null,
  stats: '{"totalAccepted": "5.9M", "acRate": "36.8%"}',
  metaData: '{"name": "lengthOfLongestSubstring", "params": [{"name": "s", "type": "string"}], "return": {"type": "integer"}}',
  exampleTestcaseList: ['"abcabcbb"', '"bbbbb"'],
  codeSnippets: [
    { lang: "C++", langSlug: "cpp", code: "class Solution {\npublic:\n    int lengthOfLongestSubstring(string s) {\n\n    }\n};" },
    { lang: "JavaScript", langSlug: "javascript", code: "var lengthOfLongestSubstring = function(s) {\n\n};" },
    { lang: "Rust", langSlug: "rust", code: "impl Solution {}" },
  ],
  topicTags: [{ name: "Hash Table", slug: "hash-table" }, { name: "String", slug: "string" }, { name: "Sliding Window", slug: "sliding-window" }],
  similarQuestionList: [{ difficulty: "Medium", titleSlug: "longest-repeating-character-replacement", title: "Longest Repeating Character Replacement", isPaidOnly: false }],
};

describe("normalizeProblem", () => {
  const problem = normalizeProblem(NODE, "global");

  it("reads the identity the judge needs and the one the learner sees", () => {
    // externalId is what a run must be posted with; displayId is the number on
    // the site. Confusing the two is a judge error with no useful message.
    expect(problem?.externalId).toBe("3");
    expect(problem?.displayId).toBe("3");
    expect(problem?.url).toBe("https://leetcode.com/problems/longest-substring-without-repeating-characters/");
    expect(problem?.difficulty).toBe("medium");
  });

  it("parses the signature out of the metaData string", () => {
    expect(problem?.signature).toEqual({
      name: "lengthOfLongestSubstring",
      params: [{ name: "s", type: "string" }],
      returnType: "integer",
      classBased: false,
    });
  });

  it("keeps only the languages Spar can build", () => {
    expect(problem?.languages.map((entry) => entry.language)).toEqual(["cpp", "javascript", "rust"]);
  });

  it("tags the problem in Spar's vocabulary, with exactly one primary", () => {
    expect(problem?.concepts).toEqual([
      { slug: "hash-maps", role: "primary" },
      { slug: "strings", role: "supporting" },
      { slug: "sliding-window", role: "supporting" },
    ]);
  });

  it("recovers the examples the API does not publish as data", () => {
    // The inputs come from the API; the expected answers exist only in the prose,
    // which is what makes a local run possible at all.
    expect(problem?.examples).toEqual([
      { input: ['"abcabcbb"'], output: "3", explanation: 'The answer is "abc", with the length of 3.' },
      { input: ['"bbbbb"'], output: "1", explanation: "" },
    ]);
  });

  it("reads acceptance out of the stats string when the node has no acRate", () => {
    expect(problem?.acceptanceRate).toBeCloseTo(36.8);
  });

  it("keeps the related problems as references", () => {
    expect(problem?.references).toEqual([{
      slug: "longest-repeating-character-replacement",
      title: "Longest Repeating Character Replacement",
      difficulty: "medium",
      relation: "similar",
      paidOnly: false,
    }]);
  });

  it("says a null status means untouched, not unknown", () => {
    expect(problem?.status).toBe("todo");
    expect(normalizeProblem({ ...NODE, status: "ac" }, "global")?.status).toBe("solved");
    expect(normalizeProblem({ ...NODE, status: "notac" }, "global")?.status).toBe("attempted");
  });

  it("returns null rather than a half-built problem when identity is missing", () => {
    expect(normalizeProblem({ titleSlug: "x" }, "global")).toBeNull();
    expect(normalizeProblem(null, "global")).toBeNull();
  });

  it("handles the CN shapes: a translated statement and JSON-string relations", () => {
    const cn = normalizeProblem({
      ...NODE,
      translatedTitle: "无重复字符的最长子串",
      translatedContent: "<p>给定一个字符串。</p>",
      similarQuestionList: undefined,
      similarQuestions: '[{"title":"Longest Repeating","titleSlug":"longest-repeating","difficulty":"Medium","isPaidOnly":false}]',
    }, "cn");
    expect(cn?.title).toBe("无重复字符的最长子串");
    expect(cn?.statement).toBe("给定一个字符串。");
    expect(cn?.references[0]?.slug).toBe("longest-repeating");
    expect(cn?.url).toBe("https://leetcode.cn/problems/longest-substring-without-repeating-characters/");
  });

  it("marks a design problem as class-based instead of inventing a signature", () => {
    const design = normalizeProblem({ ...NODE, metaData: '{"classname": "LRUCache", "constructor": {}, "methods": []}' }, "global");
    expect(design?.signature).toEqual({ name: "LRUCache", params: [], returnType: "void", classBased: true });
  });
});

describe("casesForProblem", () => {
  it("builds one runnable case per published example", () => {
    const cases = casesForProblem(normalizeProblem(NODE, "global")!);
    expect(cases).toEqual([
      { name: "Example 1", input: ['"abcabcbb"'], expected: "3", origin: "statement" },
      { name: "Example 2", input: ['"bbbbb"'], expected: "1", origin: "statement" },
    ]);
  });

  it("prefers the source's own serialisation of an input where it has one", () => {
    // `exampleTestcaseList` is exactly what the judge accepts back, so where it
    // agrees with an example the case can be replayed both locally and remotely.
    const cases = casesForProblem(normalizeProblem({ ...NODE, exampleTestcaseList: ['"abcabcbb"', '"bbbbb"'] }, "global")!);
    expect(cases[0]?.input).toEqual(['"abcabcbb"']);
  });

  it("returns nothing when there is no expected answer to assert", () => {
    expect(casesForProblem(normalizeProblem({ ...NODE, content: "<p>No examples here.</p>" }, "global")!)).toEqual([]);
  });
});

describe("normalizeProblemSummary", () => {
  it("keeps a search hit small but tagged", () => {
    expect(normalizeProblemSummary({
      questionFrontendId: "1",
      title: "Two Sum",
      titleSlug: "two-sum",
      difficulty: "Easy",
      isPaidOnly: false,
      acRate: 55.4,
      status: "ac",
      topicTags: [{ slug: "array" }, { slug: "hash-table" }],
    })).toEqual({
      source: "leetcode",
      slug: "two-sum",
      displayId: "1",
      title: "Two Sum",
      difficulty: "easy",
      paidOnly: false,
      acceptanceRate: 55.4,
      topicTags: ["array", "hash-table"],
      concepts: ["arrays", "hash-maps"],
      status: "solved",
    });
  });
});
