import { describe, expect, it } from "vitest";
import type { ChallengeHistorySummary, ConceptSummary, SessionSummary } from "@spar/domain";
import { matchRank, searchEverything } from "./search";

function session(over: Partial<SessionSummary> & { id: string; title: string }): SessionSummary {
  return {
    originalGoal: "",
    objective: "",
    context: "training",
    status: "active",
    currentFocus: [],
    completedQuestions: 0,
    activeQuestion: null,
    questionTitles: [],
    totalSeconds: 0,
    updatedAt: "2026-08-01T00:00:00.000Z",
    pinnedAt: null,
    archivedAt: null,
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

function concept(over: Partial<ConceptSummary> & { slug: string; title: string }): ConceptSummary {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    kind: "dsa",
    description: "",
    parentSlug: null,
    parentTitle: null,
    childSlugs: [],
    challengeCount: 0,
    passedCount: 0,
    failedCount: 0,
    abandonedCount: 0,
    openCount: 0,
    attemptCount: 0,
    testRunCount: 0,
    replacedCount: 0,
    abilityCount: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    ...over,
  };
}

const EMPTY = { sessions: [], challenges: [], concepts: [] };

describe("matchRank", () => {
  it("ranks a title match above one that needed the rest of the entry", () => {
    const title = matchRank("two sum", "Two Sum", "arrays hashing");
    const meta = matchRank("two sum", "Pair lookup", "two sum leetcode 1");
    expect(title).not.toBeNull();
    expect(meta).not.toBeNull();
    expect(title!).toBeLessThan(meta!);
  });

  it("ranks the start of a word above the middle of one", () => {
    expect(matchRank("sum", "Sum of pairs", "")!).toBeLessThan(matchRank("sum", "Checksum repair", "")!);
  });

  it("requires every word of the query to land somewhere", () => {
    expect(matchRank("two sum", "Two Sum", "arrays")).not.toBeNull();
    expect(matchRank("two sum python", "Two Sum", "arrays typescript")).toBeNull();
  });

  /* Titles carry brackets, plus signs and dots. A needle built into a regex would
     either throw on them or quietly match the wrong thing. */
  it("treats punctuation in the query as text", () => {
    expect(matchRank("o(n)", "Rewrite as O(n)", "")).not.toBeNull();
    expect(matchRank("c++", "Ranges in C++", "")).not.toBeNull();
    expect(matchRank(".*", "Two Sum", "")).toBeNull();
  });

  it("matches an empty query against everything", () => {
    expect(matchRank("", "Anything")).toBe(0);
    expect(matchRank("   ", "Anything")).toBe(0);
  });
});

describe("searchEverything", () => {
  it("offers recents and the nav with nothing typed, and no concepts", () => {
    const groups = searchEverything("", {
      ...EMPTY,
      sessions: [session({ id: "a", title: "Sliding windows" })],
      concepts: [concept({ slug: "arrays", title: "Arrays" })],
    });
    expect(groups.map((group) => group.key)).toEqual(["action", "session", "place"]);
    expect(groups.find((group) => group.key === "place")!.hits).toHaveLength(5);
  });

  it("puts the most recently touched of two equal matches first", () => {
    const groups = searchEverything("window", {
      ...EMPTY,
      sessions: [
        session({ id: "old", title: "Window practice", updatedAt: "2026-07-01T00:00:00.000Z" }),
        session({ id: "new", title: "Window drills", updatedAt: "2026-08-05T00:00:00.000Z" }),
      ],
    });
    const hits = groups.find((group) => group.key === "session")!.hits;
    expect(hits.map((hit) => hit.key)).toEqual(["session:new", "session:old"]);
  });

  /* The reason ranking is not plain substring matching: the session only mentions
     two pointers in its goal, and the challenge is actually called it. */
  it("does not let a goal match outrank a title match in another group", () => {
    const groups = searchEverything("two pointers", {
      ...EMPTY,
      sessions: [session({ id: "s", title: "Interview prep", originalGoal: "get better at two pointers" })],
      challenges: [challenge({ id: "c", title: "Two pointers on a sorted array" })],
    });
    const session_ = groups.find((group) => group.key === "session")!.hits[0]!;
    const challenge_ = groups.find((group) => group.key === "challenge")!.hits[0]!;
    expect(session_.key).toBe("session:s");
    expect(challenge_.key).toBe("challenge:c");
  });

  it("finds a session by a challenge that is in it", () => {
    const groups = searchEverything("valid parentheses", {
      ...EMPTY,
      sessions: [
        session({
          id: "s",
          title: "Monday morning",
          questionTitles: [{ id: "q", title: "Valid Parentheses", status: "completed" }],
        }),
      ],
    });
    expect(groups.find((group) => group.key === "session")!.hits[0]!.key).toBe("session:s");
  });

  it("finds a source problem by its number", () => {
    const groups = searchEverything("1", {
      ...EMPTY,
      challenges: [
        challenge({
          id: "c",
          title: "Two Sum",
          source: {
            source: "leetcode",
            region: "global",
            slug: "two-sum",
            externalId: "1",
            displayId: "1",
            url: "https://leetcode.com/problems/two-sum/",
            difficulty: "easy",
            languageSlug: "typescript",
            remoteJudge: true,
            scratchRun: true,
            localCaseCount: 2,
            judge: "LeetCode grades this one.",
            entryName: "twoSum",
            cases: [],
            references: [],
          },
        }),
      ],
    });
    expect(groups.find((group) => group.key === "challenge")!.hits[0]!.key).toBe("challenge:c");
  });

  it("drops the groups that matched nothing", () => {
    const groups = searchEverything("settings", {
      ...EMPTY,
      sessions: [session({ id: "s", title: "Graphs" })],
    });
    expect(groups.map((group) => group.key)).toEqual(["place"]);
  });

  /* What Return does, since the first row drawn is the row that is selected. The
     sessions would come first at rest and matched only through their goal; the
     challenge is the one actually called Two Sum. */
  it("leads with the group holding the best match", () => {
    const groups = searchEverything("two", {
      ...EMPTY,
      sessions: [session({ id: "s", title: "Interview prep", originalGoal: "two-pointer bounds" })],
      challenges: [challenge({ id: "c", title: "Two Sum" })],
      concepts: [concept({ slug: "two-pointers", title: "Two pointers" })],
    });
    expect(groups[0]!.hits[0]!.key).toBe("challenge:c");
    expect(groups.map((group) => group.key)).toEqual(["challenge", "concept", "session"]);
  });

  it("leaves the resting panel in its declared order", () => {
    const groups = searchEverything("", {
      ...EMPTY,
      sessions: [session({ id: "s", title: "Graphs", updatedAt: "2026-08-06T00:00:00.000Z" })],
    });
    expect(groups.map((group) => group.key)).toEqual(["action", "session", "place"]);
  });

  it("returns nothing when nothing matched", () => {
    expect(searchEverything("nothing here matches", EMPTY)).toEqual([]);
  });

  it("caps each group so the panel stays a list of picks", () => {
    const groups = searchEverything("drill", {
      ...EMPTY,
      sessions: Array.from({ length: 20 }, (_unused, index) => session({ id: `s${index}`, title: `Drill ${index}` })),
    });
    expect(groups.find((group) => group.key === "session")!.hits).toHaveLength(6);
  });
});
