import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool } from "ai";
import { normalizeProviderError, normalizeUsage } from "./normalize";
import type { ProviderEvent, ProviderRunRequest, ProviderSettings } from "./types";

export type SecretResolver = (keychainAccount: string) => Promise<string>;

export async function* runProvider(settings: ProviderSettings, request: ProviderRunRequest, resolveSecret: SecretResolver): AsyncGenerator<ProviderEvent> {
  const apiKey = settings.mode === "gateway" ? settings.accessToken : await resolveSecret(settings.keychainAccount);
  const baseURL = settings.mode === "gateway" ? settings.gatewayUrl : settings.baseUrl;
  const provider = createOpenAI({ apiKey, baseURL, compatibility: "compatible", name: settings.provider });
  try {
    const result = streamText({
      model: provider(settings.model),
      system: request.system,
      messages: request.messages,
      tools: Object.fromEntries(Object.entries(request.tools).map(([name, value]) => [name, tool({ description: value.description, parameters: value.inputSchema, execute: value.execute })])),
      maxSteps: 16,
      abortSignal: request.signal
    });
    for await (const part of result.fullStream) {
      const event = normalizePart(part);
      if (event) yield event;
    }
    yield { type: "usage", usage: normalizeUsage(await result.usage) };
    yield { type: "finish", reason: await result.finishReason };
  } catch (error) {
    yield normalizeProviderError(error);
  }
}

function normalizePart(part: Record<string, unknown>): ProviderEvent | null {
  const type = String(part.type);
  if (type === "text-delta") return { type, text: String(part.textDelta ?? part.text ?? "") };
  if (type === "reasoning") return { type: "reasoning-delta", text: String(part.textDelta ?? part.text ?? "") };
  if (type === "tool-call") return { type, providerCallId: String(part.toolCallId), toolName: String(part.toolName), input: part.args };
  if (type === "tool-result") return { type, providerCallId: String(part.toolCallId), toolName: String(part.toolName), output: part.result };
  if (type === "tool-error") return { type: "tool-result", providerCallId: String(part.toolCallId), toolName: String(part.toolName), output: null, error: String(part.error) };
  return null;
}

