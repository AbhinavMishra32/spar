import { randomUUID } from "node:crypto";
import { shell } from "electron";
import { getModels, type Api, type Model, type OAuthCredentials } from "@mariozechner/pi-ai";
import { getOAuthApiKey, getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import { apiOrigin } from "./apiOrigin.js";
import type { AuthService } from "./auth.js";
import type { LocalStore } from "./store.js";
import { anthropicUsage, codexUsageFromHeaders } from "./subscriptionUsage.js";
import type { ProviderInventory, ProviderOAuthEvent, ReasoningEffort, SubscriptionUsage } from "../shared/api.js";
import { clineModels, clineSeedTiers, fetchClineTiers, type ClineTiers } from "../shared/clineCatalog.js";

export const providerIds = [
  "openai-codex", "claude-code", "github-copilot", "openai", "anthropic", "google", "xai",
  "openrouter", "cline", "opencode", "opencode-go", "deepseek", "minimax", "moonshotai", "kimi-coding",
  "zai", "vercel-ai-gateway", "cloudflare-ai-gateway", "ollama", "lm-studio", "custom",
] as const;
export type ProviderId = (typeof providerIds)[number];
export type ResolvedProvider = {
  provider: string;
  model: string;
  api: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  source: "spar-keychain" | "spar-oauth" | "gateway";
  reasoningEffort: ReasoningEffort;
};

type Descriptor = {
  id: ProviderId;
  runtimeId: string;
  name: string;
  description: string;
  kind: "subscription" | "api-key" | "local" | "custom";
  defaultModel: string;
  defaultBaseUrl?: string;
  keyUrl?: string;
};

const descriptors: Descriptor[] = [
  { id: "openai-codex", runtimeId: "openai-codex", name: "ChatGPT", kind: "subscription", description: "Reuse your ChatGPT Plus or Pro subscription", defaultModel: "gpt-5.6-terra" },
  { id: "claude-code", runtimeId: "anthropic", name: "Claude", kind: "subscription", description: "Reuse your Claude Pro or Max subscription", defaultModel: "claude-sonnet-4-6" },
  { id: "github-copilot", runtimeId: "github-copilot", name: "GitHub Copilot", kind: "subscription", description: "Reuse your GitHub Copilot subscription", defaultModel: "gpt-5.4" },
  { id: "openai", runtimeId: "openai", name: "OpenAI", kind: "api-key", description: "OpenAI API models", defaultModel: "gpt-5.4-mini", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", runtimeId: "anthropic", name: "Anthropic", kind: "api-key", description: "Claude models", defaultModel: "claude-sonnet-4-6", keyUrl: "https://platform.claude.com/settings/keys" },
  { id: "google", runtimeId: "google", name: "Google", kind: "api-key", description: "Gemini models", defaultModel: "gemini-3-flash-preview", keyUrl: "https://aistudio.google.com/api-keys" },
  { id: "xai", runtimeId: "xai", name: "SpaceXAI", kind: "api-key", description: "Grok models", defaultModel: "grok-4.1-fast", keyUrl: "https://console.x.ai/" },
  { id: "openrouter", runtimeId: "openrouter", name: "OpenRouter", kind: "api-key", description: "Use models through OpenRouter", defaultModel: "openrouter/free", keyUrl: "https://openrouter.ai/settings/keys" },
  { id: "cline", runtimeId: "cline", name: "Cline", kind: "api-key", description: "Every lab's coding models on one key, some of them free", defaultModel: "deepseek/deepseek-v4-flash", keyUrl: "https://app.cline.bot/" },
  { id: "opencode", runtimeId: "opencode", name: "OpenCode Zen", kind: "api-key", description: "Curated coding models through OpenCode Zen", defaultModel: "gpt-5.4-mini", keyUrl: "https://opencode.ai/docs/zen/" },
  { id: "opencode-go", runtimeId: "opencode-go", name: "OpenCode Go", kind: "api-key", description: "OpenCode Go subscription models", defaultModel: "glm-5", keyUrl: "https://opencode.ai/docs/go/" },
  { id: "deepseek", runtimeId: "deepseek", name: "DeepSeek", kind: "api-key", description: "DeepSeek API models", defaultModel: "deepseek-v4-flash", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "minimax", runtimeId: "minimax", name: "MiniMax", kind: "api-key", description: "MiniMax API models", defaultModel: "MiniMax-M2.7", keyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key" },
  { id: "moonshotai", runtimeId: "moonshotai", name: "Moonshot AI", kind: "api-key", description: "Kimi models through Moonshot AI", defaultModel: "kimi-k2.5", keyUrl: "https://platform.kimi.ai/console/api-keys" },
  { id: "kimi-coding", runtimeId: "kimi-coding", name: "Kimi For Coding", kind: "api-key", description: "Moonshot AI coding models", defaultModel: "kimi-for-coding", keyUrl: "https://platform.kimi.ai/console/api-keys" },
  { id: "zai", runtimeId: "zai", name: "Z.ai", kind: "api-key", description: "GLM models through Z.ai", defaultModel: "glm-5", keyUrl: "https://z.ai/manage-apikey/apikey-list" },
  { id: "vercel-ai-gateway", runtimeId: "vercel-ai-gateway", name: "Vercel AI Gateway", kind: "api-key", description: "Recent frontier models through Vercel AI Gateway", defaultModel: "openai/gpt-5.4-mini", keyUrl: "https://vercel.com/ai-gateway" },
  { id: "cloudflare-ai-gateway", runtimeId: "cloudflare-ai-gateway", name: "Cloudflare AI Gateway", kind: "api-key", description: "Recent frontier models through Cloudflare AI Gateway", defaultModel: "openai/gpt-5.4-mini" },
  { id: "ollama", runtimeId: "ollama", name: "Ollama", kind: "local", description: "Local models from Ollama", defaultModel: "qwen3", defaultBaseUrl: "http://localhost:11434/v1" },
  { id: "lm-studio", runtimeId: "lm-studio", name: "LM Studio", kind: "local", description: "Local models from LM Studio", defaultModel: "local-model", defaultBaseUrl: "http://localhost:1234/v1" },
  { id: "custom", runtimeId: "custom", name: "Add custom provider", kind: "custom", description: "Add an OpenAI-compatible provider", defaultModel: "my-model", defaultBaseUrl: "https://example.com/v1" },
];

/** pi-ai's model catalog is a snapshot taken when the package was published, and
 *  ChatGPT ships Codex tiers faster than pi-ai republishes — 0.73.1 still stops
 *  at GPT-5.5, so the picker was offering a subscription less than it can run.
 *  These are the tiers ChatGPT's own `/backend-api/codex/models` currently
 *  returns with `visibility: "list"`, in the priority order it sorts them by.
 *  Merged over the bundled catalog rather than replacing it, so an id pi-ai
 *  learns about later keeps pi-ai's own entry and this list can just shrink.
 *  Per-token cost is not published for these tiers; the nearest tier pi-ai does
 *  price stands in, which only affects the spend estimate shown for a turn. */
const codexTiers: Model<Api>[] = [
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 } },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 } },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 } },
].map((tier) => ({
  ...tier,
  api: "openai-codex-responses" as const,
  provider: "openai-codex",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  thinkingLevelMap: { xhigh: "xhigh", minimal: "low" },
  input: ["text", "image"],
  contextWindow: 272_000,
  maxTokens: 128_000,
}));

const descriptorById = new Map(descriptors.map((item) => [item.id, item]));
const oauthRuntimeId = (id: ProviderId) => id === "claude-code" ? "anthropic" : id;
/** Spar's own gateway is the only credential the learner does not hold; it is
 *  off unless the build enables it, so it is never a silent stand-in. */
const gatewayEnabled = () => process.env.SPAR_AI_GATEWAY_ENABLED === "true";
/** Matches the hover card's own staleness: a quota that moves once per turn does
 *  not need re-fetching every time the pointer crosses the row. */
const USAGE_CACHE_MS = 60_000;
/** Which models Cline promotes and bills at nothing is a promotion, not a
 *  release, so it is re-read through the day — but nowhere near as often as the
 *  composer re-reads the inventory that shows it. */
const CLINE_TIERS_CACHE_MS = 6 * 60 * 60 * 1_000;
const modelsFor = (provider: string) => {
  let bundled: Model<Api>[] = [];
  try { bundled = (getModels as unknown as (id: string) => Model<Api>[])(provider); } catch { bundled = []; }
  if (provider !== "openai-codex") return bundled;
  return [...codexTiers.filter((tier) => !bundled.some((model) => model.id === tier.id)), ...bundled];
};

export class ProviderService {
  private readonly flows = new Map<string, { providerId: ProviderId; controller: AbortController; prompt: { resolve(value: string): void; reject(error: Error): void } | undefined }>();

  constructor(
    private readonly auth: AuthService,
    private readonly store: LocalStore,
    private readonly emit: (event: ProviderOAuthEvent) => void,
    /** Only Cline's tier list is read over the network from here. Injected so a
     *  test exercises the catalog it seeds with rather than today's promotion. */
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** Every provider's model catalog. pi-ai answers for the ones it ships;
   *  Cline's is assembled from its own tier list — see clineCatalog.ts. */
  private catalog(runtimeId: string): Model<Api>[] {
    return runtimeId === "cline" ? clineModels(this.clineTiers()) : modelsFor(runtimeId);
  }

  private clineTiers(): ClineTiers {
    return this.store.getSetting<ClineTiers>("provider-tiers:cline", clineSeedTiers);
  }

  /** Deliberately not awaited by its caller: the inventory is re-read on every
   *  composer mount, and which models are free must never be what a turn waits
   *  on. The attempt is stamped before it resolves, so a Cline that cannot be
   *  reached is asked once per window rather than on every mount. */
  private refreshClineTiers() {
    const attemptedAt = this.store.getSetting<number>("provider-tiers-at:cline", 0);
    if (Date.now() - attemptedAt < CLINE_TIERS_CACHE_MS) return;
    this.store.setSetting("provider-tiers-at:cline", Date.now());
    void fetchClineTiers(this.fetcher)
      .then((tiers) => { if (tiers) this.store.setSetting("provider-tiers:cline", tiers); })
      .catch(() => undefined);
  }

  async inventory(): Promise<ProviderInventory> {
    this.refreshClineTiers();
    const selectedProvider = this.store.getSetting<ProviderId>("provider-id", "openrouter");
    const selectedModel = this.store.getSetting("provider-model", descriptorById.get(selectedProvider)?.defaultModel ?? "openrouter/free");
    const providers = await Promise.all(descriptors.map(async (descriptor) => {
      const connected = await this.hasCredential(descriptor);
      const authExpired = descriptor.kind === "subscription"
        && this.store.getSetting<boolean>(`provider-auth-expired:${descriptor.id}`, false);
      const storedModel = this.store.getSetting<string>(`provider-model:${descriptor.id}`, descriptor.defaultModel);
      const storedBaseUrl = this.store.getSetting<string>(`provider-base-url:${descriptor.id}`, descriptor.defaultBaseUrl ?? "");
      const catalog = this.catalog(descriptor.runtimeId);
      return {
        id: descriptor.id,
        name: descriptor.name,
        description: descriptor.description,
        kind: descriptor.kind,
        state: connected ? (authExpired ? "auth-expired" as const : "connected" as const) : "disconnected" as const,
        selectedModel: storedModel,
        baseUrl: storedBaseUrl || catalog.find((model) => model.id === storedModel)?.baseUrl || catalog[0]?.baseUrl || "",
        ...(descriptor.keyUrl ? { keyUrl: descriptor.keyUrl } : {}),
        models: catalog.map((model) => ({ id: model.id, name: model.name, reasoning: model.reasoning })),
      };
    }));
    return { providers, ready: await this.available(), defaultModel: { provider: selectedProvider, model: selectedModel, reasoningEffort: this.reasoningEffort() } };
  }

  /** Whether a turn can run right now. Decided from credential presence only —
   *  the composer asks this on every mount, so it must not refresh an OAuth
   *  token — but from the same selected provider `resolve` will actually use.
   *  Nothing else answers: a provider the learner never connected must never be
   *  quietly borrowed to make a turn look like it worked. */
  async available(): Promise<boolean> {
    if (gatewayEnabled()) return true;
    const selected = this.store.getSetting<ProviderId>("provider-id", "openrouter");
    const descriptor = descriptorById.get(selected);
    if (!descriptor) return false;
    if (descriptor.kind === "subscription" && this.store.getSetting<boolean>(`provider-auth-expired:${selected}`, false)) return false;
    return this.hasCredential(descriptor);
  }

  /** A local runtime holds no secret, so "connected" is the learner having added
   *  it rather than a key existing — otherwise Ollama reads as disconnected in
   *  Settings while `resolve` happily runs turns through it. */
  private async hasCredential(descriptor: Descriptor): Promise<boolean> {
    if (descriptor.kind === "subscription") return !!await this.auth.readProviderOAuth(descriptor.id);
    if (descriptor.kind === "local") return this.store.getSetting<boolean>(`provider-connected:${descriptor.id}`, false);
    return !!await this.auth.readSecret(descriptor.id);
  }

  /** The Codex rate-limit headers the agent worker saw on a turn. Kept because
   *  ChatGPT reports quota nowhere else, so the last turn's headers are the
   *  only reading that exists between turns. */
  recordCodexRateLimits(headers: Record<string, string>) {
    const usage = codexUsageFromHeaders(headers);
    if (usage) this.store.setSetting("provider-usage:openai-codex", usage);
  }

  /** Deliberately not part of `inventory`: Claude's reading is a network call
   *  that refreshes an OAuth token, and inventory is re-read on every composer
   *  mount. The renderer asks for this separately, and only while looking. */
  async subscriptionUsage(providerId: ProviderId): Promise<SubscriptionUsage | null> {
    if (providerId === "openai-codex") return this.store.getSetting<SubscriptionUsage | null>("provider-usage:openai-codex", null);
    if (providerId !== "claude-code") return null;
    const cached = this.store.getSetting<SubscriptionUsage | null>("provider-usage:claude-code", null);
    if (cached && Date.now() - cached.capturedAt < USAGE_CACHE_MS) return cached;
    try {
      const credentials = await this.auth.readProviderOAuth<OAuthCredentials>("claude-code");
      if (!credentials) return null;
      const result = await getOAuthApiKey("anthropic", { anthropic: credentials });
      if (!result) return cached;
      if (JSON.stringify(result.newCredentials) !== JSON.stringify(credentials)) await this.auth.saveProviderOAuth("claude-code", result.newCredentials);
      const usage = await anthropicUsage(result.apiKey);
      if (!usage) return cached;
      this.store.setSetting("provider-usage:claude-code", usage);
      return usage;
    } catch {
      // A quota reading is decoration. It must never be the reason Settings
      // reports a working subscription as broken.
      return cached;
    }
  }

  reasoningEffort(): ReasoningEffort {
    return this.store.getSetting<ReasoningEffort>("reasoning-effort", "off");
  }

  setReasoningEffort(effort: ReasoningEffort) {
    this.store.setSetting("reasoning-effort", effort);
  }

  async saveCredential(input: { provider: ProviderId; model: string; baseUrl?: string; secret?: string }) {
    const descriptor = descriptorById.get(input.provider);
    if (!descriptor || descriptor.kind === "subscription") throw new Error("This provider uses subscription sign-in");
    const secret = input.secret?.trim() ?? "";
    if (descriptor.kind === "api-key" && secret.length < 1 && !await this.auth.readSecret(input.provider)) throw new Error("API key is required");
    if (secret) await this.auth.saveSecret(input.provider, secret);
    this.store.setSetting(`provider-auth-expired:${input.provider}`, false);
    if (descriptor.kind === "local") this.store.setSetting(`provider-connected:${input.provider}`, true);
    this.select(input.provider, input.model, input.baseUrl);
  }

  async disconnect(providerId: ProviderId) {
    await Promise.all([this.auth.deleteSecret(providerId), this.auth.deleteProviderOAuth(providerId)]);
    this.store.setSetting(`provider-auth-expired:${providerId}`, false);
    this.store.setSetting(`provider-connected:${providerId}`, false);
    if (this.store.getSetting<ProviderId>("provider-id", "openrouter") === providerId) {
      const inventory = await this.inventory();
      const connectedId = inventory.providers.find((item) => item.state === "connected")?.id;
      const fallback = descriptorById.get(connectedId ?? "openrouter");
      if (fallback) this.select(fallback.id, fallback.defaultModel, fallback.defaultBaseUrl);
    }
  }

  setDefault(providerId: ProviderId, model: string) {
    const descriptor = descriptorById.get(providerId);
    if (!descriptor) throw new Error("Unknown provider");
    const known = this.catalog(descriptor.runtimeId);
    if (known.length && !known.some((item) => item.id === model)) throw new Error("That model is not available for this provider");
    this.select(providerId, model);
  }

  startOAuth(providerId: ProviderId) {
    const runtimeId = oauthRuntimeId(providerId);
    const provider = getOAuthProvider(runtimeId);
    if (!provider || descriptorById.get(providerId)?.kind !== "subscription") throw new Error("Subscription sign-in is not available for this provider");
    const flowId = randomUUID();
    const controller = new AbortController();
    this.flows.set(flowId, { providerId, controller, prompt: undefined });
    this.emit({ flowId, provider: providerId, status: "starting", message: `Starting ${provider.name} sign-in…` });
    void provider.login({
      signal: controller.signal,
      onAuth: (info) => {
        this.emit({ flowId, provider: providerId, status: "waiting", url: info.url, message: info.instructions ?? "Finish signing in in your browser." });
        void shell.openExternal(info.url);
      },
      onProgress: (message) => this.emit({ flowId, provider: providerId, status: "waiting", message }),
      onPrompt: (prompt) => new Promise<string>((resolve, reject) => {
        const flow = this.flows.get(flowId);
        if (!flow) return reject(new Error("OAuth flow was cancelled"));
        flow.prompt = { resolve, reject };
        this.emit({ flowId, provider: providerId, status: "prompt", message: prompt.message, ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}), ...(prompt.allowEmpty !== undefined ? { allowEmpty: prompt.allowEmpty } : {}) });
      }),
    }).then(async (credentials) => {
      if (controller.signal.aborted) return;
      await this.auth.saveProviderOAuth(providerId, credentials);
      this.store.setSetting(`provider-auth-expired:${providerId}`, false);
      const descriptor = descriptorById.get(providerId)!;
      this.select(providerId, descriptor.defaultModel);
      this.emit({ flowId, provider: providerId, status: "connected", message: `${descriptor.name} connected` });
    }).catch((error) => {
      if (!controller.signal.aborted) this.emit({ flowId, provider: providerId, status: "error", message: safeError(error) });
    }).finally(() => this.flows.delete(flowId));
    return { flowId };
  }

  submitOAuth(flowId: string, value: string) {
    const flow = this.flows.get(flowId);
    if (!flow?.prompt) throw new Error("This sign-in flow is not waiting for input");
    const prompt = flow.prompt;
    flow.prompt = undefined;
    prompt.resolve(value.trim());
  }

  cancelOAuth(flowId: string) {
    const flow = this.flows.get(flowId);
    if (!flow) return;
    flow.controller.abort();
    flow.prompt?.reject(new Error("OAuth flow cancelled"));
    this.flows.delete(flowId);
    this.emit({ flowId, provider: flow.providerId, status: "cancelled", message: "Sign-in cancelled" });
  }

  async resolve(_accountId: string, accessToken: string | null): Promise<ResolvedProvider[]> {
    const values: ResolvedProvider[] = [];
    const selected = this.store.getSetting<ProviderId>("provider-id", "openrouter");
    const selectedDescriptor = descriptorById.get(selected);
    if (selectedDescriptor?.kind === "subscription") {
      const credentials = await this.auth.readProviderOAuth<OAuthCredentials>(selected);
      if (credentials) {
        try {
          const runtimeId = oauthRuntimeId(selected);
          const result = await getOAuthApiKey(runtimeId, { [runtimeId]: credentials });
          if (result) {
            if (JSON.stringify(result.newCredentials) !== JSON.stringify(credentials)) await this.auth.saveProviderOAuth(selected, result.newCredentials);
            this.store.setSetting(`provider-auth-expired:${selected}`, false);
            const modelId = this.store.getSetting(`provider-model:${selected}`, selectedDescriptor.defaultModel);
            const provider = getOAuthProvider(runtimeId);
            const available = provider?.modifyModels?.(this.catalog(runtimeId), result.newCredentials) ?? this.catalog(runtimeId);
            const model = available.find((item) => item.id === modelId) ?? available[0];
            if (model) values.push({ provider: model.provider, model: model.id, api: model.api, baseUrl: model.baseUrl, apiKey: result.apiKey, ...(model.headers ? { headers: model.headers } : {}), source: "spar-oauth", reasoningEffort: this.reasoningEffort() });
          } else {
            this.store.setSetting(`provider-auth-expired:${selected}`, true);
          }
        } catch {
          // A stale subscription must not prevent Construct-import or Spar gateway fallback.
          this.store.setSetting(`provider-auth-expired:${selected}`, true);
        }
      }
    } else if (selectedDescriptor) {
      const secret = await this.auth.readSecret(selected);
      if (secret || await this.hasCredential(selectedDescriptor)) {
        const modelId = this.store.getSetting(`provider-model:${selected}`, selectedDescriptor.defaultModel);
        const model = this.catalog(selectedDescriptor.runtimeId).find((item) => item.id === modelId);
        const baseUrl = this.store.getSetting(`provider-base-url:${selected}`, selectedDescriptor.defaultBaseUrl ?? model?.baseUrl ?? "");
        values.push({ provider: model?.provider ?? selectedDescriptor.runtimeId, model: modelId, api: model?.api ?? "openai-completions", baseUrl: baseUrl || model?.baseUrl || "", apiKey: secret ?? "local", ...(model?.headers ? { headers: model.headers } : {}), source: "spar-keychain", reasoningEffort: this.reasoningEffort() });
      }
    }

    // The selected provider is authoritative. Silently switching a Training
    // Agent turn to unrelated credentials changes model behavior and billing,
    // and made a ChatGPT transport failure look like four separate failures.
    if (values.length) return dedupe(values);

    // Nothing the learner connected can serve this turn. The only remaining
    // credential is Spar's own gateway, and it is off unless the build turns it
    // on — an unconnected Spar resolves to nothing at all, and says so, rather
    // than reaching for a key it found lying around on the machine.
    if (accessToken && gatewayEnabled()) values.push({ provider: "spar-gateway", model: "spar-training", api: "openai-completions", baseUrl: `${apiOrigin()}/v1/ai`, apiKey: accessToken, source: "gateway", reasoningEffort: this.reasoningEffort() });
    return dedupe(values);
  }

  private select(providerId: ProviderId, model: string, baseUrl?: string) {
    this.store.setSetting("provider-id", providerId);
    this.store.setSetting("provider-model", model);
    this.store.setSetting(`provider-model:${providerId}`, model);
    if (baseUrl?.trim()) this.store.setSetting(`provider-base-url:${providerId}`, baseUrl.replace(/\/$/, ""));
  }
}

function dedupe(values: ResolvedProvider[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = `${value.provider}:${value.baseUrl}:${value.model}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function safeError(value: unknown) {
  return (value instanceof Error ? value.message : String(value))
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\b(access_token|refresh_token|id_token)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 500);
}
