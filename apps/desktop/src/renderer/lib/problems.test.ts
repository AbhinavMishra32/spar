import { describe, expect, it } from "vitest";
import type { ChallengeHistorySummary, ChallengeSource } from "@spar/domain";
import type { PracticeSearchHit } from "../../shared/api";
import { filterProblems, mergeProblems, originCounts, sortProblems, type ProblemFilter } from "./problems";

function source(over: Partial<ChallengeSource> & { slug: string }): ChallengeSource {
  return {
    source: "codeforces",
    region: "global",
    externalId: "x",
    displayId: over.slug,
    url: `https://codeforces.com/problemset/problem/${over.slug}`,
    difficulty: "medium",
    languageSlug: "cpp",
    remoteJudge: true,
    scratchRun: false,
    localCaseCount: 2,
    judge: "Codeforces judges this one.",
    entryName: "",
    cases: [],
    references: [],
    ...over,
  };
}

function challenge(over: Partial<ChallengeHistorySummary> & { id: string; title: string }): ChallengeHistorySummary {
  return {
    sessionId: "s-1",
    sessionTitle: "A session",
    ordinal: 1,
    language: "typescript",
    difficulty: "developing",
    status: "completed",
    replacesQuestionId: null,
    replacesQuestionTitle: null,
    replacedByQuestionId: null,
    replacedByQuestionTitle: null,
    attemptCount: 1,
    testRunCount: 1,
    lastOutcome: "passed",
    concepts: [],
    source: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function hit(over: Partial<PracticeSearchHit> & { slug: string; title: string }): PracticeSearchHit {
  return {
    source: "codeforces",
    sourceName: "Codeforces",
    displayId: over.slug,
    difficulty: "medium",
    paidOnly: false,
    acceptanceRate: null,
    concepts: [],
    status: "todo",
    ...over,
  };
}

const ALL: ProblemFilter = { query: "", origin: "all", band: "all", standing: "all" };

describe("mergeProblems", () => {
  it("puts history before remote hits", () => {
    const merged = mergeProblems(
      [challenge({ id: "c-1", title: "Written by Spar" })],
      [hit({ slug: "4/A", title: "Watermelon" })],
    );
    expect(merged.map((item) => item.kind)).toEqual(["challenge", "source"]);
  });

  it("drops the remote hit for a problem already in history", () => {
    const merged = mergeProblems(
      [challenge({ id: "c-1", title: "Watermelon", source: source({ slug: "4/A" }) })],
      [hit({ slug: "4/A", title: "Watermelon" }), hit({ slug: "71/A", title: "Way Too Long Words" })],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]!.kind).toBe("challenge");
    expect(merged[1]!.title).toBe("Way Too Long Words");
  });

  it("keeps the most recent attempt when the same problem was practised twice", () => {
    const merged = mergeProblems(
      [
        challenge({ id: "old", title: "Watermelon", source: source({ slug: "4/A" }), updatedAt: "2026-01-01T00:00:00.000Z", lastOutcome: "failed" }),
        challenge({ id: "new", title: "Watermelon", source: source({ slug: "4/A" }), updatedAt: "2026-08-01T00:00:00.000Z", lastOutcome: "passed" }),
      ],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.kind === "challenge" && merged[0]!.challenge.id).toBe("new");
  });

  it("bands a sourced challenge by the source rather than by Spar's own grade", () => {
    const [item] = mergeProblems(
      [challenge({ id: "c-1", title: "Watermelon", difficulty: "advanced", source: source({ slug: "4/A", difficulty: "easy" }) })],
      [],
    );
    expect(item!.band).toBe("easy");
    expect(item!.origin).toBe("codeforces");
  });

  it("folds Spar's four bands onto the three every source uses", () => {
    const bands = (["foundation", "developing", "proficient", "advanced"] as const).map(
      (difficulty) => mergeProblems([challenge({ id: difficulty, title: difficulty, difficulty })], [])[0]!.band,
    );
    expect(bands).toEqual(["easy", "medium", "medium", "hard"]);
  });
});

describe("standing", () => {
  it("reads only a pass as solved", () => {
    const items = mergeProblems(
      [
        challenge({ id: "a", title: "Passed", lastOutcome: "passed" }),
        challenge({ id: "b", title: "Failed", lastOutcome: "failed" }),
        challenge({ id: "c", title: "Untouched", lastOutcome: null, attemptCount: 0, testRunCount: 0 }),
      ],
      [],
    );
    expect(items.map((item) => item.standing).sort()).toEqual(["attempted", "solved", "todo"]);
  });

  it("treats a source that does not know as not yet done", () => {
    const [item] = mergeProblems([], [hit({ slug: "4/A", title: "Watermelon", status: "unknown" })]);
    expect(item!.standing).toBe("todo");
  });
});

describe("filterProblems", () => {
  const items = mergeProblems(
    [challenge({ id: "c-1", title: "Balanced Brackets", lastOutcome: "failed", concepts: [{ slug: "stacks", title: "Stacks", kind: "dsa", parentSlug: null, parentTitle: null, role: "primary" }] })],
    [
      hit({ slug: "4/A", title: "Watermelon", difficulty: "easy", status: "solved" }),
      hit({ slug: "1/A", title: "Theatre Square", difficulty: "hard", source: "leetcode", sourceName: "LeetCode" }),
    ],
  );

  it("narrows by origin, band and standing", () => {
    expect(filterProblems(items, { ...ALL, origin: "spar" }).map((item) => item.title)).toEqual(["Balanced Brackets"]);
    expect(filterProblems(items, { ...ALL, band: "hard" }).map((item) => item.title)).toEqual(["Theatre Square"]);
    expect(filterProblems(items, { ...ALL, standing: "solved" }).map((item) => item.title)).toEqual(["Watermelon"]);
  });

  it("matches a query against the title and against what the problem carries", () => {
    expect(filterProblems(items, { ...ALL, query: "water" }).map((item) => item.title)).toEqual(["Watermelon"]);
    expect(filterProblems(items, { ...ALL, query: "stacks" }).map((item) => item.title)).toEqual(["Balanced Brackets"]);
    expect(filterProblems(items, { ...ALL, query: "nothing here" })).toEqual([]);
  });
});

describe("originCounts", () => {
  const items = mergeProblems(
    [challenge({ id: "c-1", title: "Balanced Brackets", difficulty: "advanced" })],
    [
      hit({ slug: "4/A", title: "Watermelon", difficulty: "easy" }),
      hit({ slug: "1/A", title: "Theatre Square", difficulty: "hard", source: "leetcode", sourceName: "LeetCode" }),
    ],
  );

  it("counts every origin under the other filters", () => {
    expect(originCounts(items, ALL)).toEqual({ all: 3, spar: 1, leetcode: 1, codeforces: 1 });
  });

  it("ignores the origin filter, so picking one does not rewrite the other counts", () => {
    expect(originCounts(items, { ...ALL, origin: "spar" })).toEqual(originCounts(items, ALL));
  });

  it("respects the filters that are not origin", () => {
    expect(originCounts(items, { ...ALL, band: "hard" })).toEqual({ all: 2, spar: 1, leetcode: 1, codeforces: 0 });
  });
});

describe("sortProblems", () => {
  const items = mergeProblems(
    [
      challenge({ id: "solved", title: "Long solved", lastOutcome: "passed", difficulty: "advanced", updatedAt: "2026-08-05T00:00:00.000Z" }),
      challenge({ id: "open", title: "Half done", lastOutcome: "failed", difficulty: "foundation", updatedAt: "2026-08-02T00:00:00.000Z" }),
    ],
    [hit({ slug: "4/A", title: "Watermelon", difficulty: "medium" })],
  );

  it("suggests unfinished work first and solved work last", () => {
    expect(sortProblems(items, "suggested").map((item) => item.title)).toEqual(["Half done", "Watermelon", "Long solved"]);
  });

  it("ranks by how well the query matched while one is being typed", () => {
    expect(sortProblems(items, "suggested", "long").map((item) => item.title)[0]).toBe("Long solved");
  });

  it("orders by band in both directions", () => {
    expect(sortProblems(items, "easiest").map((item) => item.band)).toEqual(["easy", "medium", "hard"]);
    expect(sortProblems(items, "hardest").map((item) => item.band)).toEqual(["hard", "medium", "easy"]);
  });

  it("puts what the learner touched most recently first, and never-touched last", () => {
    expect(sortProblems(items, "recent").map((item) => item.title)).toEqual(["Long solved", "Half done", "Watermelon"]);
  });

  it("leaves the input alone", () => {
    const before = items.map((item) => item.title);
    sortProblems(items, "hardest");
    expect(items.map((item) => item.title)).toEqual(before);
  });
});
