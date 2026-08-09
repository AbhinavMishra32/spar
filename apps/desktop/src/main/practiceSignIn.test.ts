import { describe, expect, it } from "vitest";
import { browserCandidates, isCodeforcesUrl } from "./codeforcesBrowser.js";

describe("the Codeforces sign-in browser boundary", () => {
  it("uses an explicit browser override without falling through to user browsers", () => {
    expect(browserCandidates("darwin", { SPAR_CODEFORCES_BROWSER: "/test/chrome" })).toEqual(["/test/chrome"]);
  });

  it("accepts only Codeforces pages for session inspection", () => {
    expect(isCodeforcesUrl("https://codeforces.com/enter")).toBe(true);
    expect(isCodeforcesUrl("https://mirror.codeforces.com/profile/me")).toBe(true);
    expect(isCodeforcesUrl("https://codeforces.com.evil.test/enter")).toBe(false);
  });
});
