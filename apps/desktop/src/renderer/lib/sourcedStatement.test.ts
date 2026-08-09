import { describe, expect, it } from "vitest";
import type { ChallengeSource } from "@spar/domain";
import { presentSourcedStatement } from "./sourcedStatement";

function source(over: Partial<ChallengeSource> = {}): ChallengeSource {
  return {
    source: "leetcode", region: "global", slug: "roman-to-integer", externalId: "13", displayId: "13",
    url: "https://leetcode.com/problems/roman-to-integer/", difficulty: "easy", languageSlug: "cpp",
    remoteJudge: true, scratchRun: true, localCaseCount: 3, judge: "LeetCode judges this one.",
    entryName: "romanToInt", cases: [], references: [],
    ...over,
  };
}

describe("presentSourcedStatement", () => {
  it("removes the legacy LeetCode footer and recovers its hints as UI data", () => {
    const result = presentSourcedStatement(`Convert the numeral.\n\n---\n\n**LeetCode 13 · Easy** — [open on LeetCode](https://leetcode.com/problems/roman-to-integer/)\n\nLeetCode judges this one.\n\n<details><summary>1 hint from LeetCode</summary>\n\n1. Work from back to front with a map.\n\n</details>`, source());
    expect(result.statement).toBe("Convert the numeral.");
    expect(result.hints).toEqual(["Work from back to front with a map."]);
    expect(result.statement).not.toContain("<details>");
  });

  it("repairs a persisted Codeforces header and triple-dollar math", () => {
    const result = presentSourcedStatement(`F. Spectral Components\n\ntime limit per test\n\n3 seconds\n\nmemory limit per test\n\n256 megabytes\n\ninput\n\nstandard input\n\noutput\n\nstandard output\n\nA tree has $$$n$$$ vertices, $$$m_c \\gt 0$$$, and $$$1 \\le k_c \\le m_c$$$.\n\nExample`, source({ source: "codeforces", slug: "2252/F", externalId: "2252/F", displayId: "2252/F", url: "https://codeforces.com/problemset/problem/2252/F", scratchRun: false }));
    expect(result.statement).toBe("A tree has `n` vertices, `m_c > 0`, and `1 ≤ k_c ≤ m_c`.");
  });

  it("uses newly structured hints without modifying clean provider prose", () => {
    expect(presentSourcedStatement("Clean statement.", source({ hints: ["First hint"] }))).toEqual({ statement: "Clean statement.", hints: ["First hint"] });
  });
});
