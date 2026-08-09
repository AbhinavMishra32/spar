import { describe, expect, it } from "vitest";
import { browserCandidates, browserSafeHeaders, isCloudflareCookie, isCodeforcesUrl } from "./codeforcesBrowser.js";

describe("the Codeforces sign-in browser boundary", () => {
  it("lets Chrome supply the verified browser identity on submit requests", () => {
    expect(browserSafeHeaders({
      cookie: "JSESSIONID=secret",
      "user-agent": "copied browser",
      origin: "https://codeforces.com",
      referer: "https://codeforces.com/problemset/submit",
      "content-type": "application/x-www-form-urlencoded",
    })).toEqual({ "content-type": "application/x-www-form-urlencoded" });
  });

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
