import { describe, expect, it } from "vitest";
import { sparCredentialStore, sparProviderId, type OAuthVault } from "./piModels.js";

/** Spar's keychain, in memory. The adapter's whole job is which key it touches
 *  and what it stores there, so the double records both. */
function vault(seed: Record<string, unknown> = {}) {
  const entries = new Map<string, unknown>(Object.entries(seed));
  const writes: string[] = [];
  const store: OAuthVault & { entries: Map<string, unknown>; writes: string[] } = {
    entries,
    writes,
    async readProviderOAuth<T>(provider: string) { return (entries.get(provider) as T) ?? null; },
    async saveProviderOAuth(provider: string, credentials: unknown) { writes.push(provider); entries.set(provider, credentials); return credentials; },
    async deleteProviderOAuth(provider: string) { entries.delete(provider); },
  };
  return store;
}

const tokens = { access: "at", refresh: "rt", expires: 1 };

describe("pi credentials, over Spar's keychain", () => {
  /* The one id that differs. Getting this backwards does not fail loudly — it
     reads an empty entry and reports the learner as signed out of a
     subscription they are still paying for. */
  it("reads Claude's runtime id from the entry the subscription wrote", () => {
    expect(sparProviderId("anthropic")).toBe("claude-code");
    expect(sparProviderId("openai-codex")).toBe("openai-codex");
    expect(sparProviderId("github-copilot")).toBe("github-copilot");
  });

  it("tags a stored credential on the way out without rewriting the entry", async () => {
    const keychain = vault({ "claude-code": tokens });
    const stored = await sparCredentialStore(keychain).read("anthropic");
    expect(stored).toEqual({ type: "oauth", ...tokens });
    expect(keychain.entries.get("claude-code")).toEqual(tokens);
  });

  it("reports no credential rather than throwing when nothing is connected", async () => {
    expect(await sparCredentialStore(vault()).read("anthropic")).toBeUndefined();
  });

  it("lists only the subscriptions that have an entry", async () => {
    const store = sparCredentialStore(vault({ "claude-code": tokens, "github-copilot": tokens }));
    expect(await store.list()).toEqual([
      { providerId: "anthropic", type: "oauth" },
      { providerId: "github-copilot", type: "oauth" },
    ]);
  });

  it("writes a rotated token back untagged, under Spar's own id", async () => {
    const keychain = vault({ "claude-code": tokens });
    const rotated = { ...tokens, access: "at2", expires: 2 };
    const result = await sparCredentialStore(keychain).modify("anthropic", async () => ({ type: "oauth", ...rotated }));
    expect(result).toEqual({ type: "oauth", ...rotated });
    expect(keychain.entries.get("claude-code")).toEqual(rotated);
  });

  /* A refresh that finds the token still good returns nothing, and nothing must
     not read as "delete it" — nor as a write, since every write is a keychain
     round trip and, on Linux, a prompt. */
  it("leaves the entry alone when the modifier declines to change it", async () => {
    const keychain = vault({ "claude-code": tokens });
    const result = await sparCredentialStore(keychain).modify("anthropic", async () => undefined);
    expect(result).toEqual({ type: "oauth", ...tokens });
    expect(keychain.writes).toEqual([]);
  });

  /* pi's contract: the second writer sees what the first wrote. Two turns
     starting together both find an expired token, and if they interleave, the
     later refresh saves a token the provider has already rotated away — signing
     the learner out mid-session. */
  it("serializes writes so a concurrent refresh sees the first one's result", async () => {
    const store = sparCredentialStore(vault({ "claude-code": { ...tokens, expires: 0 } }));
    const seen: number[] = [];
    const bump = () => store.modify("anthropic", async (current) => {
      const at = (current as { expires: number } | undefined)?.expires ?? 0;
      seen.push(at);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { type: "oauth", ...tokens, expires: at + 1 };
    });
    await Promise.all([bump(), bump(), bump()]);
    expect(seen).toEqual([0, 1, 2]);
  });

  it("keeps serving writes after one of them fails", async () => {
    const keychain = vault({ "claude-code": tokens });
    const store = sparCredentialStore(keychain);
    await expect(store.modify("anthropic", async () => { throw new Error("refresh rejected"); })).rejects.toThrow("refresh rejected");
    await expect(store.modify("anthropic", async () => ({ type: "oauth", ...tokens, access: "at3" }))).resolves.toBeDefined();
    expect(keychain.entries.get("claude-code")).toEqual({ ...tokens, access: "at3" });
  });

  it("signs out through Spar's own id", async () => {
    const keychain = vault({ "claude-code": tokens });
    await sparCredentialStore(keychain).delete("anthropic");
    expect(keychain.entries.has("claude-code")).toBe(false);
  });
});
