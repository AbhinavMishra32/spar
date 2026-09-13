import { describe, expect, it } from "vitest";
import keytar from "keytar";
import { getModels } from "@earendil-works/pi-ai/compat";
import { createSparModels } from "../main/piModels.js";
import { clineBaseUrl } from "../shared/clineCatalog.js";
import { createTrainingAgent, phaseToolChoice, piAgentTools } from "./piAgent.js";
import { piTransportForApi, type PiProviderInput } from "./piProvider.js";

const SERVICE = "ai.spar.desktop";
/** The keychain, behind the same three calls `ProviderService` hands pi, so the
 *  verifications below resolve a token through exactly the path the app
 *  resolves through rather than a second one that could work while the app's
 *  does not. */
const keychain = {
  async readProviderOAuth<T>(provider: string): Promise<T | null> {
    const raw = await keytar.getPassword(SERVICE, `provider-oauth:${provider}`);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  saveProviderOAuth: (provider: string, credentials: unknown) => keytar.setPassword(SERVICE, `provider-oauth:${provider}`, JSON.stringify(credentials)),
  async deleteProviderOAuth(provider: string) { await keytar.deletePassword(SERVICE, `provider-oauth:${provider}`); },
};

/**
 * One forced call against a real provider.
 *
 * The same shape a phase is: one tool offered, that tool required, one prompt.
 * These are the only tests that touch a paid endpoint, so they run only when
 * asked for — but they are the ones that answer the question no faux provider
 * can, which is whether the provider accepts what Spar sends it.
 */
async function forcedCall(provider: PiProviderInput) {
  const agent = createTrainingAgent(provider, "Call the supplied tool exactly once.", { current: phaseToolChoice(provider.api, "required") });
  const called: string[] = [];
  agent.state.tools = piAgentTools((name) => name === "search_learner_model", async (name) => { called.push(name); return { passages: [] }; });
  await agent.prompt("Retrieve learner evidence.");
  return { called, messages: agent.state.messages };
}

describe("what Spar sends a provider", () => {
  it("uses SSE for ChatGPT subscription inference", () => {
    expect(piTransportForApi("openai-codex-responses")).toBe("sse");
    expect(piTransportForApi("openai-responses")).toBeUndefined();
  });

  it.runIf(process.env.SPAR_VERIFY_CHATGPT === "1")("forces a tool call through the connected ChatGPT subscription", async () => {
    if (!await keychain.readProviderOAuth("openai-codex")) throw new Error("ChatGPT subscription credential is not connected");
    const resolved = await createSparModels(keychain).getAuth("openai-codex");
    if (!resolved?.auth.apiKey) throw new Error("ChatGPT subscription credential could not be refreshed");
    const source = getModels("openai-codex").find((model) => model.id === "gpt-5.4-mini");
    if (!source) throw new Error("GPT-5.4 Mini is unavailable in the ChatGPT subscription catalog");
    const { called } = await forcedCall({ provider: source.provider, model: source.id, api: source.api, baseUrl: resolved.auth.baseUrl ?? source.baseUrl, apiKey: resolved.auth.apiKey });
    expect(called).toEqual(["search_learner_model"]);
  }, 60_000);

  /* The Cline half of the exchange is asserted against a loopback server in
     shared/clineCatalog.test.ts, which needs no key. This is the other half:
     that Cline itself accepts what Spar sends and calls the tool back. Run it
     with a Cline key connected — `SPAR_VERIFY_CLINE=1 pnpm --filter @spar/desktop test`
     — and it spends nothing, because DeepSeek V4 Flash is one of the models
     Cline currently bills at zero. */
  it.runIf(process.env.SPAR_VERIFY_CLINE === "1")("forces a tool call through Cline's free DeepSeek V4 Flash", async () => {
    const apiKey = await keytar.getPassword(SERVICE, "provider:cline");
    if (!apiKey) throw new Error("Connect Cline in Settings before running this verification");
    const { called } = await forcedCall({ provider: "cline", model: "deepseek/deepseek-v4-flash", api: "openai-completions", baseUrl: clineBaseUrl, apiKey });
    expect(called).toEqual(["search_learner_model"]);
  }, 60_000);
});
