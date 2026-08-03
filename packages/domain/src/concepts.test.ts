import { describe, expect, it } from "vitest";
import { CONCEPT_AREAS, CONCEPT_TAXONOMY, conceptSlug, conceptStanding, conceptStrength, conceptTitleFromSlug, seededConcept } from "./concepts.js";

describe("concept slugs", () => {
  it("collapses the ways a provider might write the same concept", () => {
    for (const written of ["Sliding Window", "sliding_window", "  sliding window  ", "Sliding-Window"]) {
      expect(conceptSlug(written)).toBe("sliding-window");
    }
  });

  it("titles a concept the agent named only by its slug", () => {
    expect(conceptTitleFromSlug("window-invariant-restoration")).toBe("Window invariant restoration");
    expect(conceptTitleFromSlug("")).toBe("Concept");
  });

  it("finds a seeded concept however the slug was written", () => {
    expect(seededConcept("Two Pointers")?.parentSlug).toBe("arrays");
    expect(seededConcept("nothing-like-this")).toBeUndefined();
  });
});

describe("the taxonomy", () => {
  it("has unique slugs", () => {
    const slugs = CONCEPT_TAXONOMY.map((seed) => seed.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("keeps every slug in its own normalized form, so a lookup cannot miss a seed", () => {
    for (const seed of CONCEPT_TAXONOMY) expect(conceptSlug(seed.slug)).toBe(seed.slug);
  });

  it("only parents onto an area, so the tree stays two levels deep", () => {
    const areas = new Set(CONCEPT_AREAS.map((seed) => seed.slug));
    for (const seed of CONCEPT_TAXONOMY) {
      if (!seed.parentSlug) continue;
      expect(areas.has(seed.parentSlug)).toBe(true);
    }
  });

  it("gives every area sub-concepts, because an area alone is not a finding", () => {
    for (const area of CONCEPT_AREAS) {
      expect(CONCEPT_TAXONOMY.filter((seed) => seed.parentSlug === area.slug).length).toBeGreaterThan(1);
    }
  });
});

describe("concept strength", () => {
  it("is null with nothing graded, so an untested concept never reads as a weak one", () => {
    expect(conceptStrength({ passedCount: 0, failedCount: 0, abandonedCount: 0 })).toBeNull();
    expect(conceptStanding(null)).toBe("untested");
  });

  it("treats one pass as encouraging rather than conclusive", () => {
    const one = conceptStrength({ passedCount: 1, failedCount: 0, abandonedCount: 0 })!;
    const four = conceptStrength({ passedCount: 4, failedCount: 0, abandonedCount: 0 })!;
    expect(one).toBeCloseTo(0.75);
    expect(four).toBeGreaterThan(one);
    expect(four).toBeLessThan(1);
  });

  it("counts walking away with the failures", () => {
    const failed = conceptStrength({ passedCount: 1, failedCount: 1, abandonedCount: 0 });
    const abandoned = conceptStrength({ passedCount: 1, failedCount: 0, abandonedCount: 1 });
    expect(abandoned).toBe(failed);
  });

  it("bands a mostly-failing concept as shaky and a mostly-passing one as strong", () => {
    expect(conceptStanding(conceptStrength({ passedCount: 0, failedCount: 3, abandonedCount: 0 }))).toBe("shaky");
    expect(conceptStanding(conceptStrength({ passedCount: 6, failedCount: 0, abandonedCount: 0 }))).toBe("strong");
  });
});
