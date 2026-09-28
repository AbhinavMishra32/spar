import keytar from "keytar";
import type { AuthCodePurpose, AuthRequest, AuthResult } from "../shared/api.js";
import { credentialService } from "./devProfile.js";

const service = credentialService();
let reportedCredentialReadFailure = false;

export class CredentialStoreError extends Error {
  constructor(operation: "read" | "write" | "delete", cause: unknown) {
    const store = process.platform === "darwin" ? "macOS Keychain" : "the operating system credential store";
    const recovery = process.platform === "darwin" ? " Unlock the login keychain in Keychain Access and try again." : " Unlock it and try again.";
    super(`Spar could not ${operation} credentials in ${store}.${recovery}`, { cause });
    this.name = "CredentialStoreError";
  }
}

/** Reading the credential store is part of deciding which screen to show, but
 *  it must never be part of deciding whether Spar gets a window at all. macOS
 *  Keychain can reject a read while the login keychain is locked or unhealthy;
 *  in that case the safe bootstrap state is signed out. Writes still reject so
 *  the UI cannot claim a credential was saved when it was not. */
async function readPassword(account: string): Promise<string | null> {
  try {
    return await keytar.getPassword(service, account);
  } catch (cause) {
    if (!reportedCredentialReadFailure) {
      reportedCredentialReadFailure = true;
      console.error("Credential store unavailable; starting Spar signed out:", cause);
    }
    return null;
  }
}

async function writePassword(account: string, password: string): Promise<void> {
  try {
    await keytar.setPassword(service, account, password);
  } catch (cause) {
    throw new CredentialStoreError("write", cause);
  }
}

async function removePassword(account: string): Promise<boolean> {
  try {
    return await keytar.deletePassword(service, account);
  } catch (cause) {
    throw new CredentialStoreError("delete", cause);
  }
}

/** Every entry name under this app's service, for finding saved accounts and an
 *  account's own secrets. */
async function entryNames(): Promise<string[]> {
  try {
    return (await keytar.findCredentials(service)).map((entry) => entry.account);
  } catch (cause) {
    throw new CredentialStoreError("read", cause);
  }
}
/** Where the session token lives. The fifteen-minute JWT this replaced was held
 *  under "access-token"; that entry is cleared whenever a token is written or
 *  dropped, so no install is left holding a credential nothing will accept. */
const TOKEN = "session-token";
const LEGACY_TOKEN = "access-token";

/* Several accounts can be signed in on one device and switched between, so each
   keeps its own entries: the account itself, its session, and every secret it
   saved (model keys, provider sign-ins, practice sessions), all under
   `acct:<id>:`. `current-account` says which one the app is using. The entries
   from before this, `account` and `session-token` for the one account the device
   had, are moved over the first time they are read. */
const CURRENT = "current-account";
const scope = (accountId: string) => `acct:${accountId}:`;
const ACCOUNT_ENTRY = "account";

export type SavedAccount = { id: string; displayName: string; email: string };

/** What this app calls itself when it talks to the API.
 *
 *  Node's fetch stamps `sec-fetch-mode: cors` on everything it sends, and Better
 *  Auth reads that as a browser calling and then refuses a request that brings no
 *  Origin with it. So the app sends one. The scheme is deliberately not http:
 *  nothing can serve a page from it, which means the value cannot be forged by
 *  one. The API trusts exactly this string — see `DESKTOP_ORIGIN` in
 *  apps/api/src/auth.ts, and change neither without the other. */
const DESKTOP_ORIGIN = "spar://desktop";

type Account = SavedAccount;
/** What Better Auth answers with. `token` is absent when a deployment wants an
 *  address confirmed before it hands out a session. */
type AuthPayload = { token?: string | null; user?: { id: string; email: string; name?: string | null }; message?: string; code?: string };

/** Better Auth's error codes, said the way the window should say them. Anything
 *  not listed falls back to the server's own message, which is written for a
 *  developer but is at least accurate. */
const REASON: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password do not match an account.",
  INVALID_EMAIL: "Check the email address.",
  USER_ALREADY_EXISTS: "An account already exists for this email — sign in instead.",
  USER_NOT_FOUND: "There is no account for that email.",
  PASSWORD_TOO_SHORT: "Passwords are at least 8 characters.",
  PASSWORD_TOO_LONG: "That password is too long.",
  INVALID_OTP: "That code is not right. Check it, or ask for a new one.",
  OTP_EXPIRED: "That code has expired. Ask for a new one.",
  TOO_MANY_ATTEMPTS: "Too many tries with that code. Ask for a new one.",
};

export class AuthService {
  constructor(private readonly apiOrigin: string) {}
  /** Whether the account signed in on this run of the app was created on it.
   *
   *  It decides one thing: whether signing in waits for a restore before the
   *  window moves on. A brand-new account has nothing in the cloud to pull, and
   *  it cannot be recognised from the sign-in alone — with verification on, the
   *  account is created by `sign-up` and the session arrives later from
   *  `verify-email`, so the fact has to be remembered across the two calls. */
  private freshAccount = false;
  signedUpThisSession() { return this.freshAccount; }
  /** The account in use, cached: it changes only through this class. */
  private active: string | null | undefined;

  /** Which saved account the app is using, or null when it is on the sign-in screen. */
  async currentAccountId(): Promise<string | null> {
    if (this.active !== undefined) return this.active;
    await this.migrateSingleAccount();
    const id = await readPassword(CURRENT);
    this.active = id && await readPassword(scope(id) + ACCOUNT_ENTRY) ? id : null;
    return this.active;
  }

  /** The layout from before accounts could be switched: one account, unscoped. */
  private async migrateSingleAccount() {
    const raw = await readPassword(ACCOUNT_ENTRY);
    if (!raw) return;
    const account = JSON.parse(raw) as Partial<Account>;
    const token = await readPassword(TOKEN);
    if (token && account.id) {
      await writePassword(scope(account.id) + TOKEN, token);
      await writePassword(scope(account.id) + ACCOUNT_ENTRY, raw);
      await writePassword(CURRENT, account.id);
    }
    await removePassword(TOKEN).catch(() => false);
    await removePassword(LEGACY_TOKEN).catch(() => false);
    await removePassword(ACCOUNT_ENTRY);
  }

  async account() {
    const id = await this.currentAccountId();
    const raw = id ? await readPassword(scope(id) + ACCOUNT_ENTRY) : null;
    return raw ? JSON.parse(raw) as Account : null;
  }
  /** The bearer token every authenticated request carries. */
  async accessToken() {
    const id = await this.currentAccountId();
    return id ? readPassword(scope(id) + TOKEN) : null;
  }

  /** Every account signed in on this device, the one in use included. */
  async savedAccounts(): Promise<SavedAccount[]> {
    const names = await entryNames();
    const ids = names.filter((name) => name.startsWith("acct:") && name.endsWith(`:${ACCOUNT_ENTRY}`)).map((name) => name.slice(5, -(ACCOUNT_ENTRY.length + 1)));
    const accounts = await Promise.all(ids.map(async (id) => {
      const [raw, token] = await Promise.all([readPassword(scope(id) + ACCOUNT_ENTRY), readPassword(scope(id) + TOKEN)]);
      return raw && token ? JSON.parse(raw) as Account : null;
    }));
    return accounts.filter((account): account is Account => account !== null).sort((a, b) => a.email.localeCompare(b.email));
  }

  /** Makes another saved account the one in use. Its session is already here,
   *  so there is nothing to type. */
  async switchTo(accountId: string) {
    if (!await readPassword(scope(accountId) + TOKEN)) throw new Error("That account is no longer signed in on this device. Sign in to it again.");
    await writePassword(CURRENT, accountId);
    this.active = accountId;
    this.freshAccount = false;
  }

  /** Back to the sign-in screen to add another account, keeping this one saved. */
  async leave() {
    await removePassword(CURRENT).catch(() => false);
    this.active = null;
    this.freshAccount = false;
  }

  /** One entry point for every step of signing in. Each case is one call to
   *  Better Auth and, on success, one of two outcomes: the device is signed in,
   *  or a code is in the post. Nothing else is reported back — the window has no
   *  business knowing which endpoint answered. */
  async request(input: AuthRequest): Promise<AuthResult> {
    switch (input.action) {
      case "sign-up": {
        const payload = await this.post("sign-up/email", { email: input.email, password: input.password, name: input.email.split("@")[0] ?? "Learner" });
        /* Set only once the account exists — a failed sign-up throws above this
           line, and claiming a fresh account there would make the next sign-in
           skip the restore it needs. */
        this.freshAccount = true;
        /* No token means this deployment sends a code before it sends a session,
           and Better Auth has already sent it as part of the sign-up. */
        return payload.token ? this.persist(payload) : { status: "code-sent", purpose: "email-verification" };
      }
      case "sign-in": {
        const payload = await this.post("sign-in/email", { email: input.email, password: input.password }).catch(async (error: unknown) => {
          /* An unconfirmed address is not a failed sign-in, it is an unfinished
             sign-up. Better Auth refuses the password without sending anything,
             so the code is asked for here and the window moves to the step that
             was skipped rather than showing a dead end. */
          if (!(error instanceof AuthError) || error.code !== "EMAIL_NOT_VERIFIED") throw error;
          await this.post("email-otp/send-verification-otp", { email: input.email, type: "email-verification" });
          return null;
        });
        return payload ? this.persist(payload) : { status: "code-sent", purpose: "email-verification" };
      }
      case "send-code":
        /* Answers the same way whether or not the address has an account, so this
           is not a way to ask the server who has signed up. */
        await this.post("email-otp/send-verification-otp", { email: input.email, type: input.purpose });
        return { status: "code-sent", purpose: input.purpose };
      case "verify-email":
        return this.persist(await this.post("email-otp/verify-email", { email: input.email, otp: input.code }));
      case "sign-in-code":
        return this.persist(await this.post("sign-in/email-otp", { email: input.email, otp: input.code }));
      case "reset-password":
        /* Resetting revokes every other session server-side and hands back none,
           so the new password is spent immediately on a fresh one — otherwise the
           learner would type a new password and land back on the sign-in form. */
        await this.post("email-otp/reset-password", { email: input.email, otp: input.code, password: input.password });
        return this.persist(await this.post("sign-in/email", { email: input.email, password: input.password }));
    }
  }

  /** POSTs to Better Auth and normalises the failure. The token, when there is
   *  one, comes off the `set-auth-token` header the bearer plugin sets. */
  private async post(path: string, body: Record<string, unknown>): Promise<AuthPayload> {
    let response: Response;
    try {
      response = await fetch(`${this.apiOrigin}/v1/auth/${path}`, { method: "POST", headers: { "content-type": "application/json", origin: DESKTOP_ORIGIN }, body: JSON.stringify(body) });
    } catch {
      /* A refused connection is the one failure that is not about the credentials,
         and reporting it as one sends people to reset a password that was fine. */
      throw new AuthError("Spar cannot reach its server. Check your connection and try again.", "UNREACHABLE");
    }
    /* `?? {}` because a failure is allowed to have no body at all, and JSON `null`
       parses to null rather than to nothing — reading a code off that is how an
       error about a password becomes an error about reading a property of null. */
    const payload = (await response.json().catch(() => null) as AuthPayload | null) ?? {};
    if (response.status === 429) throw new AuthError("Too many attempts. Wait a minute, then try again.", "RATE_LIMITED");
    if (response.status >= 500) throw new AuthError("Spar's server could not complete that. Its log will say why.", "SERVER_ERROR");
    if (!response.ok) throw new AuthError(REASON[payload.code ?? ""] ?? payload.message ?? `Sign-in failed (${response.status})`, payload.code);
    return { ...payload, token: response.headers.get("set-auth-token") ?? payload.token ?? null };
  }

  /** Writes the credential to the keychain. The account is stored beside it
   *  because the bootstrap reads it before anything has been online. */
  private async persist(payload: AuthPayload): Promise<AuthResult> {
    if (!payload.token || !payload.user) throw new AuthError("The server did not return a session. Try signing in again.");
    const account: Account = { id: payload.user.id, email: payload.user.email, displayName: payload.user.name ?? payload.user.email.split("@")[0] ?? "Learner" };
    await writePassword(scope(account.id) + TOKEN, payload.token);
    await writePassword(scope(account.id) + ACCOUNT_ENTRY, JSON.stringify(account));
    await writePassword(CURRENT, account.id);
    await removePassword(LEGACY_TOKEN).catch(() => false);
    this.active = account.id;
    return { status: "signed-in" };
  }

  async signOut() {
    /* Told to the server first, so the row goes with the keychain entry and a
       stolen copy of the token is worth nothing. It is allowed to fail: signing
       out of a device has to work on a plane. */
    const token = await this.accessToken();
    if (token) await fetch(`${this.apiOrigin}/v1/auth/sign-out`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: DESKTOP_ORIGIN }, body: "{}" }).catch(() => undefined);
    /* Signing out removes the account from this device: its session and every
       secret it saved. The other saved accounts are left as they are. */
    const id = await this.currentAccountId();
    if (id) {
      const prefix = scope(id);
      await Promise.all((await entryNames()).filter((name) => name.startsWith(prefix)).map((name) => removePassword(name)));
    }
    await removePassword(CURRENT).catch(() => false);
    this.active = null;
    /* Whoever signs in next is not the account that was just created here, so the
       next sign-in must restore rather than assume there is nothing to pull. */
    this.freshAccount = false;
  }
  async deleteAccount() {
    const token = await this.accessToken();
    if (!token) throw new Error("Sign in before deleting your account");
    const response = await fetch(`${this.apiOrigin}/v1/account`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error ?? `Account deletion failed (${response.status})`);
    }
    // Signing out already empties every entry this account owns, the model
    // keys, provider sign-ins and practice sessions included.
    await this.signOut();
  }

  /** A secret's entry for the account in use. With nobody signed in there is
   *  nowhere to keep one. */
  private async secretEntry(name: string) {
    const id = await this.currentAccountId();
    if (!id) throw new Error("Sign in before saving credentials");
    return scope(id) + name;
  }
  /** Reads a secret, adopting the device-wide entry an older version saved: it
   *  belongs to whoever was signed in when it was made, which is the account
   *  that first asks for it after the upgrade. */
  private async readScoped(name: string) {
    const id = await this.currentAccountId();
    if (!id) return null;
    const value = await readPassword(scope(id) + name);
    if (value !== null) return value;
    const legacy = await readPassword(name);
    if (legacy === null) return null;
    await writePassword(scope(id) + name, legacy);
    await removePassword(name).catch(() => false);
    return legacy;
  }
  private async removeScoped(name: string) {
    const id = await this.currentAccountId();
    if (id) await removePassword(scope(id) + name);
    await removePassword(name).catch(() => false);
  }
  async saveSecret(account: string, secret: string) { await writePassword(await this.secretEntry(`provider:${account}`), secret); }
  readSecret(account: string) { return this.readScoped(`provider:${account}`); }
  deleteSecret(account: string) { return this.removeScoped(`provider:${account}`); }
  async saveProviderOAuth(provider: string, credentials: unknown) { await writePassword(await this.secretEntry(`provider-oauth:${provider}`), JSON.stringify(credentials)); }
  async readProviderOAuth<T>(provider: string): Promise<T | null> {
    const raw = await this.readScoped(`provider-oauth:${provider}`);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  deleteProviderOAuth(provider: string) { return this.removeScoped(`provider-oauth:${provider}`); }
}

/** A failure with a sentence in it that can be shown as-is, and the server's own
 *  code kept alongside for the one case the flow branches on. */
export class AuthError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = "AuthError"; }
}
