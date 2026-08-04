import { describe, expect, it } from "vitest";
import { MAX_PAYLOAD, splitActionTitle, toolPayload } from "./toolPayload.js";

describe("the agent's title for a step", () => {
  /* The compiler is handed a create_question input verbatim and rejects a key it
     never declared, so the caption must not travel with the call it describes. */
  it("never leaves the caption in the arguments the host receives", () => {
    const { actionTitle, arguments: args } = splitActionTitle({
      actionTitle: "Aiming the first target at hashing",
      title: "Count distinct values",
      language: "javascript",
    });
    expect(actionTitle).toBe("Aiming the first target at hashing");
    expect(args).toEqual({ title: "Count distinct values", language: "javascript" });
    expect(args).not.toHaveProperty("actionTitle");
  });

  it("normalises what it will render, since this becomes a transcript row", () => {
    expect(splitActionTitle({ actionTitle: "  Checking\n  your arrays evidence.  " }).actionTitle)
      .toBe("Checking your arrays evidence");
    expect(splitActionTitle({ actionTitle: "x".repeat(200) }).actionTitle).toHaveLength(70);
  });

  it("leaves a call with no title untouched", () => {
    expect(splitActionTitle({ query: "arrays" })).toEqual({ actionTitle: "", arguments: { query: "arrays" } });
    expect(splitActionTitle(undefined)).toEqual({ actionTitle: "", arguments: undefined });
  });
});

describe("tool payloads in the transcript", () => {
  /* The whole point of the redaction. A learner scrolling back through the turn
     that built their challenge must not find its answer sitting in the panel. */
  it("never renders the reference solution, hidden tests, or planted wrong answers", () => {
    const design = {
      title: "Restore the window",
      statement: "Fix the shrink case.",
      starterFiles: { "src/window.js": "export function widest() { return 0 }" },
      referenceFiles: { "src/window.js": "export function widest() { /* THE ANSWER */ }" },
      visibleTests: { "test/window.test.js": "assert(widest([1]) === 1)" },
      hiddenTests: { "test/window.hidden.test.js": "assert(widest([]) === 0)" },
      knownIncorrectFiles: [{ "src/window.js": "off by one" }],
    };

    const rendered = toolPayload("create_question", design);

    expect(rendered).not.toContain("THE ANSWER");
    expect(rendered).not.toContain("window.hidden.test.js");
    expect(rendered).not.toContain("off by one");
    // Redacted, and visibly so — a silently-missing key reads as a bug.
    expect(rendered).toContain("withheld");
    // Everything the learner is meant to see survives, including the starter
    // they are about to edit and the tests they can already run.
    expect(rendered).toContain("Restore the window");
    expect(rendered).toContain("export function widest() { return 0 }");
    expect(rendered).toContain("assert(widest([1]) === 1)");
  });

  it("counts what it withheld so the panel says how much is missing", () => {
    const rendered = toolPayload("create_question", { hiddenTests: { a: "1", b: "2" }, referenceFiles: { only: "1" } });
    expect(rendered).toContain("2 entries");
    expect(rendered).toContain("1 entry");
  });

  it("shows an ordinary tool's arguments and results in full", () => {
    const rendered = toolPayload("web_search", { query: "google interview loops", limit: 5 });
    expect(rendered).toContain("google interview loops");
    expect(rendered).toContain("\"limit\": 5");
  });

  it("bounds a payload rather than storing an unbounded one per call", () => {
    const rendered = toolPayload("web_fetch", { text: "x".repeat(MAX_PAYLOAD * 2) });
    expect(rendered.length).toBeLessThan(MAX_PAYLOAD + 200);
    expect(rendered).toContain("truncated");
  });

  it("survives a payload that cannot be serialised instead of failing the turn", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    expect(toolPayload("read_session", circular)).toContain("could not serialise");
  });
});
