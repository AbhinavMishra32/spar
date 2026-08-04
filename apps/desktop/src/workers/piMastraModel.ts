import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from "@ai-sdk/provider";
import {
  completeSimple as piComplete,
  getModels,
  streamSimple as piStream,
  type Api,
  type AssistantMessage,
  type Context,
  type ImageContent,
  type Message,
  type Model,
  type Tool,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
  type Usage,
} from "@mariozechner/pi-ai";
import type { ReasoningEffort } from "../shared/api.js";
import { clineModelFor } from "../shared/clineCatalog.js";

export type PiProviderInput = {
  provider: string;
  model: string;
  api: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  reasoningEffort?: ReasoningEffort;
};

/** What the bundled catalog knows about this model, which is where everything
 *  the request shape depends on comes from — cache and reasoning compatibility
 *  above all. pi-ai ships no Cline provider, so Cline answers for its own. */
const lookupModel = (provider: string, id: string): Model<Api> | undefined => {
  if (provider === "cline") return clineModelFor(id);
  try { return (getModels as unknown as (value: string) => Model<Api>[])(provider).find((model) => model.id === id); } catch { return undefined; }
};

export function createPiMastraModel(input: PiProviderInput): LanguageModelV2 {
  const registered = lookupModel(input.provider, input.model);
  const model: Model<Api> = {
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

  return {
    specificationVersion: "v2",
    provider: input.provider,
    modelId: input.model,
    supportedUrls: {},
    async doGenerate(options) {
      const result = await piComplete(model, toPiContext(options), streamOptions(input, options));
      return {
        content: toV2Content(result.content),
        finishReason: finishReason(result.stopReason),
        usage: usage(result.usage),
        warnings: warnings(options),
        response: { modelId: result.responseModel ?? result.model, ...(result.responseId ? { id: result.responseId } : {}) },
      };
    },
    async doStream(options) {
      const source = piStream(model, toPiContext(options), streamOptions(input, options));
      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: warnings(options) });
          void (async () => {
            try {
              for await (const event of source) {
                const contentId = `${event.type.startsWith("thinking") ? "reasoning" : event.type.startsWith("toolcall") ? "tool" : "text"}-${"contentIndex" in event ? event.contentIndex : 0}`;
                if (event.type === "text_start") controller.enqueue({ type: "text-start", id: contentId });
                if (event.type === "text_delta") controller.enqueue({ type: "text-delta", id: contentId, delta: event.delta });
                if (event.type === "text_end") controller.enqueue({ type: "text-end", id: contentId });
                if (event.type === "thinking_start") controller.enqueue({ type: "reasoning-start", id: contentId });
                if (event.type === "thinking_delta") controller.enqueue({ type: "reasoning-delta", id: contentId, delta: event.delta });
                if (event.type === "thinking_end") controller.enqueue({ type: "reasoning-end", id: contentId });
                if (event.type === "toolcall_start") {
                  const partial = event.partial.content[event.contentIndex];
                  controller.enqueue({ type: "tool-input-start", id: contentId, toolName: partial?.type === "toolCall" ? partial.name : "tool" });
                }
                if (event.type === "toolcall_delta") controller.enqueue({ type: "tool-input-delta", id: contentId, delta: event.delta });
                if (event.type === "toolcall_end") {
                  controller.enqueue({ type: "tool-input-end", id: contentId });
                  controller.enqueue({ type: "tool-call", toolCallId: event.toolCall.id, toolName: event.toolCall.name, input: JSON.stringify(event.toolCall.arguments) });
                }
                if (event.type === "done") controller.enqueue({ type: "finish", usage: usage(event.message.usage), finishReason: finishReason(event.reason) });
                if (event.type === "error") controller.enqueue({ type: "error", error: new Error(event.error.errorMessage ?? "Provider stream failed") });
              }
              controller.close();
            } catch (error) {
              controller.enqueue({ type: "error", error });
              controller.close();
            }
          })();
        },
      });
      return { stream };
    },
  };
}

function streamOptions(input: PiProviderInput, options: LanguageModelV2CallOptions) {
  const transport = piTransportForApi(input.api);
  return {
    apiKey: input.apiKey,
    // ChatGPT subscription inference currently exposes the Codex Responses
    // route over SSE. Pi's automatic WebSocket probe can receive a terminal
    // 404 before it gets a chance to fall back, so select the known-good
    // transport explicitly for this API family.
    ...(transport ? { transport } : {}),
    ...(options.abortSignal ? { signal: options.abortSignal } : {}),
    ...(options.maxOutputTokens ? { maxTokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
    // "off" (the default) sends no reasoning directive at all — each pi-ai provider
    // already falls back to today's behavior in that case, so this never changes
    // existing runs unless the composer's reasoning picker was actually touched.
    ...(input.reasoningEffort && input.reasoningEffort !== "off" ? { reasoning: input.reasoningEffort } : {}),
  };
}

export function piTransportForApi(api: string): "sse" | undefined {
  return api === "openai-codex-responses" ? "sse" : undefined;
}

function toPiContext(options: LanguageModelV2CallOptions): Context {
  const systemPrompt = options.prompt.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const messages: Message[] = [];
  for (const message of options.prompt) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      const content: Array<TextContent | ImageContent> = [];
      for (const part of message.content) {
        if (part.type === "text") content.push({ type: "text", text: part.text });
        else if (typeof part.data === "string") content.push({ type: "image", data: part.data, mimeType: part.mediaType });
      }
      messages.push({ role: "user", content, timestamp: Date.now() });
      continue;
    }
    if (message.role === "assistant") {
      const content: Array<TextContent | ThinkingContent | ToolCall> = [];
      for (const part of message.content) {
        if (part.type === "text") content.push({ type: "text", text: part.text });
        if (part.type === "reasoning") content.push({ type: "thinking", thinking: part.text });
        if (part.type === "tool-call") content.push({ type: "toolCall", id: part.toolCallId, name: part.toolName, arguments: asRecord(part.input) });
      }
      messages.push({
        role: "assistant",
        content,
        api: "openai-completions",
        provider: "history",
        model: "history",
        usage: emptyPiUsage(),
        stopReason: message.content.some((part) => part.type === "tool-call") ? "toolUse" : "stop",
        timestamp: Date.now(),
      });
      continue;
    }
    for (const part of message.content) {
      messages.push({
        role: "toolResult",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        content: [{ type: "text", text: toolResultText(part.output) }],
        isError: part.output.type === "error-text" || part.output.type === "error-json",
        timestamp: Date.now(),
      });
    }
  }
  const tools = options.tools?.flatMap((tool): Tool[] => tool.type === "function" ? [{ name: tool.name, description: tool.description ?? "", parameters: tool.inputSchema as Tool["parameters"] }] : []);
  return { ...(systemPrompt ? { systemPrompt } : {}), messages, ...(tools?.length ? { tools } : {}) };
}

function toV2Content(content: AssistantMessage["content"]): LanguageModelV2Content[] {
  const result: LanguageModelV2Content[] = [];
  for (const part of content) {
    if (part.type === "text") result.push({ type: "text", text: part.text });
    if (part.type === "thinking") result.push({ type: "reasoning", text: part.thinking });
    if (part.type === "toolCall") result.push({ type: "tool-call", toolCallId: part.id, toolName: part.name, input: JSON.stringify(part.arguments) });
  }
  return result;
}

function usage(value: Usage): LanguageModelV2Usage {
  return { inputTokens: value.input, outputTokens: value.output, totalTokens: value.totalTokens, cachedInputTokens: value.cacheRead };
}
function emptyPiUsage(): Usage { return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }; }
function finishReason(reason: string): LanguageModelV2FinishReason { return reason === "toolUse" ? "tool-calls" : reason === "length" ? "length" : reason === "error" ? "error" : reason === "stop" ? "stop" : "other"; }
function warnings(options: LanguageModelV2CallOptions) { return [options.topK !== undefined ? { type: "unsupported-setting" as const, setting: "topK" as const } : null, options.stopSequences?.length ? { type: "unsupported-setting" as const, setting: "stopSequences" as const } : null].filter((value): value is NonNullable<typeof value> => value !== null); }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function toolResultText(output: { type: string; value?: unknown }) { return typeof output.value === "string" ? output.value : JSON.stringify(output.value ?? output); }
