import type { PracticeRegion } from "../types.js";

/**
 * A LeetCode session, which is a pair of cookies and nothing else.
 *
 * LeetCode has no OAuth and no API tokens. Every client that works — the VS Code
 * extension, leetcode.nvim, the MCP servers — authenticates as a browser does:
 * `LEETCODE_SESSION` proves who you are and `csrftoken` has to be echoed back in
 * a header on every mutating request. So that pair *is* the credential, and Spar
 * holds it the way it holds a provider key: in the OS keychain, never in the
 * local database, and never handed back to the renderer.
 *
 * How it is obtained matters as much as what it is. Spar never asks for a
 * LeetCode password: it opens LeetCode's own sign-in page in a window and reads
 * the cookies the site sets, which means the learner types their credentials
 * into leetcode.com and every sign-in method the site offers — password, Google,
 * GitHub — works without Spar knowing anything about it. See the desktop app's
 * `practiceSignIn.ts`.
 */
export type LeetCodeSession = {
  region: PracticeRegion;
  /** The `LEETCODE_SESSION` cookie value, on its own. */
  session: string;
  /** The `csrftoken` cookie value, echoed as the `x-csrftoken` header. */
  csrfToken: string;
  /** Every cookie the sign-in window held, verbatim, as one Cookie header. Kept
   *  whole rather than reassembled from the two above because LeetCode also
   *  reads region and A/B cookies on some endpoints, and dropping them turns a
   *  working session into an intermittent one. */
  cookie: string;
  capturedAt: string;
};

export const LEETCODE_ORIGIN: Record<PracticeRegion, string> = {
  global: "https://leetcode.com",
  cn: "https://leetcode.cn",
};

/**
 * Whether LeetCode considers this session signed in.
 *
 * The presence of the cookies proves nothing, and assuming otherwise is a real
 * bug rather than a theoretical one: LeetCode issues `csrftoken` and
 * `LEETCODE_SESSION` to anonymous visitors the moment the page loads. A sign-in
 * flow that waits for those two names appears to succeed instantly — before the
 * learner has typed anything — and then everything downstream fails with a
 * session that is genuinely stored and genuinely nobody.
 *
 * So the only honest completion test is asking the service who it thinks is
 * asking. Deliberately a bare function rather than a method on the client: it is
 * used *during* sign-in, before any of the caching, expiry reporting or gateway
 * machinery should exist.
 */
export async function verifyLeetCodeSession(
  session: LeetCodeSession,
  region: PracticeRegion,
  fetcher: typeof fetch = fetch,
): Promise<{ username: string; premium: boolean } | null> {
  const query = region === "cn"
    ? "query globalData { userStatus { username userSlug isSignedIn isPremium } }"
    : "query globalData { userStatus { userId username isSignedIn isPremium } }";
  try {
    const response = await fetcher(`${LEETCODE_ORIGIN[region]}/graphql/`, {
      method: "POST",
      headers: leetCodeHeaders(session, region),
      body: JSON.stringify({ query, variables: {} }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: { userStatus?: { isSignedIn?: boolean; username?: string; userSlug?: string; isPremium?: boolean } } };
    const status = payload.data?.userStatus;
    if (!status?.isSignedIn) return null;
    const username = status.username || status.userSlug || "";
    return username ? { username, premium: status.isPremium === true } : null;
  } catch {
    /* A network failure is not a signed-out answer. The caller is polling, so
       returning null simply means "not yet" and the next tick asks again. */
    return null;
  }
}

/**
 * Reads a session out of a raw Cookie header.
 *
 * Tolerant on purpose: this is what the sign-in window produces and what a
 * learner pasting a cookie string by hand produces, and both are allowed to
 * carry any number of cookies Spar does not care about. It fails only when one
 * of the two load-bearing values is missing, and says which.
 */
export function parseLeetCodeCookie(raw: string, region: PracticeRegion): { session: LeetCodeSession } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: "No cookies were captured from the sign-in window." };
  const jar = new Map<string, string>();
  for (const part of text.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && value) jar.set(name, value);
  }
  const session = jar.get("LEETCODE_SESSION") ?? "";
  const csrfToken = jar.get("csrftoken") ?? "";
  if (!session) return { error: "The sign-in did not leave a LEETCODE_SESSION cookie, so LeetCode does not consider this browser signed in." };
  if (!csrfToken) return { error: "The sign-in did not leave a csrftoken cookie, which LeetCode requires on every request that changes anything." };
  return {
    session: {
      region,
      session,
      csrfToken,
      cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
      capturedAt: new Date().toISOString(),
    },
  };
}

/**
 * The headers every LeetCode request carries.
 *
 * `referer` is not decoration. LeetCode's run and submit endpoints reject a POST
 * whose referer is not the problem's own page — with a 403 and an HTML body, so
 * the failure arrives looking like a signed-out session rather than a missing
 * header. `origin` is checked the same way. Both are derived from the region and
 * the slug rather than passed in, so a caller cannot get them subtly wrong.
 */
export function leetCodeHeaders(session: LeetCodeSession | null, region: PracticeRegion, slug?: string): Record<string, string> {
  const origin = LEETCODE_ORIGIN[region];
  return {
    "content-type": "application/json",
    accept: "application/json",
    origin,
    referer: slug ? `${origin}/problems/${slug}/` : `${origin}/`,
    /* A real browser UA. LeetCode serves an interstitial to clients it does not
       recognise, and an interstitial parses as neither JSON nor an error. */
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ...(session ? { cookie: session.cookie, "x-csrftoken": session.csrfToken } : {}),
  };
}
