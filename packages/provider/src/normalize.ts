import type { NormalizedUsage, ProviderEvent } from "./types.js";

export function normalizeUsage(value: unknown): NormalizedUsage {
  const usage = (value ?? {}) as Record<string, unknown>;
  const inputTokens = numberFrom(usage.inputTokens ?? usage.promptTokens ?? usage.prompt_tokens);
  const outputTokens = numberFrom(usage.outputTokens ?? usage.completionTokens ?? usage.completion_tokens);
  const totalTokens = numberFrom(usage.totalTokens ?? usage.total_tokens) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined);
  return { ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }), ...(totalTokens === undefined ? {} : { totalTokens }) };
}

export function normalizeProviderError(error: unknown): Extract<ProviderEvent, { type: "error" }> {
  const value = error as { message?: string; statusCode?: number; status?: number; code?: string };
  const status = value?.statusCode ?? value?.status;
  return { type: "error", code: value?.code ?? (status ? `HTTP_${status}` : "PROVIDER_ERROR"), message: value?.message ?? String(error), retryable: status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500) };
}

function numberFrom(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
