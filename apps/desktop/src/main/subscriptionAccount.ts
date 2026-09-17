/**
 * Which account a connected subscription is actually signed in as.
 *
 * Three subscriptions, three different places the answer lives, and none of
 * them is the credential Spar stores: pi keeps only `refresh`/`access`/
 * `expires`, so the name has to be read back from the provider every time it is
 * wanted. Each reader below is best-effort by design — a label is decoration,
 * and Settings showing a working subscription as broken because a profile
 * endpoint moved would be a worse answer than showing no label at all.
 */

/** What Settings can say about the signed-in account. `email` is the useful
 *  one; `label` is whatever the provider would answer with when it has no
 *  address to give (a GitHub login, say), so the row always has something. */
export type ProviderAccount = { email: string | null; label: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ChatGPT hands the address back inside the access token rather than at an
 * endpoint — the flow asks for the `email` scope, so the claim is there. Which
 * claim path it lands under has moved between OpenAI's own releases, so this
 * walks the decoded payload instead of naming one: the first value that reads
 * as an address is the account, and a token that carries none simply has no
 * label. Nothing here verifies the signature; the token came from our own
 * keychain and is being read, not trusted.
 */
export function codexAccountFromToken(accessToken: string): ProviderAccount | null {
  const payload = decodeJwt(accessToken);
  if (!payload) return null;
  const email = findEmail(payload);
  return email ? { email, label: email } : null;
}

/**
 * Claude answers at the same OAuth surface the quota reading uses, so this
 * costs one call on a token that is already refreshed. `account.email_address`
 * is what it returns today; the scan behind it is what keeps this working the
 * day that field is renamed.
 */
export async function anthropicAccount(accessToken: string, signal?: AbortSignal): Promise<ProviderAccount | null> {
  const response = await fetch("https://api.anthropic.com/api/oauth/profile", {
    headers: { authorization: `Bearer ${accessToken}`, "anthropic-beta": "oauth-2025-04-20", "content-type": "application/json" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) return null;
  const body = await response.json() as unknown;
  const email = findEmail(body);
  return email ? { email, label: email } : null;
}

/**
 * Copilot is the one subscription whose stored `access` says nothing about the
 * person: it is a short-lived proxy token minted per session. The GitHub OAuth
 * token that mints it is kept as `refresh`, and that is what identifies the
 * account — so this asks GitHub, not Copilot.
 *
 * An address only comes back when the learner made theirs public, which most
 * have not. The login is what is left, and it is the name they would recognise
 * anyway, so it stands in rather than the row going blank.
 */
export async function githubAccount(githubToken: string, signal?: AbortSignal): Promise<ProviderAccount | null> {
  const response = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${githubToken}`, accept: "application/vnd.github+json" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) return null;
  const body = await response.json() as Record<string, unknown>;
  const email = typeof body.email === "string" && EMAIL.test(body.email) ? body.email : null;
  const login = typeof body.login === "string" && body.login ? body.login : null;
  if (!email && !login) return null;
  return { email, label: email ?? login! };
}

function decodeJwt(token: string): unknown {
  const payload = token.split(".")[1];
  if (!payload || token.split(".").length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

/** The first address anywhere in a decoded payload, breadth-first so a
 *  top-level `email` wins over one nested under an organization. */
function findEmail(value: unknown): string | null {
  const queue: unknown[] = [value];
  while (queue.length) {
    const next = queue.shift();
    if (typeof next === "string") {
      if (EMAIL.test(next)) return next;
      continue;
    }
    if (Array.isArray(next)) { queue.push(...next); continue; }
    if (next && typeof next === "object") queue.push(...Object.values(next));
  }
  return null;
}
