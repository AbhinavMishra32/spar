import { describe, expect, it } from "vitest";
import { interleaveProviderResults } from "./practice.js";

describe("the shared problem catalogue", () => {
  it("does not let a full page from the first registered provider hide the others", () => {
    expect(interleaveProviderResults([
      ["leetcode-1", "leetcode-2", "leetcode-3"],
      ["codeforces-1", "codeforces-2"],
    ])).toEqual(["leetcode-1", "codeforces-1", "leetcode-2", "codeforces-2", "leetcode-3"]);
  });
});
