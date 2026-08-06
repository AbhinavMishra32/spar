import { describe, expect, it } from "vitest";
import { conceptSlug, seededConcept } from "@spar/domain";
import { conceptsForSourceTags, conceptTagsForProblem, isMappedSourceTag, sourceTagsForConcept } from "./concepts.js";

describe("conceptsForSourceTags", () => {
  it("maps LeetCode's tags onto Spar's own vocabulary, in tag order", () => {
    expect(conceptsForSourceTags(["array", "two-pointers", "sorting"])).toEqual(["arrays", "two-pointers"]);
  });

  it("accepts tag objects as well as slugs", () => {
    expect(conceptsForSourceTags([{ slug: "hash-table" }, { slug: "sliding-window" }])).toEqual(["hash-maps", "sliding-window"]);
  });

  it("drops a tag Spar has no concept for rather than inventing one", () => {
    // The agent may extend the vocabulary because it can explain why. A table
    // cannot, and a concept nobody chose would collect evidence under a name
    // that means nothing.
    expect(conceptsForSourceTags(["brainteaser", "array"])).toEqual(["arrays"]);
    expect(isMappedSourceTag("brainteaser")).toBe(false);
  });

  it("keeps design problems out of the algorithms shelf", () => {
    // LeetCode files "Design" with the algorithms; reading it as evidence about
    // algorithms is how a cache implementation ends up counted as array practice.
    expect(conceptsForSourceTags(["design", "hash-table"])).toEqual(["state-management", "hash-maps"]);
  });

  it("only ever maps onto concepts the taxonomy actually has", () => {
    const tags = ["array", "two-pointers", "prefix-sum", "sliding-window", "hash-table", "string", "linked-list",
      "stack", "monotonic-stack", "heap-priority-queue", "tree", "binary-search-tree", "graph", "topological-sort",
      "union-find", "recursion", "backtracking", "dynamic-programming", "memoization", "binary-search", "greedy",
      "interval", "line-sweep", "bit-manipulation", "bitmask", "math", "number-theory", "design", "concurrency",
      "iterator", "matrix", "simulation", "counting", "quickselect", "merge-sort", "string-matching", "trie"];
    for (const tag of tags) {
      for (const concept of conceptsForSourceTags([tag])) {
        expect(seededConcept(concept), `${tag} maps to unknown concept ${concept}`).toBeDefined();
      }
    }
  });
});

describe("conceptTagsForProblem", () => {
  it("proposes the source's first tag as primary and the rest as supporting", () => {
    expect(conceptTagsForProblem(["sliding-window", "hash-table", "string"])).toEqual([
      { slug: "sliding-window", role: "primary" },
      { slug: "hash-maps", role: "supporting" },
      { slug: "strings", role: "supporting" },
    ]);
  });

  it("lets the caller's aim win, because the source names a topic and not a gap", () => {
    const tags = conceptTagsForProblem(["sliding-window", "hash-table"], "window-invariant-restoration");
    expect(tags[0]).toEqual({ slug: "window-invariant-restoration", role: "primary" });
    expect(tags.map((tag) => tag.slug)).toContain("sliding-window");
  });

  it("has exactly one primary", () => {
    const tags = conceptTagsForProblem(["array", "two-pointers", "sorting", "greedy", "math"], "index-arithmetic");
    expect(tags.filter((tag) => tag.role === "primary")).toHaveLength(1);
  });

  it("returns nothing for a problem with no mappable tags and no aim", () => {
    expect(conceptTagsForProblem(["brainteaser"])).toEqual([]);
  });
});

describe("sourceTagsForConcept", () => {
  it("answers directly for a concept a tag maps to", () => {
    expect(sourceTagsForConcept("dynamic-programming")).toContain("dynamic-programming");
  });

  it("walks up to the area for a sub-concept LeetCode has no tag for", () => {
    // A target on "restoring the invariant" has no tag of its own, and the
    // useful answer is sliding-window's rather than nothing.
    expect(sourceTagsForConcept("window-invariant-restoration")).toContain("sliding-window");
    expect(sourceTagsForConcept("state-definition")).toContain("dynamic-programming");
  });

  it("returns nothing for a concept the source has no vocabulary for", () => {
    // The caller has to read this as "search by keyword instead", never as
    // "no problems exist".
    expect(sourceTagsForConcept("cancellation")).toEqual([]);
  });

  it("normalises the concept it is given", () => {
    expect(sourceTagsForConcept("Dynamic Programming")).toEqual(sourceTagsForConcept(conceptSlug("dynamic-programming")));
  });
});
