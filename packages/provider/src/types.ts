import { z } from "zod";

export const providerSettingsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("gateway"), provider: z.literal("practice-ai"), model: z.string().min(1), gatewayUrl: z.string().url(), accessToken: z.string().min(1) }),
  z.object({ mode: z.literal("byok"), provider: z.enum(["openai", "openrouter", "opencode-zen", "litellm"]), model: z.string().min(1), baseUrl: z.string().url(), keychainAccount: z.string().min(1) })
]);
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

export type NormalizedUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedCostMicros?: number };
export type ProviderEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call-start"; providerCallId: string; toolName: string }
  | { type: "tool-call-delta"; providerCallId: string; delta: string }
  | { type: "tool-call"; providerCallId: string; toolName: string; input: unknown }
  | { type: "tool-result"; providerCallId: string; toolName: string; output: unknown; error?: string }
  | { type: "usage"; usage: NormalizedUsage }
  | { type: "finish"; reason: string }
  | { type: "error"; code: string; message: string; retryable: boolean };

export type RuntimeTool = { description: string; inputSchema: z.ZodTypeAny; execute(input: unknown): Promise<unknown> };
export type ProviderRunRequest = { system: string; messages: Array<{ role: "user" | "assistant"; content: string }>; tools: Record<string, RuntimeTool>; signal?: AbortSignal };

