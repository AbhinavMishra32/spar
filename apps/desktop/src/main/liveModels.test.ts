import { describe, expect, it } from "vitest";
import { LiveModels } from "./liveModels.js";

describe("live model catalog", () => {
  it("adds a future model with its runtime metadata and keeps bundled models offline", async () => {
    const sample = {
      id: "gpt-99-sol", name: "GPT-99 Sol", api: "openai-codex-responses",
      provider: "openai-codex", baseUrl: "https://chatgpt.com/backend-api",
      reasoning: true, input: ["text"],
      cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 987654, maxTokens: 123456,
    };
    const catalog = new LiveModels(async () => new Response(JSON.stringify({
      "openai-codex": {
        [sample.id]: sample,
        "wrong-provider": { ...sample, id: "wrong-provider", provider: "openai" },
        "wrong-endpoint": { ...sample, id: "wrong-endpoint", baseUrl: "https://other.example" },
      },
    })));
    await catalog.refresh();
    expect(catalog.get("openai-codex").find((model) => model.id === sample.id)).toMatchObject({ contextWindow: 987654, maxTokens: 123456 });
    expect(catalog.get("openai-codex").some((model) => model.id === "wrong-provider" || model.id === "wrong-endpoint")).toBe(false);
    expect(catalog.get("openai-codex").some((model) => model.id === "gpt-6-sol")).toBe(true);
  });
});
