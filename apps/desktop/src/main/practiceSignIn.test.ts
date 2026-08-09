import { describe, expect, it } from "vitest";
import { browserCandidates, isCloudflareCookie, isCodeforcesUrl } from "./codeforcesBrowser.js";

describe("the Codeforces sign-in browser boundary", () => {
  it("uses an explicit browser override without falling through to user browsers", () => {
    expect(browserCandidates("darwin", { SPAR_CODEFORCES_BROWSER: "/test/chrome" })).toEqual(["/test/chrome"]);
  });

  it("accepts only Codeforces pages for session inspection", () => {
    expect(isCodeforcesUrl("https://codeforces.com/enter")).toBe(true);
    expect(isCodeforcesUrl("https://mirror.codeforces.com/profile/me")).toBe(true);
    expect(isCodeforcesUrl("https://codeforces.com.evil.test/enter")).toBe(false);
  });

  it("clears only Cloudflare state left by an obsolete browser identity", () => {
    expect(["cf_clearance", "__cf_bm", "cf_chl_rc_ni", "JSESSIONID", "39ce7"].filter(isCloudflareCookie))
      .toEqual(["cf_clearance", "__cf_bm", "cf_chl_rc_ni"]);
  });
});
