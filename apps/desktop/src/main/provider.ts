import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { shell } from "electron";
import { getModels, type Api, type Model, type OAuthCredentials } from "@mariozechner/pi-ai";
import { getOAuthApiKey, getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import type { AuthService } from "./auth.js";
import type { LocalStore } from "./store.js";
import type { ProviderInventory, ProviderOAuthEvent } from "../shared/api.js";

export const providerIds = [
  "openai-codex", "claude-code", "github-copilot", "openai", "anthropic", "google", "xai",
  "openrouter", "opencode", "opencode-go", "deepseek", "minimax", "moonshotai", "kimi-coding",
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
  source: "spar-keychain" | "spar-oauth" | "construct-import" | "gateway";
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
  { id: "openai-codex", runtimeId: "openai-codex", name: "ChatGPT", kind: "subscription", description: "Reuse your ChatGPT Plus or Pro subscription", defaultModel: "gpt-5.5" },
  { id: "claude-code", runtimeId: "anthropic", name: "Claude", kind: "subscription", description: "Reuse your Claude Pro or Max subscription", defaultModel: "claude-sonnet-4-6" },
  { id: "github-copilot", runtimeId: "github-copilot", name: "GitHub Copilot", kind: "subscription", description: "Reuse your GitHub Copilot subscription", defaultModel: "gpt-5.4" },
  { id: "openai", runtimeId: "openai", name: "OpenAI", kind: "api-key", description: "OpenAI API models", defaultModel: "gpt-5.4-mini", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", runtimeId: "anthropic", name: "Anthropic", kind: "api-key", description: "Claude models", defaultModel: "claude-sonnet-4-6", keyUrl: "https://platform.claude.com/settings/keys" },
  { id: "google", runtimeId: "google", name: "Google", kind: "api-key", description: "Gemini models", defaultModel: "gemini-3-flash-preview", keyUrl: "https://aistudio.google.com/api-keys" },
  { id: "xai", runtimeId: "xai", name: "SpaceXAI", kind: "api-key", description: "Grok models", defaultModel: "grok-4.1-fast", keyUrl: "https://console.x.ai/" },
  { id: "openrouter", runtimeId: "openrouter", name: "OpenRouter", kind: "api-key", description: "Use models through OpenRouter", defaultModel: "openrouter/free", keyUrl: "https://openrouter.ai/settings/keys" },
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
const modelsFor = (provider: string) => {
  try { return (getModels as unknown as (id: string) => Model<Api>[])(provider); } catch { return []; }
};

export class ProviderService {
  private readonly flows = new Map<string, { providerId: ProviderId; controller: AbortController; prompt: { resolve(value: string): void; reject(error: Error): void } | undefined }>();

  constructor(
    private readonly auth: AuthService,
    private readonly store: LocalStore,
    private readonly emit: (event: ProviderOAuthEvent) => void,
  ) {}

  async inventory(): Promise<ProviderInventory> {
    const selectedProvider = this.store.getSetting<ProviderId>("provider-id", "openrouter");
    const selectedModel = this.store.getSetting("provider-model", descriptorById.get(selectedProvider)?.defaultModel ?? "openrouter/free");
    const providers = await Promise.all(descriptors.map(async (descriptor) => {
      const connected = descriptor.kind === "subscription"
        ? !!await this.auth.readProviderOAuth(descriptor.id)
        : !!await this.auth.readSecret(descriptor.id);
      const authExpired = descriptor.kind === "subscription"
        && this.store.getSetting<boolean>(`provider-auth-expired:${descriptor.id}`, false);
      const storedModel = this.store.getSetting<string>(`provider-model:${descriptor.id}`, descriptor.defaultModel);
      const storedBaseUrl = this.store.getSetting<string>(`provider-base-url:${descriptor.id}`, descriptor.defaultBaseUrl ?? "");
      const catalog = modelsFor(descriptor.runtimeId);
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
    return { providers, defaultModel: { provider: selectedProvider, model: selectedModel } };
  }

  async saveCredential(input: { provider: ProviderId; model: string; baseUrl?: string; secret?: string }) {
    const descriptor = descriptorById.get(input.provider);
    if (!descriptor || descriptor.kind === "subscription") throw new Error("This provider uses subscription sign-in");
    const secret = input.secret?.trim() ?? "";
    if (descriptor.kind === "api-key" && secret.length < 1 && !await this.auth.readSecret(input.provider)) throw new Error("API key is required");
    if (secret) await this.auth.saveSecret(input.provider, secret);
    this.store.setSetting(`provider-auth-expired:${input.provider}`, false);
    this.select(input.provider, input.model, input.baseUrl);
  }

  async disconnect(providerId: ProviderId) {
    await Promise.all([this.auth.deleteSecret(providerId), this.auth.deleteProviderOAuth(providerId)]);
    this.store.setSetting(`provider-auth-expired:${providerId}`, false);
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
    const known = modelsFor(descriptor.runtimeId);
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
            const available = provider?.modifyModels?.(modelsFor(runtimeId), result.newCredentials) ?? modelsFor(runtimeId);
            const model = available.find((item) => item.id === modelId) ?? available[0];
            if (model) values.push({ provider: model.provider, model: model.id, api: model.api, baseUrl: model.baseUrl, apiKey: result.apiKey, ...(model.headers ? { headers: model.headers } : {}), source: "spar-oauth" });
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
      if (secret || selectedDescriptor.kind === "local") {
        const modelId = this.store.getSetting(`provider-model:${selected}`, selectedDescriptor.defaultModel);
        const model = modelsFor(selectedDescriptor.runtimeId).find((item) => item.id === modelId);
        const baseUrl = this.store.getSetting(`provider-base-url:${selected}`, selectedDescriptor.defaultBaseUrl ?? model?.baseUrl ?? "");
        values.push({ provider: model?.provider ?? selectedDescriptor.runtimeId, model: modelId, api: model?.api ?? "openai-completions", baseUrl: baseUrl || model?.baseUrl || "", apiKey: secret ?? "local", ...(model?.headers ? { headers: model.headers } : {}), source: "spar-keychain" });
      }
    }

    // The selected provider is authoritative. Silently switching a Training
    // Agent turn to unrelated credentials changes model behavior and billing,
    // and made a ChatGPT transport failure look like four separate failures.
    if (values.length) return dedupe(values);

    values.push(...await readConstructProviders());
    if (accessToken && process.env.SPAR_AI_GATEWAY_ENABLED === "true") values.push({ provider: "spar-gateway", model: "spar-training", api: "openai-completions", baseUrl: `${process.env.SPAR_API_ORIGIN ?? "http://localhost:4318"}/v1/ai`, apiKey: accessToken, source: "gateway" });
    return dedupe(values);
  }

  private select(providerId: ProviderId, model: string, baseUrl?: string) {
    this.store.setSetting("provider-id", providerId);
    this.store.setSetting("provider-model", model);
    this.store.setSetting(`provider-model:${providerId}`, model);
    if (baseUrl?.trim()) this.store.setSetting(`provider-base-url:${providerId}`, baseUrl.replace(/\/$/, ""));
  }
}

async function readConstructProviders(): Promise<ResolvedProvider[]> {
  try {
    const raw = await readFile(path.join(homedir(), "Library", "Application Support", "Construct", "construct.config.json"), "utf8");
    const ai = (JSON.parse(raw) as { ai?: Record<string, unknown> }).ai ?? {};
    if (ai.source !== "byok") return [];
    const selected = String(ai.provider ?? "");
    const configs: Record<string, { runtime: string; key: string; model: string; baseUrl: string }> = {
      openai: { runtime: "openai", key: "openAiApiKey", model: "openAiModel", baseUrl: "openAiBaseUrl" },
      openrouter: { runtime: "openrouter", key: "openRouterApiKey", model: "openRouterModel", baseUrl: "openRouterBaseUrl" },
      "opencode-zen": { runtime: "opencode", key: "opencodeZenApiKey", model: "opencodeZenModel", baseUrl: "opencodeZenBaseUrl" },
      litellm: { runtime: "litellm", key: "liteLlmApiKey", model: "liteLlmModel", baseUrl: "liteLlmBaseUrl" },
    };
    return [selected, ...Object.keys(configs).filter((name) => name !== selected)].flatMap((provider) => {
      const config = configs[provider];
      if (!config) return [];
      const apiKey = String(ai[config.key] ?? "").trim();
      const modelId = String(ai[config.model] ?? "").trim();
      const baseUrl = String(ai[config.baseUrl] ?? "").trim();
      const model = modelsFor(config.runtime).find((item) => item.id === modelId);
      return apiKey && modelId && baseUrl ? [{ provider: config.runtime, model: modelId, api: model?.api ?? "openai-completions", baseUrl, apiKey, source: "construct-import" as const }] : [];
    });
  } catch { return []; }
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
