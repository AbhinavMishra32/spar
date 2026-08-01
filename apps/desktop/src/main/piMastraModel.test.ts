import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from "@mariozechner/pi-ai";
import { createPiMastraModel } from "../workers/piMastraModel.js";

describe("Pi to Mastra model adapter", () => {
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
});
