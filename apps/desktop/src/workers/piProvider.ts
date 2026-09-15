import type { Api, Model, Usage } from "@earendil-works/pi-ai";
import { getModels } from "@earendil-works/pi-ai/compat";
import type { ReasoningEffort } from "../shared/api.js";
import { clineModelFor } from "../shared/clineCatalog.js";

/*
 * What Spar knows about the model it resolved, and how it asks pi for the
 * things pi spells differently per provider.
 *
 * This file was an adapter: a whole AI SDK `LanguageModelV2` implementation
 * whose only purpose was letting Mastra call a library Spar was already
 * calling. Mastra is gone and so is the adapter. What is left is the part that
 * was never about Mastra — the model descriptor, the transport pin for the
 * ChatGPT subscription route, and the per-family spelling of a forced call.
 */

export type PiProviderInput = {
  provider: string;
  model: string;
  api: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
};

/** What the phase controller can ask for. Kept in the AI SDK's spelling because
 *  that is the vocabulary every provider family below is mapped from, and
 *  renaming the source of a translation does not make it a better one. */
export type ToolChoiceRequest = { type: "auto" | "none" | "required" } | { type: "tool"; toolName: string } | undefined;

/** Token counts in the field names the rest of Spar reads. */
export type SparUsage = { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens: number };

/** What the bundled catalog knows about this model, which is where everything
 *  the request shape depends on comes from — cache and reasoning compatibility
 *  above all. pi-ai ships no Cline provider, so Cline answers for its own. */
const lookupModel = (provider: string, id: string): Model<Api> | undefined => {
  if (provider === "cline") return clineModelFor(id);
  try { return (getModels as unknown as (value: string) => Model<Api>[])(provider).find((model) => model.id === id); } catch { return undefined; }
};

/**
 * The model descriptor pi is asked to run, assembled from what Spar resolved
 * plus whatever the bundled catalog knows about it.
 */
export function piModelFor(input: PiProviderInput): Model<Api> {
  const registered = lookupModel(input.provider, input.model);
  return {
    id: input.model,
    name: registered?.name ?? input.model,
    api: input.api,
    provider: input.provider,
    baseUrl: input.baseUrl || registered?.baseUrl || "",
    reasoning: registered?.reasoning ?? true,
    input: registered?.input ?? ["text"],
    cost: registered?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: registered?.contextWindow ?? 128_000,
    maxTokens: registered?.maxTokens ?? 32_000,
    ...(registered?.thinkingLevelMap ? { thinkingLevelMap: registered.thinkingLevelMap } : {}),
    ...(registered?.compat ? { compat: registered.compat } : {}),
    ...(input.headers || registered?.headers ? { headers: { ...registered?.headers, ...input.headers } } : {}),
  };
}

/**
 * Which tool the model is allowed to pick, in the shape this API asks for it.
 *
 * Spar's phase controller is built on forcing one tool at a time — twenty-one of
 * its phases require a specific call, and the whole deterministic sequence is
 * that requirement. It used to reach the provider through Mastra, which passed
 * it down as `toolChoice` on the AI SDK call options — where the adapter that
 * used to live in this file dropped it on the floor, reading `temperature`,
 * `maxOutputTokens` and `abortSignal` and nothing else. So every "required"
 * phase was really a sentence in the prompt asking nicely, backed by the retry
 * ladder in `agent.ts` for when the model answered in prose instead.
 *
 * pi carries this per API rather than through one portable field — its own
 * provider-neutral `ToolChoice` is `"auto" | "none"` and cannot express
 * "required" — so the demand is translated for the family being spoken to.
 * Anthropic and Bedrock say `any` and take a named tool as an object; the
 * OpenAI and Mistral families say `required`; Google says `any` and has no way
 * to name one. A named choice degrades to "some tool, you pick" wherever it
 * cannot be expressed, which is what `activeTools` has already narrowed anyway.
 */
export function toolChoiceFor(api: string, choice: ToolChoiceRequest) {
  if (!choice) return undefined;
  if (choice.type === "auto") return "auto";
  if (choice.type === "none") return "none";
  const anthropicShaped = api === "anthropic-messages" || api === "bedrock-converse-stream";
  const named = choice.type === "tool" ? choice.toolName : "";
  if (anthropicShaped) return named ? { type: "tool", name: named } : "any";
  if (api.startsWith("google")) return "any";
  /* The OpenAI families (completions, responses, codex-responses) and Mistral.
     Codex Responses takes no named form, so it gets the bare demand. */
  if (named && api !== "openai-codex-responses") return { type: "function", function: { name: named } };
  return "required";
}

export function piTransportForApi(api: string): "sse" | undefined {
  return api === "openai-codex-responses" ? "sse" : undefined;
}

/** pi's token counts, in the field names the rest of Spar already reads. The
 *  agent loop reports the same numbers from the same source, so a turn's cost
 *  does not change shape depending on which path ran it. */
export function piUsage(value: Usage): SparUsage {
  return { inputTokens: value.input, outputTokens: value.output, totalTokens: value.totalTokens, cachedInputTokens: value.cacheRead };
}

/** pi's stop reason, in the words the turn result already uses. */
export function piFinishReason(reason: string): string { return reason === "toolUse" ? "tool-calls" : reason === "length" ? "length" : reason === "error" ? "error" : reason === "stop" ? "stop" : "other"; }

/* OpenAI's priority service tier — what ChatGPT calls fast mode — reaches the
   wire through `onPayload` rather than through an option.
 *
 * pi's per-API `stream` takes a `serviceTier`, but Spar goes through
 * `streamSimple`, and the simple wrapper rebuilds its options from a fixed list
 * that does not carry it. `onPayload` *is* on that list: it is handed the
 * request body just before it is sent and may return a replacement. So the tier
 * goes on the body directly, on the two request shapes that have a field for it
 * — both Responses APIs — and nowhere else, because a body key an endpoint does
 * not know is a rejected request, not an ignored preference. */
const RESPONSES_APIS = new Set(["openai-responses", "openai-codex-responses", "azure-openai-responses"]);

export function piFastModeOptions(input: PiProviderInput) {
  if (!input.fastMode || !RESPONSES_APIS.has(input.api)) return {};
  return {
    onPayload: (payload: unknown) =>
      payload && typeof payload === "object" ? { ...(payload as Record<string, unknown>), service_tier: "priority" } : payload,
  };
}
