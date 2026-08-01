import { describe, expect, it } from "vitest";
import keytar from "keytar";
import { fauxAssistantMessage, fauxText, fauxToolCall, getModels, registerFauxProvider } from "@mariozechner/pi-ai";
import { getOAuthApiKey, type OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import { createPiMastraModel, piTransportForApi } from "../workers/piMastraModel.js";

describe("Pi to Mastra model adapter", () => {
  it("uses SSE for ChatGPT subscription inference", () => {
    expect(piTransportForApi("openai-codex-responses")).toBe("sse");
    expect(piTransportForApi("openai-responses")).toBeUndefined();
  });

  it("preserves text, JSON tool calls, finish reason, and usage", async () => {
    const provider = registerFauxProvider({ api: "practice-faux", provider: "practice-faux", models: [{ id: "training-faux" }] });
    provider.setResponses([fauxAssistantMessage([fauxText("Inspecting evidence."), fauxToolCall("read_ability", { abilityId: "ability-1" }, { id: "call-1" })], { stopReason: "toolUse" })]);
    try {
      const model = createPiMastraModel({ provider: "practice-faux", model: "training-faux", api: "practice-faux", baseUrl: "http://localhost:0", apiKey: "test" });
      const result = await model.doGenerate({
        prompt: [
          { role: "system", content: "Use evidence." },
          { role: "user", content: [{ type: "text", text: "Choose the next target." }] },
        ],
        tools: [{ type: "function", name: "read_ability", description: "Read evidence", inputSchema: { type: "object", properties: { abilityId: { type: "string" } }, required: ["abilityId"] } }],
        toolChoice: { type: "required" },
      });
      expect(result.finishReason).toBe("tool-calls");
      expect(result.content).toEqual([
        { type: "text", text: "Inspecting evidence." },
        { type: "tool-call", toolCallId: "call-1", toolName: "read_ability", input: JSON.stringify({ abilityId: "ability-1" }) },
      ]);
      expect(result.usage.totalTokens).toBeGreaterThan(0);
    } finally { provider.unregister(); }
  });

  it.runIf(process.env.PRACTICE_VERIFY_CHATGPT === "1")("calls a tool through the connected ChatGPT subscription", async () => {
    const raw = await keytar.getPassword("ai.practice.desktop", "provider-oauth:openai-codex");
    if (!raw) throw new Error("ChatGPT subscription credential is not connected");
    const credentials = JSON.parse(raw) as OAuthCredentials;
    const resolved = await getOAuthApiKey("openai-codex", { "openai-codex": credentials });
    if (!resolved) throw new Error("ChatGPT subscription credential could not be refreshed");
    const source = getModels("openai-codex").find((model) => model.id === "gpt-5.4-mini");
    if (!source) throw new Error("GPT-5.4 Mini is unavailable in the ChatGPT subscription catalog");
    const model = createPiMastraModel({ provider: source.provider, model: source.id, api: source.api, baseUrl: source.baseUrl, apiKey: resolved.apiKey });
    const result = await model.doGenerate({
      prompt: [
        { role: "system", content: "Call the supplied tool exactly once." },
        { role: "user", content: [{ type: "text", text: "Retrieve learner evidence." }] },
      ],
      tools: [{ type: "function", name: "search_learner_model", description: "Search learner evidence", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query", "limit"] } }],
      toolChoice: { type: "required" },
      maxOutputTokens: 128,
    });
    expect(result.finishReason).toBe("tool-calls");
    expect(result.content.some((part) => part.type === "tool-call" && part.toolName === "search_learner_model")).toBe(true);
  }, 60_000);
});
