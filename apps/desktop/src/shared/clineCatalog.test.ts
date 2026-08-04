import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createPiMastraModel } from "../workers/piMastraModel.js";
import { clineBaseUrl, clineModelFor, clineModels, clineSeedTiers, clineTiersFrom, clineTiersUrl, fetchClineTiers } from "./clineCatalog.js";

describe("Cline catalog", () => {
  it("reads Cline's tier list off its own public route", () => {
    expect(clineTiersUrl).toBe("https://api.cline.bot/api/v1/ai/cline/recommended-models");
    const tiers = clineTiersFrom({
      recommended: [{ id: "anthropic/claude-opus-5", name: "claude-opus-5" }],
      free: [{ id: "deepseek/deepseek-v4-flash", name: "deepseek-v4-flash" }],
      clinePass: [{ id: "cline-pass/deepseek-v4-flash", name: "cline-pass/deepseek-v4-flash" }],
    });
    expect(tiers).toEqual({
      free: [{ id: "deepseek/deepseek-v4-flash", name: "deepseek-v4-flash" }],
      recommended: [{ id: "anthropic/claude-opus-5", name: "claude-opus-5" }],
    });
    // ClinePass ids answer only on a subscription, so they are not offered to
    // every Cline key — see the note on `clineTiersFrom`.
    expect(clineModels(tiers!).some((model) => model.id.startsWith("cline-pass/"))).toBe(false);
  });

  /* A promotion ending is a real answer and has to be believed — the models stop
     reading as free. A payload Spar cannot make sense of is not an answer, and
     keeping the last tier list beats emptying the picker over it. */
  it("believes an ended promotion but not a shape it cannot read", () => {
    expect(clineTiersFrom({ free: [], recommended: [] })).toEqual({ free: [], recommended: [] });
    expect(clineTiersFrom({ free: [{ name: "no id here" }] })).toEqual({ free: [], recommended: [] });
    expect(clineTiersFrom({ models: ["deepseek/deepseek-v4-flash"] })).toBeNull();
    expect(clineTiersFrom(null)).toBeNull();
    expect(clineTiersFrom("nope")).toBeNull();
  });

  it("reports no tier list rather than a wrong one when Cline refuses", async () => {
    const refuse: typeof fetch = () => Promise.resolve(new Response("nope", { status: 500 }));
    expect(await fetchClineTiers(refuse)).toBeNull();
  });

  /* Cline's usage-billing catalog is OpenRouter's, so the metadata is real
     rather than invented — but every entry has to be addressed at Cline, or a
     turn resolved from one would go to the lab directly with a Cline key. */
  it("points OpenRouter's catalog at Cline, and charges nothing for a free model", () => {
    const models = clineModels(clineSeedTiers);
    const flash = models.find((model) => model.id === "deepseek/deepseek-v4-flash")!;
    expect(flash).toMatchObject({ provider: "cline", baseUrl: clineBaseUrl, api: "openai-completions", contextWindow: 1_048_576, reasoning: true });
    expect(flash.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    // Paid models keep the rate the catalog publishes for them.
    expect(models.find((model) => model.id === "deepseek/deepseek-v4-pro")?.cost.input).toBeGreaterThan(0);
    expect(models.every((model) => model.baseUrl === clineBaseUrl && model.provider === "cline")).toBe(true);
  });

  /* An id Cline promotes that OpenRouter has not listed yet still has to be
     runnable — Cline's free tier is where new models show up first. */
  it("carries a promoted model the bundled catalog has never heard of", () => {
    const models = clineModels({ free: [{ id: "acme/brand-new-flash", name: "brand-new-flash" }], recommended: [] });
    expect(models[0]).toMatchObject({ id: "acme/brand-new-flash", name: "brand-new-flash (free)", provider: "cline", baseUrl: clineBaseUrl, api: "openai-completions" });
  });
});

/**
 * The one thing no amount of catalog correctness proves: that a turn leaves for
 * the address Cline documents, in the shape Cline reads. Cline stands in here as
 * a loopback server, so this asserts Spar's half of the exchange — the live
 * round trip against a real key is the opt-in test at the bottom of
 * piMastraModel.test.ts.
 */
describe("a Cline turn on the wire", () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });

  const cline = async (chunks: string[]) => {
    const seen: Array<{ url: string; authorization?: string; body: Record<string, unknown> }> = [];
    server = createServer((request, response) => {
      let raw = "";
      request.on("data", (part: Buffer) => { raw += part.toString(); });
      request.on("end", () => {
        seen.push({ url: request.url ?? "", ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}), body: JSON.parse(raw) as Record<string, unknown> });
        response.writeHead(200, { "content-type": "text/event-stream" });
        for (const chunk of chunks) response.write(`data: ${chunk}\n\n`);
        response.write("data: [DONE]\n\n");
        response.end();
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return { seen, baseUrl: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/v1` };
  };

  const completion = (delta: Record<string, unknown>) => JSON.stringify({ id: "c1", model: "deepseek/deepseek-v4-flash", choices: [{ index: 0, delta, finish_reason: null }] });
  const finish = JSON.stringify({ id: "c1", model: "deepseek/deepseek-v4-flash", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } });

  it("posts to Cline's chat-completions route and reads a tool call back", async () => {
    const { seen, baseUrl } = await cline([
      completion({ role: "assistant", content: "Reading the evidence." }),
      completion({ tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "read_ability", arguments: "{\"abilityId\":\"a1\"}" } }] }),
      finish,
    ]);
    const model = createPiMastraModel({ provider: "cline", model: "deepseek/deepseek-v4-flash", api: "openai-completions", baseUrl, apiKey: "cline-key" });
    const result = await model.doGenerate({
      prompt: [{ role: "system", content: "Use evidence." }, { role: "user", content: [{ type: "text", text: "Choose a target." }] }],
      tools: [{ type: "function", name: "read_ability", description: "Read evidence", inputSchema: { type: "object", properties: { abilityId: { type: "string" } }, required: ["abilityId"] } }],
      toolChoice: { type: "required" },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/v1/chat/completions");
    expect(seen[0]!.authorization).toBe("Bearer cline-key");
    expect(seen[0]!.body).toMatchObject({ model: "deepseek/deepseek-v4-flash", stream: true });
    expect((seen[0]!.body.tools as Array<{ function: { name: string } }>)[0]!.function.name).toBe("read_ability");
    expect(result.finishReason).toBe("tool-calls");
    expect(result.content).toContainEqual({ type: "tool-call", toolCallId: "call-1", toolName: "read_ability", input: JSON.stringify({ abilityId: "a1" }) });
    expect(result.usage.totalTokens).toBe(16);
  });

  /* Cline normalizes reasoning through OpenRouter's nested object. Nothing in
     pi-ai knows that from `api.cline.bot` alone, so without the catalog's compat
     the effort would go out as OpenAI's `reasoning_effort` and Cline would drop
     it — the picker would move and the model would not think. */
  it("asks Cline for reasoning the way Cline reads it", async () => {
    const { seen, baseUrl } = await cline([completion({ role: "assistant", content: "Thought about it." }), finish]);
    const model = createPiMastraModel({ provider: "cline", model: "deepseek/deepseek-v4-flash", api: "openai-completions", baseUrl, apiKey: "cline-key", reasoningEffort: "high" });
    await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Think." }] }] });

    expect(seen[0]!.body.reasoning).toEqual({ effort: "high" });
    expect(seen[0]!.body).not.toHaveProperty("reasoning_effort");
  });

  it("keeps the request identical for a model Cline promotes before OpenRouter lists it", async () => {
    expect(clineModelFor("acme/brand-new-flash")).toMatchObject({ provider: "cline", api: "openai-completions", compat: { thinkingFormat: "openrouter" } });
  });
});
