import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { AuthService } from "./auth.js";
import type { LocalStore } from "./store.js";

export const providerIds = ["openai", "openrouter", "opencode-go", "opencode-zen", "litellm"] as const;
export type ProviderId = (typeof providerIds)[number];
export type ResolvedProvider = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  source: "practice-keychain" | "construct-import" | "gateway";
};

export async function resolveProviders(
  auth: AuthService,
  store: LocalStore,
  _accountId: string,
  accessToken: string | null,
): Promise<ResolvedProvider[]> {
  const values: ResolvedProvider[] = [];
  const selected = store.getSetting<ProviderId>("provider-id", "openrouter");
  const own = await auth.readSecret(selected);

  if (own) {
    return [{
      provider: selected,
      model: store.getSetting("provider-model", selected === "openrouter" ? "openrouter/free" : selected === "opencode-go" ? "gpt-5.6-luna" : "gpt-4.1"),
      baseUrl: store.getSetting("provider-base-url", selected === "openrouter" ? "https://openrouter.ai/api/v1" : selected === "opencode-go" ? "https://opencode.ai/zen/go/v1" : "https://api.openai.com/v1"),
      apiKey: own,
      source: "practice-keychain",
    }];
  }

  values.push(...await readConstructProviders());
  if (accessToken) {
    values.push({
      provider: "practice-gateway",
      model: "practice-training",
      baseUrl: `${process.env.PRACTICE_API_ORIGIN ?? "http://localhost:4318"}/v1/ai`,
      apiKey: accessToken,
      source: "gateway",
    });
  }
  return dedupe(values);
}

async function readConstructProviders(): Promise<ResolvedProvider[]> {
  try {
    const raw = await readFile(path.join(homedir(), "Library", "Application Support", "Construct", "construct.config.json"), "utf8");
    const ai = (JSON.parse(raw) as { ai?: Record<string, unknown> }).ai ?? {};
    if (ai.source !== "byok") return [];
    const selected = String(ai.provider ?? "");
    const configs: Record<string, { key: string; model: string; baseUrl: string }> = {
      openai: { key: "openAiApiKey", model: "openAiModel", baseUrl: "openAiBaseUrl" },
      openrouter: { key: "openRouterApiKey", model: "openRouterModel", baseUrl: "openRouterBaseUrl" },
      "opencode-zen": { key: "opencodeZenApiKey", model: "opencodeZenModel", baseUrl: "opencodeZenBaseUrl" },
      litellm: { key: "liteLlmApiKey", model: "liteLlmModel", baseUrl: "liteLlmBaseUrl" },
    };
    const values = [selected, ...Object.keys(configs).filter((name) => name !== selected)].flatMap((provider) => {
      const config = configs[provider];
      if (!config) return [];
      const apiKey = String(ai[config.key] ?? "").trim();
      const model = String(ai[config.model] ?? "").trim();
      const baseUrl = String(ai[config.baseUrl] ?? "").trim();
      return apiKey && model && baseUrl ? [{ provider, model, baseUrl, apiKey, source: "construct-import" as const }] : [];
    });
    const openrouter = values.find((value) => value.provider === "openrouter");
    if (openrouter && openrouter.model !== "openrouter/free") values.push({ ...openrouter, model: "openrouter/free" });
    return values;
  } catch {
    return [];
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
