import { describe, expect, it } from "vitest";
import { toMastraProviderModel } from "./runtime.js";

describe("Mastra provider resolution", () => {
  it("preserves OpenCode Go identity so Mastra selects its compatible protocol", () => {
    expect(toMastraProviderModel({
      provider: "opencode-go",
      model: "deepseek-v4-flash",
      baseUrl: "https://opencode.ai/zen/go/v1/",
      apiKey: "test-secret",
    })).toEqual({
      providerId: "opencode-go",
      modelId: "deepseek-v4-flash",
      url: "https://opencode.ai/zen/go/v1",
      apiKey: "test-secret",
    });
  });

  it("preserves OpenRouter's free router identifier and compatible endpoint", () => {
    expect(toMastraProviderModel({
      provider: "openrouter",
      model: "openrouter/free",
      baseUrl: "https://openrouter.ai/api/v1/",
      apiKey: "test-secret",
    })).toEqual({
      providerId: "openrouter",
      modelId: "openrouter/free",
      url: "https://openrouter.ai/api/v1",
      apiKey: "test-secret",
    });
  });
});
