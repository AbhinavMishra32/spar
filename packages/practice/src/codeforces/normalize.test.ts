import { describe, expect, it } from "vitest";
import { casesForCodeforcesProblem, codeforcesDifficulty, normalizeCodeforcesProblem, normalizeCodeforcesSummary, parseCodeforcesSlug } from "./normalize.js";

const WIRE = { contestId: 4, index: "A", name: "Watermelon", rating: 800, tags: ["brute force", "math"] };
const HTML = `
<div class="problem-statement">
  <div class="header"><div class="title">A. Watermelon</div>
    <div class="time-limit">time limit per test 1 second</div>
    <div class="memory-limit">memory limit per test 64 megabytes</div>
    <div class="input-file">input standard input</div><div class="output-file">output standard output</div>
  </div>
  <div><p>Given a watermelon of weight <span class="tex-span">$$$w$$$</span>, decide whether <span class="tex-span">$$$2 \\le w$$$</span>.</p></div>
  <div class="input-specification"><div class="title">Input</div><p>One integer.</p></div>
  <div class="sample-test">
    <div class="input"><div class="title">Input</div><pre><div>3</div><div>5</div><div>1 2</div></pre></div>
    <div class="output"><div class="title">Output</div><pre>YES<br /></pre></div>
  </div>
  <div class="note"><div class="title">Note</div><p>The two parts must be positive.</p></div>
</div>`;

describe("Codeforces normalization", () => {
  it("uses stable contest/index identities and rating bands", () => {
    expect(parseCodeforcesSlug("4/A")).toEqual({ contestId: 4, index: "A" });
    expect(parseCodeforcesSlug("watermelon")).toBeNull();
    expect([codeforcesDifficulty(800), codeforcesDifficulty(1500), codeforcesDifficulty(2400)]).toEqual(["easy", "medium", "hard"]);
  });

  it("normalizes problemset metadata into searchable summaries", () => {
    expect(normalizeCodeforcesSummary(WIRE)).toMatchObject({ source: "codeforces", slug: "4/A", displayId: "4/A", title: "Watermelon", difficulty: "easy", paidOnly: false });
  });

  it("extracts the statement and complete stdin/stdout examples", () => {
    const problem = normalizeCodeforcesProblem(WIRE, HTML, "todo");
    expect(problem).not.toBeNull();
    expect(problem?.statement).toContain("Given a watermelon");
    expect(problem?.statement).toContain("`w`");
    expect(problem?.statement).toContain("`2 ≤ w`");
    expect(problem?.statement).toContain("**Input**");
    expect(problem?.statement).toContain("**Note**");
    expect(problem?.statement).not.toContain("$$$");
    expect(problem?.statement).not.toContain("time limit per test");
    expect(problem?.examples).toEqual([{ input: ["3\n5\n1 2"], output: "YES", explanation: "" }]);
    expect(casesForCodeforcesProblem(problem!)).toEqual([{ name: "Example 1", input: ["3\n5\n1 2"], expected: "YES", origin: "source" }]);
    expect(problem?.languages.map((entry) => entry.language)).toEqual(["javascript", "typescript", "cpp"]);
  });
});
