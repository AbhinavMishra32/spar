import { describe, expect, it } from "vitest";
import type { AuthService } from "./auth.js";
import { ProviderService } from "./provider.js";
import { LocalStore } from "./store.js";

class MemoryCredentials {
  readonly secrets = new Map<string, string>();
  readonly oauth = new Map<string, unknown>();
  saveSecret(account: string, secret: string) { this.secrets.set(account, secret); return Promise.resolve(); }
  readSecret(account: string) { return Promise.resolve(this.secrets.get(account) ?? null); }
  deleteSecret(account: string) { this.secrets.delete(account); return Promise.resolve(); }
  saveProviderOAuth(provider: string, credentials: unknown) { this.oauth.set(provider, credentials); return Promise.resolve(); }
  readProviderOAuth<T>(provider: string) { return Promise.resolve((this.oauth.get(provider) as T | undefined) ?? null); }
  deleteProviderOAuth(provider: string) { this.oauth.delete(provider); return Promise.resolve(); }
}

describe("provider service", () => {
  it("persists a selected API provider without exposing its key in inventory", async () => {
    const store = new LocalStore(":memory:");
    const credentials = new MemoryCredentials();
    const service = new ProviderService(credentials as unknown as AuthService, store, () => undefined);
    try {
      await service.saveCredential({ provider: "openrouter", model: "openrouter/free", baseUrl: "https://openrouter.ai/api/v1/", secret: "sk-or-secret" });
      const inventory = await service.inventory();
      const openrouter = inventory.providers.find((provider) => provider.id === "openrouter");
      expect(openrouter).toMatchObject({ state: "connected", selectedModel: "openrouter/free", baseUrl: "https://openrouter.ai/api/v1" });
      expect(JSON.stringify(inventory)).not.toContain("sk-or-secret");
      const resolved = await service.resolve("account", null);
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toMatchObject({ provider: "openrouter", model: "openrouter/free", api: "openai-completions", apiKey: "sk-or-secret" });
    } finally { store.close(); }
  });

  it("keeps subscription providers distinct from direct API-key providers", async () => {
    const store = new LocalStore(":memory:");
    const service = new ProviderService(new MemoryCredentials() as unknown as AuthService, store, () => undefined);
    try {
      const inventory = await service.inventory();
      expect(inventory.providers.find((provider) => provider.id === "openai-codex")).toMatchObject({ name: "ChatGPT", kind: "subscription", state: "disconnected" });
      expect(inventory.providers.find((provider) => provider.id === "openai")).toMatchObject({ name: "OpenAI", kind: "api-key", state: "disconnected" });
      expect(inventory.providers.find((provider) => provider.id === "claude-code")?.models.some((model) => model.id === "claude-sonnet-4-6")).toBe(true);
    } finally { store.close(); }
  });

  /* The whole point of the readiness flag: with nothing connected there is no
     credential anywhere on the machine that Spar is willing to run a turn on,
     and the inventory says so rather than naming its default provider. */
  it("reports no runtime, and resolves nothing, until a provider is connected", async () => {
    const store = new LocalStore(":memory:");
    const service = new ProviderService(new MemoryCredentials() as unknown as AuthService, store, () => undefined);
    try {
      expect(await service.available()).toBe(false);
      expect((await service.inventory()).ready).toBe(false);
      expect(await service.resolve("account", "access-token")).toEqual([]);
    } finally { store.close(); }
  });

  it("stops being ready once the connected provider is disconnected", async () => {
    const store = new LocalStore(":memory:");
    const credentials = new MemoryCredentials();
    const service = new ProviderService(credentials as unknown as AuthService, store, () => undefined);
    try {
      await service.saveCredential({ provider: "openrouter", model: "openrouter/free", baseUrl: "https://openrouter.ai/api/v1", secret: "sk-or-secret" });
      expect((await service.inventory()).ready).toBe(true);
      await service.disconnect("openrouter");
      expect((await service.inventory()).ready).toBe(false);
      expect(await service.resolve("account", null)).toEqual([]);
    } finally { store.close(); }
  });

  /* A local runtime holds no secret, so nothing in the keychain can report it.
     Adding it is the connection, and inventory and `resolve` have to agree. */
  it("treats an added local runtime as connected without a key", async () => {
    const store = new LocalStore(":memory:");
    const service = new ProviderService(new MemoryCredentials() as unknown as AuthService, store, () => undefined);
    try {
      expect((await service.inventory()).providers.find((provider) => provider.id === "ollama")?.state).toBe("disconnected");
      await service.saveCredential({ provider: "ollama", model: "qwen3", baseUrl: "http://localhost:11434/v1" });
      const inventory = await service.inventory();
      expect(inventory.providers.find((provider) => provider.id === "ollama")?.state).toBe("connected");
      expect(inventory.ready).toBe(true);
      expect(await service.resolve("account", null)).toHaveLength(1);
    } finally { store.close(); }
  });

  it("surfaces an expired subscription without exposing or deleting its credentials", async () => {
    const store = new LocalStore(":memory:");
    const credentials = new MemoryCredentials();
    credentials.oauth.set("openai-codex", { refresh: "secret-refresh-token" });
    store.setSetting("provider-auth-expired:openai-codex", true);
    const service = new ProviderService(credentials as unknown as AuthService, store, () => undefined);
    try {
      const inventory = await service.inventory();
      expect(inventory.providers.find((provider) => provider.id === "openai-codex")?.state).toBe("auth-expired");
      expect(JSON.stringify(inventory)).not.toContain("secret-refresh-token");
      expect(credentials.oauth.has("openai-codex")).toBe(true);
    } finally { store.close(); }
  });
});
