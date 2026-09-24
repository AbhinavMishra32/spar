import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { challengeItemRating, INITIAL_DEVIATION, type ChallengeSource, type ConceptSummary, type ConceptTag, type RatingPoint } from "@spar/domain";
import { sparRating } from "@/lib/ratingScale";
import { ChallengeCalibration } from "./ChallengeCalibration";
import type { ConceptContext } from "../concepts/ConceptChip";

const tag = (slug: string, title: string, role: ConceptTag["role"]): ConceptTag => ({
  slug, title, kind: "dsa", parentSlug: "hash-maps", parentTitle: "Hash maps & sets", role,
});

const summary = (slug: string, counts: Partial<ConceptSummary>): ConceptSummary => ({
  id: slug, slug, title: slug, kind: "dsa", description: "", parentSlug: "hash-maps", parentTitle: "Hash maps & sets",
  childSlugs: [], challengeCount: 0, passedCount: 0, failedCount: 0, abandonedCount: 0, openCount: 0,
  attemptCount: 0, testRunCount: 0, replacedCount: 0, abilityCount: 0, firstSeenAt: "", lastSeenAt: "",
  ...counts,
});

const context = (summaries: ConceptSummary[] = []): ConceptContext => ({
  challenges: [],
  summaries: new Map(summaries.map((entry) => [entry.slug, entry])),
  onOpen: () => {},
});

const rating = (overrides: Partial<RatingPoint> = {}): RatingPoint => ({
  id: "r1", rating: 1500, deviation: 80, volatility: 0.06, provisional: false,
  reason: "", occurredAt: "2026-01-01T00:00:00.000Z", ...overrides,
});

const codeforces = { source: "codeforces", difficulty: "medium", sourceRating: 1737 } as unknown as ChallengeSource;

describe("what the problem is worth", () => {
  it("leads with the figure Spar rates the problem at", () => {
    const markup = renderToStaticMarkup(
      <ChallengeCalibration conceptContext={context()} concepts={[]} difficulty="developing" source={null} />,
    );

    expect(markup).toContain(String(sparRating(challengeItemRating({ difficulty: "developing", source: null }).rating)));
    expect(markup).toContain("Spar rating");
  });

  it("names the public scales without a maths symbol in front of a brand", () => {
    const markup = renderToStaticMarkup(
      <ChallengeCalibration conceptContext={context()} concepts={[]} difficulty="developing" source={null} />,
    );

    expect(markup).toContain("LeetCode");
    expect(markup).toContain("Codeforces");
    expect(markup).not.toContain("≈");
  });

  it("quotes the same rating the attempt will be scored against", () => {
    const markup = renderToStaticMarkup(
      <ChallengeCalibration conceptContext={context()} concepts={[]} difficulty="proficient" source={codeforces} />,
    );

    expect(markup).toContain(String(sparRating(1737)));
  });

  it("says a published rating and a banded guess are different kinds of fact", () => {
    const published = renderToStaticMarkup(
      <ChallengeCalibration conceptContext={context()} concepts={[]} difficulty="proficient" source={codeforces} />,
    );
    const generated = renderToStaticMarkup(
      <ChallengeCalibration conceptContext={context()} concepts={[]} difficulty="developing" source={null} />,
    );

    expect(published).toContain("published rating");
    expect(generated).toContain("written by Spar");
  });
});

describe("the problem pitched against the learner", () => {
  it("says nothing about a learner Spar has never rated", () => {
    /* A rating still at the initial deviation is the system saying it knows
       nothing, so the seeded 1500 must not be drawn as if it were a standing. */
    const markup = renderToStaticMarkup(
      <ChallengeCalibration
        conceptContext={context()}
        concepts={[]}
        difficulty="developing"
        learnerRating={rating({ deviation: INITIAL_DEVIATION })}
        source={null}
      />,
    );

    expect(markup).not.toContain("at your rating");
    expect(markup).not.toContain("You");
  });

  it("quotes a chance once there is a rating to quote it from", () => {
    const markup = renderToStaticMarkup(
      <ChallengeCalibration
        conceptContext={context()}
        concepts={[]}
        difficulty="developing"
        learnerRating={rating({ rating: 1600 })}
        source={null}
      />,
    );

    expect(markup).toMatch(/about \d in 10 at your rating/);
  });

  it("reads a problem below the learner as the comfortable one", () => {
    const easier = renderToStaticMarkup(
      <ChallengeCalibration conceptContext={context()} concepts={[]} difficulty="foundation" learnerRating={rating({ rating: 1700 })} source={null} />,
    );
    const harder = renderToStaticMarkup(
      <ChallengeCalibration conceptContext={context()} concepts={[]} difficulty="advanced" learnerRating={rating({ rating: 1000 })} source={null} />,
    );

    expect(easier).toContain("--success");
    expect(harder).toContain("--warning");
  });
});

describe("what the problem trains", () => {
  const primary = tag("frequency-counting", "Frequency counting", "primary");
  const supporting = tag("key-design", "Key design", "supporting");

  it("puts what the challenge is aimed at above what it merely leans on", () => {
    const markup = renderToStaticMarkup(
      <ChallengeCalibration
        conceptContext={context([summary("frequency-counting", {}), summary("key-design", {})])}
        concepts={[supporting, primary]}
        difficulty="developing"
        source={null}
      />,
    );

    expect(markup.indexOf("Frequency counting")).toBeLessThan(markup.indexOf("Key design"));
  });

  it("shows the record under a concept the learner has evidence on", () => {
    const markup = renderToStaticMarkup(
      <ChallengeCalibration
        conceptContext={context([summary("frequency-counting", { challengeCount: 4, passedCount: 3, failedCount: 1 })])}
        concepts={[primary]}
        difficulty="developing"
        source={null}
      />,
    );

    expect(markup).toContain("3/4 solved");
  });

  it("treats an untested concept as untested rather than as a weakness", () => {
    const markup = renderToStaticMarkup(
      <ChallengeCalibration conceptContext={context()} concepts={[primary]} difficulty="developing" source={null} />,
    );

    expect(markup).toContain("Nothing recorded here yet");
  });
});
