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

  it.each([
    "just give me lc problem i dont care",
    "give me a real leetcode problem",
    "give me a codeforces problem",
    "show me another cf problem",
    "can i have another question",
    "i want an actual problem not this",
    "swap this challenge",
    "skip this",
  ])("routes %s to revision", (message) => {
    // Asking for a different *kind* of challenge is a revision request too. These
    // used to route to ordinary chat, so nothing made the turn swap anything and
    // the agent answered by searching the source over and over.
    expect(requestsChallengeRevision(message, [])).toBe(true);
  });

  it.each([
    "give me a hint on this question",
    "is this a leetcode problem?",
    "explain the failing case in this challenge",
    "what does this question want me to return",
  ])("leaves %s as conversation", (message) => {
    expect(requestsChallengeRevision(message, [])).toBe(false);
  });

  it("does not turn unrelated confirmations into challenge mutations", () => {
    expect(requestsChallengeRevision("do it", [{ role: "learner", body: "explain the last test" }])).toBe(false);
  });
});
