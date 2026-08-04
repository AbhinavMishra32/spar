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

/** Cline's tier list is the one catalog read over the network. Every test here
 *  refuses it, so what they assert is the seeded catalog rather than whatever
 *  Cline happens to be promoting today. */
const offline: typeof fetch = () => Promise.reject(new Error("offline"));

describe("provider service", () => {
  it("persists a selected API provider without exposing its key in inventory", async () => {
    const store = new LocalStore(":memory:");
    const credentials = new MemoryCredentials();
    const service = new ProviderService(credentials as unknown as AuthService, store, () => undefined, offline);
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
    const service = new ProviderService(new MemoryCredentials() as unknown as AuthService, store, () => undefined, offline);
    try {
      const inventory = await service.inventory();
      expect(inventory.providers.find((provider) => provider.id === "openai-codex")).toMatchObject({ name: "ChatGPT", kind: "subscription", state: "disconnected" });
      expect(inventory.providers.find((provider) => provider.id === "openai")).toMatchObject({ name: "OpenAI", kind: "api-key", state: "disconnected" });
      expect(inventory.providers.find((provider) => provider.id === "claude-code")?.models.some((model) => model.id === "claude-sonnet-4-6")).toBe(true);
    } finally { store.close(); }
  });

  /* pi-ai's bundled catalog lags what a ChatGPT subscription can actually run,
     so the Codex tiers are overlaid on it. The picker has to offer them, and
     `setDefault` — which refuses a model the provider does not list — has to
     accept one, or selecting it from the picker fails. */
  it("offers the current ChatGPT tiers ahead of pi-ai's bundled catalog", async () => {
    const store = new LocalStore(":memory:");
    const service = new ProviderService(new MemoryCredentials() as unknown as AuthService, store, () => undefined, offline);
    try {
      const models = (await service.inventory()).providers.find((provider) => provider.id === "openai-codex")?.models ?? [];
      expect(models.slice(0, 3).map((model) => model.id)).toEqual(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
      expect(models.find((model) => model.id === "gpt-5.6-luna")).toMatchObject({ name: "GPT-5.6 Luna", reasoning: true });
      expect(models.some((model) => model.id === "gpt-5.5")).toBe(true);
      service.setDefault("openai-codex", "gpt-5.6-luna");
      expect((await service.inventory()).providers.find((provider) => provider.id === "openai-codex")?.selectedModel).toBe("gpt-5.6-luna");
    } finally { store.close(); }
  });

  /* Cline is one endpoint in front of every lab, and the reason to reach for it
     is the models it currently charges nothing for. Those have to arrive first
     in the picker, say so in their name, and — since `setDefault` refuses a
     model the provider does not list — be selectable from it. */
  it("offers Cline's free models first, and resolves one against Cline's own endpoint", async () => {
    const store = new LocalStore(":memory:");
    const credentials = new MemoryCredentials();
    const service = new ProviderService(credentials as unknown as AuthService, store, () => undefined, offline);
    try {
      const cline = (await service.inventory()).providers.find((provider) => provider.id === "cline");
      expect(cline).toMatchObject({ name: "Cline", kind: "api-key", state: "disconnected", selectedModel: "deepseek/deepseek-v4-flash", baseUrl: "https://api.cline.bot/api/v1" });
      expect(cline?.models[0]).toMatchObject({ id: "deepseek/deepseek-v4-flash", name: "DeepSeek: DeepSeek V4 Flash (free)", reasoning: true });
      // Behind the promoted handful, Cline still offers the catalog it fronts.
      expect(cline?.models.some((model) => model.id === "deepseek/deepseek-v4-pro")).toBe(true);

      await service.saveCredential({ provider: "cline", model: "deepseek/deepseek-v4-flash", baseUrl: "https://api.cline.bot/api/v1", secret: "cline-secret" });
      service.setDefault("cline", "deepseek/deepseek-v4-flash");
      const resolved = await service.resolve("account", null);
      expect(resolved).toEqual([{
        provider: "cline",
        model: "deepseek/deepseek-v4-flash",
        api: "openai-completions",
        baseUrl: "https://api.cline.bot/api/v1",
        apiKey: "cline-secret",
        source: "spar-keychain",
        reasoningEffort: "off",
      }]);
    } finally { store.close(); }
  });

  /* The free tier is a promotion Cline rotates, so it is read from Cline rather
     than pinned in the build — and a reading that lands has to reach the picker,
     including a model pi-ai's bundled catalog has never heard of. */
  it("takes Cline's current free tier over the one it shipped with", async () => {
    const store = new LocalStore(":memory:");
    const tiers = { free: [{ id: "acme/brand-new-flash", name: "brand-new-flash" }], recommended: [] };
    const service = new ProviderService(
      new MemoryCredentials() as unknown as AuthService,
      store,
      () => undefined,
      () => Promise.resolve(new Response(JSON.stringify(tiers), { headers: { "content-type": "application/json" } })),
    );
    try {
      await service.inventory();
      // The refresh is deliberately not awaited by `inventory`, so the reading
      // lands on the next read rather than the one that asked for it.
      await new Promise((resolve) => setImmediate(resolve));
      const models = (await service.inventory()).providers.find((provider) => provider.id === "cline")?.models ?? [];
      expect(models[0]).toMatchObject({ id: "acme/brand-new-flash", name: "brand-new-flash (free)" });
      expect(models.find((model) => model.id === "deepseek/deepseek-v4-flash")?.name).toBe("DeepSeek: DeepSeek V4 Flash");
    } finally { store.close(); }
  });

  /* The whole point of the readiness flag: with nothing connected there is no
     credential anywhere on the machine that Spar is willing to run a turn on,
     and the inventory says so rather than naming its default provider. */
  it("reports no runtime, and resolves nothing, until a provider is connected", async () => {
    const store = new LocalStore(":memory:");
    const service = new ProviderService(new MemoryCredentials() as unknown as AuthService, store, () => undefined, offline);
    try {
      expect(await service.available()).toBe(false);
      expect((await service.inventory()).ready).toBe(false);
      expect(await service.resolve("account", "access-token")).toEqual([]);
    } finally { store.close(); }
  });

  it("stops being ready once the connected provider is disconnected", async () => {
    const store = new LocalStore(":memory:");
    const credentials = new MemoryCredentials();
    const service = new ProviderService(credentials as unknown as AuthService, store, () => undefined, offline);
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
    const service = new ProviderService(new MemoryCredentials() as unknown as AuthService, store, () => undefined, offline);
    try {
      expect((await service.inventory()).providers.find((provider) => provider.id === "ollama")?.state).toBe("disconnected");
      await service.saveCredential({ provider: "ollama", model: "qwen3", baseUrl: "http://localhost:11434/v1" });
      const inventory = await service.inventory();
      expect(inventory.providers.find((provider) => provider.id === "ollama")?.state).toBe("connected");
      expect(inventory.ready).toBe(true);
      expect(await service.resolve("account", null)).toHaveLength(1);
    } finally { store.close(); }
  });

  /* ChatGPT reports quota on the headers of the turn that spent it and nowhere
     else, so the last turn's reading is the only one that exists between turns
     — and a provider that has never run one has to report nothing, not zero. */
  it("keeps the Codex rate-limit reading a turn reported, and reports none before one has", async () => {
    const store = new LocalStore(":memory:");
    const service = new ProviderService(new MemoryCredentials() as unknown as AuthService, store, () => undefined, offline);
    try {
      expect(await service.subscriptionUsage("openai-codex")).toBeNull();
      expect(await service.subscriptionUsage("openrouter")).toBeNull();
      service.recordCodexRateLimits({ "x-codex-primary-used-percent": "18", "x-codex-primary-window-minutes": "300", "x-codex-secondary-used-percent": "64", "x-codex-secondary-window-minutes": "10080" });
      expect((await service.subscriptionUsage("openai-codex"))?.windows).toEqual([
        { kind: "five-hour", usedPercent: 18, resetsAt: null },
        { kind: "weekly", usedPercent: 64, resetsAt: null },
      ]);
    } finally { store.close(); }
  });

  it("surfaces an expired subscription without exposing or deleting its credentials", async () => {
    const store = new LocalStore(":memory:");
    const credentials = new MemoryCredentials();
    credentials.oauth.set("openai-codex", { refresh: "secret-refresh-token" });
    store.setSetting("provider-auth-expired:openai-codex", true);
    const service = new ProviderService(credentials as unknown as AuthService, store, () => undefined, offline);
    try {
      const inventory = await service.inventory();
      expect(inventory.providers.find((provider) => provider.id === "openai-codex")?.state).toBe("auth-expired");
      expect(JSON.stringify(inventory)).not.toContain("secret-refresh-token");
      expect(credentials.oauth.has("openai-codex")).toBe(true);
    } finally { store.close(); }
  });
});
