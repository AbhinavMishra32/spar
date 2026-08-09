import { describe, expect, it, vi } from "vitest";
import { codeforcesHeaders, parseCodeforcesCookies, verifyCodeforcesSession } from "./session.js";

describe("Codeforces browser session identity", () => {
  it("persists and reuses the user-agent that earned Cloudflare clearance", async () => {
    const session = parseCodeforcesCookies("JSESSIONID=secret; cf_clearance=clear", "learner", "csrf", "Chrome captured by Spar");
    expect(codeforcesHeaders(session)["user-agent"]).toBe("Chrome captured by Spar");

    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("user-agent")).toBe("Chrome captured by Spar");
      return new Response('<a href="/profile/learner">learner</a><a href="/logout">Logout</a>');
    }) as typeof fetch;
    await expect(verifyCodeforcesSession(session, fetcher)).resolves.toBe(true);
  });
});
