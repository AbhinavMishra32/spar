import { describe, expect, it } from "vitest";
import { readPublishedChallenge } from "./publishedChallenge";
import type { ToolPart } from "./agentRun";

function row(overrides: Partial<ToolPart>): ToolPart {
  return {
    kind: "tool",
    id: "call",
    tool: "create_question",
    label: "",
    actionTitle: "",
    detail: "status playable",
    phase: "done",
    files: [],
    input: "",
    output: "",
    stages: [],
    startedAt: 0,
    ...overrides,
  };
}

/** A design as `toolPayload` formats one: pretty-printed, two-space indent, with
 *  the answer keys already replaced by their withheld notice. */
function design(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    concepts: [
      { slug: "sliding-window", title: "Sliding window", role: "supporting" },
      { slug: "window-invariant-restoration", title: "Window invariant restoration", role: "primary" },
    ],
    title: "Typed Record Partitioning",
    language: "typescript",
    kind: "function",
    difficulty: "developing",
    statement: "Partition the records.",
    starterFiles: { "src/partition.ts": "export function partition() {}" },
    referenceFiles: "⟨withheld — 1 entry; showing this would give away the challenge⟩",
    ...extra,
  }, null, 2);
}

function result(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ status: "playable", question: { id: "q1", ordinal: 4 }, report: { valid: true, caseCounts: { visible: 5, hidden: 31 } }, ...extra }, null, 2);
}

describe("reading a published challenge off its transcript row", () => {
  it("takes the title, language, band, tags and case count from the row", () => {
    const published = readPublishedChallenge(row({ label: "Typed Record Partitioning", input: design(), output: result() }));
    expect(published.title).toBe("Typed Record Partitioning");
    expect(published.language).toBe("typescript");
    expect(published.difficulty).toBe("developing");
    expect(published.cases).toBe(36);
    expect(published.replaced).toBe(false);
    expect(published.ordinal).toBe(4);
  });

  /* The preview is built from the starter file, so a row that carries one has to
     yield it whole — path included, since the plate names the file. */
  it("takes the first starter file the design shipped", () => {
    const published = readPublishedChallenge(row({ input: design(), output: result() }));
    expect(published.starter).toEqual({ path: "src/partition.ts", code: "export function partition() {}" });
  });

  it("has no starter file when the row never carried one", () => {
    expect(readPublishedChallenge(row({ input: design({ starterFiles: {} }), output: result() })).starter).toBeNull();
    expect(readPublishedChallenge(row({ input: "", output: result() })).starter).toBeNull();
  });

  /* Most specific first is the agent's instruction and the primary is what the
     challenge is actually aimed at, so the primary leads whatever order the tags
     happened to be written in. The card has room for two. */
  it("puts the primary concept first", () => {
    expect(readPublishedChallenge(row({ input: design(), output: result() })).concepts)
      .toEqual(["Window invariant restoration", "Sliding window"]);
  });

  /**
   * The design carries the starter files and the whole visible suite, so a large
   * one is cut at the payload cap and arrives without its closing brace. The card
   * still has to draw: a clipped row that fell back to nothing would show a bare
   * title next to a challenge whose language and band are on screen beside it.
   */
  it("still reads the scalar fields out of a payload that was cut short", () => {
    const clipped = `${design().slice(0, 420)}\n… truncated (2100 more characters)`;
    expect(() => JSON.parse(clipped)).toThrow();
    const published = readPublishedChallenge(row({ label: "Typed Record Partitioning", input: clipped, output: result() }));
    expect(published.title).toBe("Typed Record Partitioning");
    expect(published.language).toBe("typescript");
    expect(published.difficulty).toBe("developing");
  });

  /* A nested key with the same name must not be mistaken for the top-level one.
     Only a two-space indent is a top-level key in this payload. */
  it("does not read a nested key as a top-level one", () => {
    const clipped = `{\n  "starterFiles": {\n    "language": "python"\n  },\n  "difficulty": "advanced"`;
    const published = readPublishedChallenge(row({ input: clipped, output: "" }));
    expect(published.language).toBeNull();
    expect(published.difficulty).toBe("advanced");
  });

  it("marks a replacement as one, whichever tool published it", () => {
    expect(readPublishedChallenge(row({ tool: "replace_current_question", input: design(), output: result() })).replaced).toBe(true);
    const replacement = readPublishedChallenge(row({ tool: "assign_practice_problem", output: result({ replacedQuestionId: "q0" }) }));
    expect(replacement.replaced).toBe(true);
    expect(replacement.replacedQuestionId).toBe("q0");
  });

  /* Spar's four bands and a judge's three are claims by different graders. A
     mounted problem reports the source's band and no case count, because Spar
     never compiled it and has no number of its own to give. */
  it("reports a sourced problem by its source rather than by Spar's grading", () => {
    const published = readPublishedChallenge(row({
      tool: "assign_practice_problem",
      input: JSON.stringify({ source: "codeforces", slug: "4-A", concepts: [{ slug: "parity", role: "primary" }] }, null, 2),
      output: JSON.stringify({ status: "playable", source: { slug: "4-A", displayId: "4/A", difficulty: "easy" }, judge: "Codeforces" }, null, 2),
    }));
    expect(published.source).toBe("codeforces");
    expect(published.displayId).toBe("4/A");
    expect(published.band).toBe("easy");
    expect(published.difficulty).toBeNull();
    expect(published.cases).toBeNull();
    // No title in the arguments — the source owns it — so the slug stands in.
    expect(published.title).toBe("4-A");
  });

  it("names a sourced problem by its title, not its slug", () => {
    const titled = readPublishedChallenge(row({
      tool: "assign_practice_problem",
      input: JSON.stringify({ source: "leetcode", slug: "univalued-binary-tree" }),
      output: JSON.stringify({ status: "playable", source: { slug: "univalued-binary-tree", title: "Univalued Binary Tree", difficulty: "easy" } }),
    }));
    expect(titled.title).toBe("Univalued Binary Tree");
    // Filed before the result carried a title: a LeetCode slug is words, so it reads as one.
    const older = readPublishedChallenge(row({
      tool: "assign_practice_problem",
      input: JSON.stringify({ source: "leetcode", slug: "univalued-binary-tree" }),
      output: JSON.stringify({ status: "playable", source: { slug: "univalued-binary-tree", difficulty: "easy" } }),
    }));
    expect(older.title).toBe("Univalued Binary Tree");
  });
});
