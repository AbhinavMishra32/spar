import { getModels, type Api, type Model } from "@mariozechner/pi-ai";

/**
 * Cline is one OpenAI-compatible Chat Completions endpoint in front of every
 * lab's models — https://docs.cline.bot/api/overview — and its usage-billing
 * catalog is OpenRouter's, addressed by the same `vendor/model` ids. So the
 * models Spar offers for it are pi-ai's OpenRouter catalog re-pointed at Cline,
 * which is how Cline's own client builds its picker, rather than a second list
 * of context windows and prices pinned here to rot.
 *
 * What is genuinely Cline's own is which models it promotes and which it bills
 * at nothing. That rotates — the free tier is explicitly promotional — so it is
 * read from Cline at runtime and only seeded here.
 *
 * Shared rather than main-only because the agent worker needs the same entry:
 * pi-ai ships no Cline provider, so this module is the only thing that can tell
 * the worker how Cline expects reasoning to be expressed.
 */
export const clineBaseUrl = "https://api.cline.bot/api/v1";
/** Cline's own clients read their picker from this route and it takes no
 *  credential, which is why Spar can keep the free tier honest before the
 *  learner has connected a key — and without spending theirs to ask. */
export const clineTiersUrl = `${clineBaseUrl}/ai/cline/recommended-models`;

export type ClineModelRef = { id: string; name?: string };
/** `free` costs nothing to run on a Cline key; `recommended` is what Cline
 *  currently puts at the top of its own picker. Both are ordered as Cline
 *  ordered them. */
export type ClineTiers = { free: ClineModelRef[]; recommended: ClineModelRef[] };

/** Where the picker starts: what `clineTiersUrl` answered on 2026-08-04. A
 *  stale seed costs the ordering and the "(free)" marking until a refresh
 *  lands — never the ability to run a turn, since the ids come from the
 *  catalog either way. */
export const clineSeedTiers: ClineTiers = {
  free: [
    { id: "deepseek/deepseek-v4-flash", name: "deepseek-v4-flash" },
    { id: "cline-free/glm-5.2", name: "GLM 5.2" },
    { id: "poolside/laguna-s-2.1:free", name: "laguna-s-2.1" },
    { id: "stepfun/step-3.7-flash", name: "step-3.7-flash" },
  ],
  recommended: [
    { id: "anthropic/claude-opus-5", name: "claude-opus-5" },
    { id: "zai/glm-5.2", name: "glm-5.2" },
    { id: "x-ai/grok-4.5", name: "grok-4.5" },
    { id: "openai/gpt-5.6-sol", name: "gpt-5.6-sol" },
    { id: "moonshotai/kimi-k3", name: "kimi-k3" },
  ],
};

/** ClinePass ids (`cline-pass/…`) are deliberately not carried: they answer only
 *  on a ClinePass subscription, so offering them to every Cline key would put
 *  models in the picker that refuse the turn. A subscriber can still name one by
 *  hand in the provider's model field, which is free text. */
export function clineTiersFrom(payload: unknown): ClineTiers | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as { free?: unknown; recommended?: unknown };
  // An empty `free` is a real answer — the promotion can end — but a payload
  // carrying neither list is a shape Spar does not understand, and keeping the
  // seed is better than emptying the picker over it.
  if (!Array.isArray(value.free) && !Array.isArray(value.recommended)) return null;
  return { free: refs(value.free), recommended: refs(value.recommended) };
}

export async function fetchClineTiers(fetcher: typeof fetch = fetch): Promise<ClineTiers | null> {
  const response = await fetcher(clineTiersUrl, { headers: { accept: "application/json" } });
  if (!response.ok) return null;
  return clineTiersFrom(await response.json());
}

/**
 * Cline's catalog, promoted models first. Every entry names Cline's own base URL
 * and provider id, so a turn resolved from one reaches Cline and not the lab it
 * came from.
 */
export function clineModels(tiers: ClineTiers): Model<Api>[] {
  const free = new Set(tiers.free.map((ref) => ref.id));
  const catalog = new Map(openRouterCatalog().map((model) => [model.id, model]));
  const promoted = [...tiers.free, ...tiers.recommended];
  const ids = [...new Set([...promoted.map((ref) => ref.id), ...catalog.keys()])];
  const named = new Map(promoted.map((ref) => [ref.id, ref.name]));
  return ids.map((id) => clineModel(id, catalog.get(id), named.get(id), free.has(id)));
}

/**
 * One entry, for a caller that already knows the id and only needs to know how
 * to talk to it — the agent worker, which has no tier list and does not need
 * one: whether a model is promoted changes its name and its price, never the
 * request. Whatever the tiers say, this is the shape the turn goes out in.
 */
export function clineModelFor(id: string): Model<Api> {
  return clineModel(id, openRouterCatalog().find((model) => model.id === id), undefined, false);
}

const noCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

function clineModel(id: string, source: Model<Api> | undefined, promotedName: string | undefined, isFree: boolean): Model<Api> {
  // OpenRouter's display name is the readable one ("DeepSeek: V4 Flash");
  // Cline's own route answers with the bare slug, so it is only the fallback.
  const name = source?.name ?? promotedName ?? id;
  return {
    id,
    name: isFree ? `${name} (free)` : name,
    api: "openai-completions",
    provider: "cline",
    baseUrl: clineBaseUrl,
    reasoning: source?.reasoning ?? true,
    input: source?.input ?? ["text"],
    contextWindow: source?.contextWindow ?? 128_000,
    maxTokens: source?.maxTokens ?? 32_000,
    // Cline normalizes reasoning across labs through OpenRouter's nested
    // `reasoning` object — the shape its own gateway builds — not OpenAI's
    // top-level `reasoning_effort`, which it does not read. Without this,
    // pi-ai would infer the OpenAI field from an unrecognised base URL and the
    // effort the learner picked would silently do nothing.
    compat: { thinkingFormat: "openrouter" },
    // Cline bills a promoted model at nothing; everything else runs at the rate
    // its catalog publishes. An id Cline promotes that OpenRouter has not
    // listed yet has no published rate at all, so it reports none.
    cost: isFree ? { ...noCost } : source?.cost ?? { ...noCost },
  };
}

function openRouterCatalog(): Model<Api>[] {
  try { return (getModels as unknown as (id: string) => Model<Api>[])("openrouter"); } catch { return []; }
}

function refs(value: unknown): ClineModelRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const ref = entry as { id?: unknown; name?: unknown };
    if (typeof ref?.id !== "string" || !ref.id.trim()) return [];
    return [{ id: ref.id.trim(), ...(typeof ref.name === "string" && ref.name.trim() ? { name: ref.name.trim() } : {}) }];
  });
}
