import { randomUUID } from "node:crypto";
import { shell } from "electron";
import type { AuthEvent, AuthPrompt, Api, Model, MutableModels, OAuthCredentials } from "@earendil-works/pi-ai";
import { apiOrigin } from "./apiOrigin.js";
import type { AuthService } from "./auth.js";
import { LiveModels } from "./liveModels.js";
import { createSparModels } from "./piModels.js";
import type { LocalStore } from "./store.js";
import { anthropicAccount, codexAccountFromToken, githubAccount, type ProviderAccount } from "./subscriptionAccount.js";
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
  fastMode: boolean;
  modelInfo?: Model<Api>;
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
  { id: "openai-codex", runtimeId: "openai-codex", name: "ChatGPT", kind: "subscription", description: "Reuse your ChatGPT Plus or Pro subscription", defaultModel: "gpt-6-sol" },
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

const descriptorById = new Map(descriptors.map((item) => [item.id, item]));
const oauthRuntimeId = (id: ProviderId) => id === "claude-code" ? "anthropic" : id;
/** Spar's own gateway is the only credential the learner does not hold; it is
 *  off unless the build enables it, so it is never a silent stand-in. */
const gatewayEnabled = () => process.env.SPAR_AI_GATEWAY_ENABLED === "true";
/** Matches the hover card's own staleness: a quota that moves once per turn does
 *  not need re-fetching every time the pointer crosses the row. */
const USAGE_CACHE_MS = 60_000;
/** Which account a subscription is signed in as changes only when the learner
 *  reconnects it — and the reconnect clears the entry itself — so this is long
 *  enough that hovering a row never costs a round trip, and short enough that a
 *  sign-in done outside Spar is picked up the same day. */
const ACCOUNT_CACHE_MS = 12 * 60 * 60 * 1_000;
/** Which models Cline promotes and bills at nothing is a promotion, not a
 *  release, so it is re-read through the day — but nowhere near as often as the
 *  composer re-reads the inventory that shows it. */
const CLINE_TIERS_CACHE_MS = 6 * 60 * 60 * 1_000;
export class ProviderService {
  private readonly flows = new Map<string, { providerId: ProviderId; controller: AbortController; prompt: { resolve(value: string): void; reject(error: Error): void } | undefined }>();
  /** pi's runtime collection, reading and writing the learner's tokens through
   *  Spar's own keychain — see piModels.ts. Holds no state of its own beyond
   *  the provider catalog, so one per service is enough. */
  private readonly models: MutableModels;
  private readonly liveModels: LiveModels;

  constructor(
    private readonly auth: AuthService,
    private readonly store: LocalStore,
    private readonly emit: (event: ProviderOAuthEvent) => void,
    /** Only Cline's tier list is read over the network from here. Injected so a
     *  test exercises the catalog it seeds with rather than today's promotion. */
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.models = createSparModels(auth);
    this.liveModels = new LiveModels(fetcher);
  }

  /** Every provider's model catalog. pi-ai answers for the ones it ships;
   *  Cline's is assembled from its own tier list — see clineCatalog.ts. */
  private catalog(runtimeId: string): Model<Api>[] {
    return runtimeId === "cline" ? clineModels(this.clineTiers()) : this.liveModels.get(runtimeId);
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
    await this.liveModels.refresh();
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
    return { providers, ready: await this.available(), defaultModel: { provider: selectedProvider, model: selectedModel, reasoningEffort: this.reasoningEffort(), fastMode: this.fastMode() } };
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
      if (!await this.auth.readProviderOAuth("claude-code")) return null;
      /* Refresh and the rotated token's persistence are pi's now, and they run
         inside the store's per-provider lock — so a quota reading taken while a
         turn is starting can no longer race it to write the same entry. */
      const resolved = await this.models.getAuth("anthropic");
      if (!resolved?.auth.apiKey) return cached;
      const usage = await anthropicUsage(resolved.auth.apiKey);
      if (!usage) return cached;
      this.store.setSetting("provider-usage:claude-code", usage);
      return usage;
    } catch {
      // A quota reading is decoration. It must never be the reason Settings
      // reports a working subscription as broken.
      return cached;
    }
  }

  /** Which account a connected subscription belongs to, for the hover on its
   *  Settings row. Cached rather than read per hover: two of the three answers
   *  are network calls, and the row is hovered far more often than the account
   *  behind it changes. Nothing here throws — a row with no label is the
   *  intended outcome for a provider that will not say. */
  async subscriptionAccount(providerId: ProviderId): Promise<ProviderAccount | null> {
    const descriptor = descriptorById.get(providerId);
    if (!descriptor || descriptor.kind !== "subscription") return null;
    const key = `provider-account:${providerId}`;
    const cached = this.store.getSetting<{ account: ProviderAccount | null; capturedAt: number } | null>(key, null);
    if (cached && Date.now() - cached.capturedAt < ACCOUNT_CACHE_MS) return cached.account;
    const account = await this.readAccount(providerId).catch(() => null);
    /* A miss is cached too. The providers that answer with nothing answer with
       nothing every time, and re-asking on every mount would be a request per
       hover for a label that is never coming. */
    this.store.setSetting(key, { account, capturedAt: Date.now() });
    return account;
  }

  private async readAccount(providerId: ProviderId): Promise<ProviderAccount | null> {
    if (providerId === "github-copilot") {
      /* The stored `refresh` is the GitHub OAuth token, not a refresh token in
         the usual sense — it is what identifies the person, and the `access`
         beside it is a Copilot proxy token that identifies nobody. */
      const credential = await this.auth.readProviderOAuth<{ refresh?: string }>(providerId);
      return credential?.refresh ? await githubAccount(credential.refresh) : null;
    }
    if (providerId !== "claude-code" && providerId !== "openai-codex") return null;
    if (!await this.auth.readProviderOAuth(providerId)) return null;
    /* Through pi so the token is refreshed under the store's per-provider lock,
       the same way the quota reading takes it — an expired access token would
       otherwise read as an account that does not exist. */
    const resolved = await this.models.getAuth(oauthRuntimeId(providerId));
    const token = resolved?.auth.apiKey;
    if (!token) return null;
    return providerId === "claude-code" ? await anthropicAccount(token) : codexAccountFromToken(token);
  }

  reasoningEffort(): ReasoningEffort {
    return this.store.getSetting<ReasoningEffort>("reasoning-effort", "off");
  }

  setReasoningEffort(effort: ReasoningEffort) {
    this.store.setSetting("reasoning-effort", effort);
  }

  /* Fast mode is one preference, not one per provider: it says how the learner
     wants their turns served, and a setting that silently reverted every time
     they switched model would be a worse answer than a setting the model
     happens not to honour. */
  fastMode(): boolean {
    return this.store.getSetting<boolean>("fast-mode", false);
  }

  setFastMode(enabled: boolean) {
    this.store.setSetting("fast-mode", enabled);
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
    this.store.setSetting(`provider-account:${providerId}`, null);
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
    const oauth = this.models.getProvider(runtimeId)?.auth.oauth;
    if (!oauth || descriptorById.get(providerId)?.kind !== "subscription") throw new Error("Subscription sign-in is not available for this provider");
    const flowId = randomUUID();
    const controller = new AbortController();
    this.flows.set(flowId, { providerId, controller, prompt: undefined });
    this.emit({ flowId, provider: providerId, status: "starting", message: `Starting ${oauth.name} sign-in…` });
    void this.models.login(runtimeId, "oauth", {
      signal: controller.signal,
      notify: (event) => this.announce(flowId, providerId, event),
      prompt: (prompt) => this.ask(flowId, providerId, prompt),
    }).then(async () => {
      if (controller.signal.aborted) return;
      /* No save here: `login` persists what it returns through the credential
         store, which is Spar's keychain under this same provider id. */
      this.store.setSetting(`provider-auth-expired:${providerId}`, false);
      /* Whoever just signed in may not be who signed in last time, so the label
         is dropped rather than left to expire on its own clock. */
      this.store.setSetting(`provider-account:${providerId}`, null);
      const descriptor = descriptorById.get(providerId)!;
      this.select(providerId, descriptor.defaultModel);
      this.emit({ flowId, provider: providerId, status: "connected", message: `${descriptor.name} connected` });
    }).catch((error) => {
      if (!controller.signal.aborted) this.emit({ flowId, provider: providerId, status: "error", message: safeError(error) });
    }).finally(() => this.flows.delete(flowId));
    return { flowId };
  }

  /** What the flow wants the learner to see. `auth_url` and `device_code` are
   *  the two ways a provider hands off to the browser — Claude and ChatGPT open
   *  a page, GitHub Copilot reads out a code to type into one — and both end up
   *  as the same waiting row with a link. */
  private announce(flowId: string, providerId: ProviderId, event: AuthEvent) {
    if (event.type === "auth_url") {
      this.emit({ flowId, provider: providerId, status: "waiting", url: event.url, message: event.instructions ?? "Finish signing in in your browser." });
      void shell.openExternal(event.url);
      return;
    }
    if (event.type === "device_code") {
      this.emit({ flowId, provider: providerId, status: "waiting", url: event.verificationUri, message: `Enter the code ${event.userCode} in your browser to finish signing in.` });
      void shell.openExternal(event.verificationUri);
      return;
    }
    this.emit({ flowId, provider: providerId, status: "waiting", message: event.message });
  }

  /** What the flow wants the learner to answer.
   *
   *  A `select` never reaches them. The only provider that asks is ChatGPT,
   *  choosing between browser sign-in and headless device-code sign-in, and
   *  Spar is a desktop app with a browser — asking the learner to pick would be
   *  asking them to answer a question about Spar's own deployment. The default,
   *  which pi lists first, is the answer. */
  private ask(flowId: string, providerId: ProviderId, prompt: AuthPrompt): Promise<string> {
    if (prompt.type === "select") return Promise.resolve(prompt.options[0]?.id ?? "");
    return new Promise<string>((resolve, reject) => {
      const flow = this.flows.get(flowId);
      if (!flow) return reject(new Error("OAuth flow was cancelled"));
      const done = <T,>(settle: (value: T) => void) => (value: T) => {
        if (flow.prompt === entry) flow.prompt = undefined;
        prompt.signal?.removeEventListener("abort", abandon);
        settle(value);
      };
      /* The prompt can be overtaken: Claude and ChatGPT offer a paste box while
         racing a loopback callback, and abort it the moment the browser wins.
         Without this the dialog would sit asking for a code that has already
         been exchanged. */
      const abandon = () => {
        done(reject)(new Error("Sign-in completed in the browser"));
        this.emit({ flowId, provider: providerId, status: "waiting", message: "Finishing sign-in…" });
      };
      const entry = { resolve: done(resolve), reject: done(reject) };
      flow.prompt = entry;
      prompt.signal?.addEventListener("abort", abandon, { once: true });
      this.emit({
        flowId, provider: providerId, status: "prompt", message: prompt.message,
        ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
        /* Only a free-text prompt takes a blank answer, and it means something
           there: Copilot asks for an Enterprise domain, and empty is github.com.
           A code or a secret blank is just an empty submission. */
        ...(prompt.type === "text" ? { allowEmpty: true } : {}),
      });
    });
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
    await this.liveModels.refresh();
    const values: ResolvedProvider[] = [];
    const selected = this.store.getSetting<ProviderId>("provider-id", "openrouter");
    const selectedDescriptor = descriptorById.get(selected);
    if (selectedDescriptor?.kind === "subscription") {
      const credentials = await this.auth.readProviderOAuth<OAuthCredentials>(selected);
      if (credentials) {
        try {
          const runtimeId = oauthRuntimeId(selected);
          const resolved = await this.models.getAuth(runtimeId);
          if (resolved?.auth.apiKey) {
            this.store.setSetting(`provider-auth-expired:${selected}`, false);
            const modelId = this.store.getSetting(`provider-model:${selected}`, selectedDescriptor.defaultModel);
            const catalog = this.catalog(runtimeId);
            /* Re-read rather than reuse: `getAuth` may have just rotated the
               token, and which models a subscription can run is decided from the
               credential — Copilot's list is the one its last login enabled. */
            const fresh = await this.auth.readProviderOAuth<OAuthCredentials>(selected);
            const provider = this.models.getProvider(runtimeId);
            const available = provider?.filterModels?.(catalog, fresh ? { type: "oauth", ...fresh } : undefined) ?? catalog;
            const model = available.find((item) => item.id === modelId) ?? available[0];
            /* pi spells "drop this header" as a null value, which is why the
               merge is filtered rather than spread straight through: the null
               has already overwritten the model's own entry by the time it is
               dropped, which is what dropping it is supposed to mean. */
            const headers = Object.fromEntries(
              Object.entries({ ...model?.headers, ...resolved.auth.headers }).filter((entry): entry is [string, string] => entry[1] !== null),
            );
            if (model) values.push({ provider: model.provider, model: model.id, api: model.api, baseUrl: resolved.auth.baseUrl ?? model.baseUrl, apiKey: resolved.auth.apiKey, ...(Object.keys(headers).length ? { headers } : {}), source: "spar-oauth", reasoningEffort: this.reasoningEffort(), fastMode: this.fastMode(), modelInfo: model });
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
        values.push({ provider: model?.provider ?? selectedDescriptor.runtimeId, model: modelId, api: model?.api ?? "openai-completions", baseUrl: baseUrl || model?.baseUrl || "", apiKey: secret ?? "local", ...(model?.headers ? { headers: model.headers } : {}), source: "spar-keychain", reasoningEffort: this.reasoningEffort(), fastMode: this.fastMode(), ...(model ? { modelInfo: model } : {}) });
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
    if (accessToken && gatewayEnabled()) values.push({ provider: "spar-gateway", model: "spar-training", api: "openai-completions", baseUrl: `${apiOrigin()}/v1/ai`, apiKey: accessToken, source: "gateway", reasoningEffort: this.reasoningEffort(), fastMode: this.fastMode() });
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
