import { describe, expect, it } from "vitest";
import { requestsChallengeRevision } from "./agentIntent.js";

describe("challenge revision intent", () => {
  it.each(["this is too difficult", "this is too dificult", "change it then", "make the question easier", "give me an easier challenge"])("routes %s to revision", (message) => {
    expect(requestsChallengeRevision(message, [])).toBe(true);
  });

  it("resolves a terse confirmation against recent learner context", () => {
    expect(requestsChallengeRevision("do it", [
      { role: "learner", body: "change it then" },
      { role: "agent", body: "I cannot launch a new one yet." },
    ])).toBe(true);
  });

  it("does not turn unrelated confirmations into challenge mutations", () => {
    expect(requestsChallengeRevision("do it", [{ role: "learner", body: "explain the last test" }])).toBe(false);
  });
});
