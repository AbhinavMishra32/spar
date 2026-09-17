import { describe, expect, it } from "vitest";
import { expandMentions, mentionRange, mentionSpans, mentionToken } from "./Mentions";

/**
 * The half of `@` that has nothing to do with React: what a picked reference
 * looks like in the field, and what it turns back into on the way out.
 *
 * The registry behind these is module-level and only ever grows, so these tests
 * share it deliberately — that is the same thing the running window does.
 */
describe("mention tokens", () => {
  it("puts words in the draft and the id in the message", () => {
    const picked = mentionToken("submission", "sub-1", "Submission 2 · Two Sum");

    expect(picked.token).toBe("@Submission 2 · Two Sum");
    expect(expandMentions(`why did ${picked.token} fail?`)).toBe("why did [[submission:sub-1|Submission 2 · Two Sum]] fail?");
  });

  it("strips the characters that would break the markup out of the label", () => {
    const picked = mentionToken("challenge", "q-1", "Reverse [a] list | twice\nplease");

    expect(picked.token).toBe("@Reverse a list twice please");
    expect(picked.markup).toBe("[[challenge:q-1|Reverse a list twice please]]");
  });

  it("leaves a draft with no references alone", () => {
    expect(expandMentions("no references here")).toBe("no references here");
  });

  it("expands the longest token first, so one reference cannot eat another", () => {
    const one = mentionToken("submission", "s-1", "Submission 1");
    const twelve = mentionToken("submission", "s-12", "Submission 12");

    expect(expandMentions(`${twelve.token} beat ${one.token}`))
      .toBe(`${twelve.markup} beat ${one.markup}`);
  });

  it("finds the tags to draw, and skips one that has been typed over", () => {
    const picked = mentionToken("concept", "sliding-window", "Sliding window");

    expect(mentionSpans(`see ${picked.token} again`)).toEqual([{ start: 4, end: 4 + picked.token.length }]);
    expect(mentionSpans("see @Sliding windo again")).toEqual([]);
  });

  it("does not offer to complete an `@` that is already part of a tag", () => {
    const picked = mentionToken("challenge", "q-2", "Longest Segment");
    const draft = `${picked.token} — why?`;

    expect(mentionRange(draft, draft.length)).toBeNull();
    expect(mentionRange("ask about @Long", 15)).toEqual({ start: 10, query: "Long" });
  });

  it("ignores an `@` in the middle of a word", () => {
    expect(mentionRange("mail me at me@example.com", 25)).toBeNull();
  });
});
