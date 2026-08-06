import { describe, expect, it, vi } from "vitest";
import { judgeCaseBlock } from "./judgeCases.js";

const CASES = [
  { name: "Example 1", input: ["[7,1,5,3,6,4]"], expected: "5" },
  { name: "Example 2", input: ["[7,6,4,3,1]"], expected: "0" },
];

describe("the cases a remote run is posted with", () => {
  it("sends the challenge's own cases, one argument per line", () => {
    const fromSource = vi.fn();
    return expect(judgeCaseBlock({ slug: "best-time-to-buy-and-sell-stock", cases: CASES }, fromSource))
      .resolves.toBe("[7,1,5,3,6,4]\n[7,6,4,3,1]")
      .then(() => expect(fromSource).not.toHaveBeenCalled());
  });

  it("reads them from the source for a challenge that predates carrying them", async () => {
    /* A challenge mounted before its cases travelled on it. Every one of those
       posted an empty case block, which LeetCode answers by running nothing and
       calling it Accepted — a pass nobody earned, over cases nobody ran. */
    const block = await judgeCaseBlock({ slug: "two-sum", cases: [] }, async () => "[2,7,11,15]\n9");

    expect(block).toBe("[2,7,11,15]\n9");
  });

  it("answers empty rather than posting a run with nothing in it", async () => {
    // The caller refuses on empty. Sending nothing is the one thing that must not happen.
    await expect(judgeCaseBlock({ slug: "two-sum", cases: [] }, async () => "   ")).resolves.toBe("");
    await expect(judgeCaseBlock({ slug: "two-sum", cases: [] }, async () => { throw new Error("LeetCode is down"); })).resolves.toBe("");
  });
});
