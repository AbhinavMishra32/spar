import { PracticeAuthError } from "../types.js";

export const CODEFORCES_ORIGIN = "https://codeforces.com";

/** A browser credential plus the identity verified while that browser was open. */
export type CodeforcesSession = {
  region: "global";
  handle: string;
  cookie: string;
  csrfToken: string;
  capturedAt: string;
};

export function codeforcesHeaders(session: CodeforcesSession | null, referer = `${CODEFORCES_ORIGIN}/`): Record<string, string> {
  return {
    accept: "application/json,text/html;q=0.9,*/*;q=0.8",
    referer,
    origin: CODEFORCES_ORIGIN,
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ...(session ? { cookie: session.cookie } : {}),
  };
}

export function parseCodeforcesCookies(raw: string, handle: string, csrfToken: string): CodeforcesSession {
  const cookie = raw.trim();
  if (!cookie) throw new PracticeAuthError("Codeforces did not leave a browser session to save.");
  if (!handle.trim()) throw new PracticeAuthError("Codeforces did not identify the signed-in account.");
  if (!csrfToken.trim()) throw new PracticeAuthError("Codeforces did not publish the CSRF token required to submit solutions.");
  return { region: "global", handle: handle.trim(), cookie, csrfToken: csrfToken.trim(), capturedAt: new Date().toISOString() };
}

export async function verifyCodeforcesSession(session: CodeforcesSession, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`${CODEFORCES_ORIGIN}/settings/general`, { headers: codeforcesHeaders(session) });
    if (!response.ok) return false;
    const html = await response.text();
    return html.includes(`/profile/${escapeRegExpText(session.handle)}`) && /logout|Sign out/i.test(html);
  } catch { return false; }
}

function escapeRegExpText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
