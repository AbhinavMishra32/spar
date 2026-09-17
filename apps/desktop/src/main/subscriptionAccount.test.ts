import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicAccount, codexAccountFromToken, githubAccount } from "./subscriptionAccount.js";

const jwt = (payload: unknown) =>
  ["header", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".");

afterEach(() => { vi.restoreAllMocks(); });

describe("ChatGPT account", () => {
  it("reads the address out of the access token whatever claim it arrives under", () => {
    const token = jwt({ "https://api.openai.com/profile": { email: "learner@example.com", email_verified: true } });
    expect(codexAccountFromToken(token)).toEqual({ email: "learner@example.com", label: "learner@example.com" });
  });

  /* The claim path has moved between OpenAI's own releases, so a token that
     carries the address at the top level has to work as well. */
  it("reads a top-level claim", () => {
    expect(codexAccountFromToken(jwt({ sub: "user-1", email: "top@example.com" }))?.email).toBe("top@example.com");
  });

  /* Nothing to say is a supported answer: the row shows no hover rather than
     a label invented from whatever string happened to be in the payload. */
  it("answers nothing for a token with no address in it", () => {
    expect(codexAccountFromToken(jwt({ sub: "user-1", scope: "openid profile" }))).toBeNull();
    expect(codexAccountFromToken("not-a-jwt")).toBeNull();
  });
});

describe("Claude account", () => {
  it("reads the profile endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ account: { uuid: "abc", email_address: "learner@example.com" }, organization: { name: "Acme" } }),
      { status: 200 },
    )));
    expect(await anthropicAccount("token")).toEqual({ email: "learner@example.com", label: "learner@example.com" });
  });

  it("answers nothing when the endpoint refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    expect(await anthropicAccount("token")).toBeNull();
  });
});

describe("GitHub Copilot account", () => {
  it("prefers the address when the account publishes one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ login: "octocat", email: "octocat@example.com" }), { status: 200 },
    )));
    expect(await githubAccount("token")).toEqual({ email: "octocat@example.com", label: "octocat@example.com" });
  });

  /* Most accounts keep the address private, and the login is the name the
     learner would recognise anyway — so the row still says who this is. */
  it("falls back to the login when it does not", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ login: "octocat", email: null }), { status: 200 })));
    expect(await githubAccount("token")).toEqual({ email: null, label: "octocat" });
  });
});
