import { describe, expect, it } from "vitest";

import { thoughts } from "./thoughts";

const titles = (body: string) => thoughts(body).map((section) => section.title).filter(Boolean);

describe("thoughts", () => {
  it("splits on headings the model wrote on their own line", () => {
    const body = ["**Checking the workspace**", "main.py still has the example lines.", "", "**What is missing**", "torch is not installed."].join("\n");
    expect(titles(body)).toEqual(["Checking the workspace", "What is missing"]);
  });

  it("accepts a heading that ends in a colon", () => {
    expect(titles("**Plan:**\nInstall torch, then write the tensors.")).toEqual(["Plan:"]);
  });

  it("does not split on a phrase bolded mid-sentence", () => {
    /* The bug this replaced: a model that emphasises terms as it writes turned
       every one into a two-word heading, and the sentences they came from
       scattered underneath as separate rows. */
    const body = "TypeScript is a **typed superset of JavaScript** with a **static type checker** that runs first.";
    expect(titles(body)).toEqual([]);
    expect(thoughts(body)[0]?.body).toBe("TypeScript is a typed superset of JavaScript with a static type checker that runs first.");
  });

  it("keeps one section when there are no headings at all", () => {
    const body = "Let me re-check the workspace.\nNothing has changed since the last read.";
    const sections = thoughts(body);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBeUndefined();
    expect(sections[0]?.body).toContain("Let me re-check");
  });

  it("keeps the prose that came before the first heading", () => {
    const body = ["Some opening thought.", "**Then a heading**", "and its body."].join("\n");
    const sections = thoughts(body);
    expect(sections[0]).toMatchObject({ body: "Some opening thought." });
    expect(sections[1]).toMatchObject({ title: "Then a heading", body: "and its body." });
  });

  it("allows a heading inside a list item", () => {
    expect(titles("- **First step**\n  do the thing")).toEqual(["First step"]);
  });

  it("does not split when the bold leads a line but the sentence continues", () => {
    /* "**Types are erased**: the compiler strips…" reads as a sentence, not a
       section — the colon rule only accepts a colon with nothing after it. */
    expect(titles("**Types are erased**: the compiler strips annotations.")).toEqual([]);
  });

  it("strips the markup from what it shows", () => {
    expect(thoughts("A **bold** word.")[0]?.body).toBe("A bold word.");
  });

  it("returns nothing for empty reasoning", () => {
    expect(thoughts("")).toEqual([]);
    expect(thoughts("   \n  ")).toEqual([]);
  });
});
