import { describe, expect, it, vi } from "vitest";
import { codeMessage, createMailer } from "./mailer.js";
import { envSchema } from "./env.js";

const base = { DATABASE_URL: "postgresql://localhost/db", AUTH_SECRET: "0123456789012345678901234567890123", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "0123456789012345678901234567890123" };

describe("mailer", () => {
  it("reports itself unconfigured and logs the message when no provider key is set", async () => {
    const log = vi.fn();
    const mailer = createMailer(envSchema.parse(base), log);
    expect(mailer.configured).toBe(false);
    await mailer.send(codeMessage("learner@example.com", "123456", "email-verification", 10));
    /* The code has to survive into the log verbatim: running from source, that
       line is the only place the code exists. */
    expect(log.mock.calls[0]?.[0]).toContain("123456");
    expect(log.mock.calls[0]?.[0]).toContain("learner@example.com");
  });

  it("posts to Resend once a key and sender are set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const mailer = createMailer(envSchema.parse({ ...base, RESEND_API_KEY: "re_0123456789", EMAIL_FROM: "Spar <no-reply@example.com>" }));
    expect(mailer.configured).toBe(true);
    await mailer.send(codeMessage("learner@example.com", "654321", "forget-password", 10));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_0123456789");
    const body = JSON.parse(String(init.body)) as { from: string; to: string[]; html: string; text: string };
    expect(body.from).toBe("Spar <no-reply@example.com>");
    expect(body.to).toEqual(["learner@example.com"]);
    /* Both parts always: a text-only client still has to be able to read the code. */
    expect(body.text).toContain("654321");
    expect(body.html).toContain("6 5 4 3 2 1");
    vi.unstubAllGlobals();
  });

  it("carries Resend's own reason into the failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403 })));
    const mailer = createMailer(envSchema.parse({ ...base, RESEND_API_KEY: "re_0123456789", EMAIL_FROM: "Spar <no-reply@example.com>" }));
    await expect(mailer.send(codeMessage("learner@example.com", "111111", "sign-in", 10))).rejects.toThrow(/domain is not verified/);
    vi.unstubAllGlobals();
  });

  it("says what the code is for, in the subject and the body", () => {
    expect(codeMessage("a@b.co", "424242", "forget-password", 10).subject).toContain("424242");
    expect(codeMessage("a@b.co", "424242", "forget-password", 10).text).toContain("Reset your password");
    expect(codeMessage("a@b.co", "424242", "email-verification", 10).text).toContain("finish creating your account");
    expect(codeMessage("a@b.co", "424242", "sign-in", 15).text).toContain("expires in 15 minutes");
  });
});

describe("email configuration", () => {
  it("lets a build from source run without a provider", () => {
    expect(envSchema.parse(base).RESEND_API_KEY).toBeUndefined();
  });

  it("refuses a production deployment that could never send a code", () => {
    expect(() => envSchema.parse({ ...base, NODE_ENV: "production" })).toThrow(/RESEND_API_KEY/);
    expect(() => envSchema.parse({ ...base, NODE_ENV: "production", RESEND_API_KEY: "re_0123456789" })).toThrow(/EMAIL_FROM/);
    expect(envSchema.parse({ ...base, NODE_ENV: "production", RESEND_API_KEY: "re_0123456789", EMAIL_FROM: "Spar <no-reply@example.com>" }).EMAIL_FROM).toBe("Spar <no-reply@example.com>");
  });
});
