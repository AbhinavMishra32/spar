import { describe, expect, it } from "vitest";
import { normalizeProviderError, normalizeUsage } from "./normalize";
describe("provider normalization", () => {
  it("normalizes OpenAI token names", () => expect(normalizeUsage({ prompt_tokens: 10, completion_tokens: 4 })).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14 }));
  it("marks throttling as retryable", () => expect(normalizeProviderError({ status: 429, message: "slow" }).retryable).toBe(true));
});
