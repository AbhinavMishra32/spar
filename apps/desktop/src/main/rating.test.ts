import { describe, expect, it } from "vitest";
import type { ChallengeSource } from "@spar/domain";
import { challengeResult, elapsedDays } from "./rating.js";

const sourced = (over: Partial<ChallengeSource>) => ({
  source: "codeforces" as const,
  slug: "1234/A",
  title: "Two Pointers",
  url: "https://codeforces.com/problemset/problem/1234/A",
  difficulty: "medium" as const,
  languageSlug: "cpp",
  remoteJudge: true,
  scratchRun: false,
  cases: [],
  references: [],
  ...over,
} as ChallengeSource);

const finished = (over: Partial<Parameters<typeof challengeResult>[0]> = {}) => ({
  outcome: "passed",
  assisted: false,
  difficulty: "developing" as const,
  source: null,
  ...over,
});

describe("a finished challenge as one Glicko-2 result", () => {
  it("takes a rated Codeforces problem at its published rating, which is already this scale", () => {
    expect(challengeResult(finished({ source: sourced({ sourceRating: 1737 }) }))).toEqual({ rating: 1737, deviation: 50, score: 1 });
  });

  it("bands a problem the source did not rate, and says so by trusting it less", () => {
    const banded = challengeResult(finished({ source: sourced({ sourceRating: null }) }))!;
    const rated = challengeResult(finished({ source: sourced({ sourceRating: 1737 }) }))!;
    expect(banded.deviation).toBeGreaterThan(rated.deviation);
  });

  /* The regression that produced a rating of 2044 out of fourteen solves. A
     generated challenge used to be priced at the learner's own rating plus an
     offset, so the item got harder every time the rating rose and the rating
     rose every time the item was solved. Nothing about the result may depend on
     where the learner already stands. */
  it("prices a Spar-authored challenge by its own difficulty and nothing else", () => {
    const low = challengeResult(finished({ difficulty: "proficient" }))!;
    const high = challengeResult(finished({ difficulty: "proficient" }))!;
    expect(low).toEqual(high);
    expect(challengeResult(finished({ difficulty: "foundation" }))!.rating).toBeLessThan(challengeResult(finished({ difficulty: "advanced" }))!.rating);
  });

  it("scores a hinted solve between giving up and clearing it unaided", () => {
    expect(challengeResult(finished({ assisted: true }))!.score).toBe(0.5);
    expect(challengeResult(finished({ outcome: "abandoned" }))!.score).toBe(0);
  });

  it("refuses to rate a challenge the agent replaced, or one still open", () => {
    expect(challengeResult(finished({ outcome: "replaced" }))).toBeNull();
    expect(challengeResult(finished({ outcome: null }))).toBeNull();
  });
});

describe("elapsed days, for the deviation decay", () => {
  it("measures the gap between two stamps", () => {
    expect(elapsedDays("2026-01-01T00:00:00.000Z", "2026-01-15T00:00:00.000Z")).toBe(14);
  });

  /* A clock that went backwards must not sharpen a rating: negative elapsed time
     would subtract from the deviation and claim precision nobody earned. */
  it("never runs backwards", () => {
    expect(elapsedDays("2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(0);
  });
});
