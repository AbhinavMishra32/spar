import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* keytar talks to the OS keychain, which a test has no business writing to, so
   it is replaced by a map. The assertions below care about what ends up in it —
   which key holds the token, and which keys are cleared. */
const keychain = new Map<string, string>();
vi.mock("keytar", () => ({
  default: {
    getPassword: vi.fn(async (_service: string, account: string) => keychain.get(account) ?? null),
    setPassword: vi.fn(async (_service: string, account: string, secret: string) => void keychain.set(account, secret)),
    deletePassword: vi.fn(async (_service: string, account: string) => keychain.delete(account)),
  },
}));

const { AuthService, AuthError } = await import("./auth.js");
const keytar = (await import("keytar")).default;

type Handler = (body: Record<string, unknown>) => Response;
let routes: Record<string, Handler>;
let calls: string[];
let origins: Array<string | undefined>;

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });
const session = (token: string) => json({ token, user: { id: "8f1c", email: "learner@example.com", name: "learner" } }, { headers: { "set-auth-token": `${token}.signature` } });

beforeEach(() => {
  keychain.clear();
  vi.mocked(keytar.getPassword).mockImplementation(async (_service: string, account: string) => keychain.get(account) ?? null);
  vi.mocked(keytar.setPassword).mockImplementation(async (_service: string, account: string, secret: string) => void keychain.set(account, secret));
  vi.mocked(keytar.deletePassword).mockImplementation(async (_service: string, account: string) => keychain.delete(account));
  calls = [];
  origins = [];
  routes = {};
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = String(url).replace("https://api.test/v1/auth/", "");
    calls.push(path);
    origins.push((init.headers as Record<string, string> | undefined)?.origin);
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected request to ${path}`);
    return handler(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>);
  });
});
afterEach(() => vi.unstubAllGlobals());

const service = () => new AuthService("https://api.test");

describe("credential-store bootstrap", () => {
  it("starts signed out when the OS credential store cannot be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(keytar.getPassword).mockRejectedValueOnce(new Error("An unknown error occurred."));

    await expect(service().account()).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith(
      "Credential store unavailable; starting Spar signed out:",
      expect.any(Error),
    );
  });

  it("turns an opaque credential write failure into an actionable error", async () => {
    routes["sign-in/email"] = () => session("raw-token");
    vi.mocked(keytar.setPassword).mockRejectedValueOnce(new Error("An unknown error occurred."));

    await expect(service().request({ action: "sign-in", email: "learner@example.com", password: "a-good-password" }))
      .rejects.toThrow(/Unlock the login keychain in Keychain Access/);
  });
});

describe("signing in", () => {
  it("keeps the signed token from the bearer header, not the one in the body", async () => {
    routes["sign-in/email"] = () => session("raw-token");
    await expect(service().request({ action: "sign-in", email: "learner@example.com", password: "a-good-password" })).resolves.toEqual({ status: "signed-in" });
    expect(keychain.get("session-token")).toBe("raw-token.signature");
    expect(JSON.parse(keychain.get("account") ?? "{}")).toEqual({ id: "8f1c", email: "learner@example.com", displayName: "learner" });
  });

  it("clears the fifteen-minute token the old scheme left in the keychain", async () => {
    keychain.set("access-token", "an-expired-jwt");
    routes["sign-in/email"] = () => session("raw-token");
    await service().request({ action: "sign-in", email: "learner@example.com", password: "a-good-password" });
    expect(keychain.has("access-token")).toBe(false);
  });

  /* Node's fetch stamps `sec-fetch-mode: cors` on everything, which Better Auth
     reads as a browser calling; without an Origin it answers every request with
     MISSING_OR_NULL_ORIGIN, and the app cannot sign anyone in at all. */
  it("names itself with the origin the API trusts", async () => {
    routes["sign-in/email"] = () => session("raw-token");
    routes["sign-out"] = () => json({ success: true });
    await service().request({ action: "sign-in", email: "learner@example.com", password: "a-good-password" });
    await service().signOut();
    expect(origins).toEqual(["spar://desktop", "spar://desktop"]);
  });

  it("says what a rejected password means rather than repeating a status code", async () => {
    routes["sign-in/email"] = () => json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, { status: 401 });
    await expect(service().request({ action: "sign-in", email: "learner@example.com", password: "a-good-password" })).rejects.toThrow(/do not match an account/);
  });

  it("does not blame the credentials when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
    await expect(service().request({ action: "sign-in", email: "learner@example.com", password: "a-good-password" })).rejects.toThrow(/cannot reach its server/);
  });

  it("reports a rate limit as one, whatever the endpoint says", async () => {
    routes["sign-in/email"] = () => json({}, { status: 429 });
    await expect(service().request({ action: "sign-in", email: "learner@example.com", password: "a-good-password" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("an account that has not confirmed its address", () => {
  /* Better Auth refuses the password and sends nothing, so the unfinished
     sign-up has to be picked back up here — otherwise the window shows a
     password error for a password that is correct. */
  it("asks for a fresh code and sends the window to the code step", async () => {
    routes["sign-in/email"] = () => json({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }, { status: 403 });
    routes["email-otp/send-verification-otp"] = () => json({ success: true });
    await expect(service().request({ action: "sign-in", email: "learner@example.com", password: "a-good-password" })).resolves.toEqual({ status: "code-sent", purpose: "email-verification" });
    expect(calls).toEqual(["sign-in/email", "email-otp/send-verification-otp"]);
    expect(keychain.size).toBe(0);
  });

  it("signs in once the code is confirmed", async () => {
    routes["email-otp/verify-email"] = () => session("raw-token");
    await expect(service().request({ action: "verify-email", email: "learner@example.com", code: "123456" })).resolves.toEqual({ status: "signed-in" });
    expect(keychain.get("session-token")).toBe("raw-token.signature");
  });
});

describe("creating an account", () => {
  it("waits for a code when the deployment answers without a session", async () => {
    routes["sign-up/email"] = () => json({ token: null, user: { id: "8f1c", email: "learner@example.com", name: "learner" } });
    await expect(service().request({ action: "sign-up", email: "learner@example.com", password: "a-good-password" })).resolves.toEqual({ status: "code-sent", purpose: "email-verification" });
    expect(keychain.size).toBe(0);
  });

  it("signs in immediately when one comes back", async () => {
    routes["sign-up/email"] = () => session("raw-token");
    await expect(service().request({ action: "sign-up", email: "learner@example.com", password: "a-good-password" })).resolves.toEqual({ status: "signed-in" });
  });
});

describe("recovering an account", () => {
  it("spends the new password on a session so the learner is not sent back to the form", async () => {
    routes["email-otp/reset-password"] = () => json({ success: true });
    routes["sign-in/email"] = (body) => (body.password === "a-brand-new-password" ? session("raw-token") : json({ code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 }));
    await expect(service().request({ action: "reset-password", email: "learner@example.com", code: "123456", password: "a-brand-new-password" })).resolves.toEqual({ status: "signed-in" });
    expect(calls).toEqual(["email-otp/reset-password", "sign-in/email"]);
  });

  it("leaves the password alone when the code is wrong", async () => {
    routes["email-otp/reset-password"] = () => json({ code: "INVALID_OTP", message: "Invalid OTP" }, { status: 400 });
    await expect(service().request({ action: "reset-password", email: "learner@example.com", code: "000000", password: "a-brand-new-password" })).rejects.toThrow(/not right/);
    expect(calls).toEqual(["email-otp/reset-password"]);
  });
});

describe("signing out", () => {
  it("revokes the session on the server and empties the keychain", async () => {
    keychain.set("session-token", "raw-token.signature");
    keychain.set("account", "{}");
    routes["sign-out"] = () => json({ success: true });
    await service().signOut();
    expect(calls).toEqual(["sign-out"]);
    expect(keychain.size).toBe(0);
  });

  it("empties the keychain even when the server cannot be told", async () => {
    keychain.set("session-token", "raw-token.signature");
    keychain.set("account", "{}");
    vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
    await service().signOut();
    expect(keychain.size).toBe(0);
  });
});

it("carries the server's own code for the one case the flow branches on", () => {
  expect(new AuthError("nope", "EMAIL_NOT_VERIFIED").code).toBe("EMAIL_NOT_VERIFIED");
});
