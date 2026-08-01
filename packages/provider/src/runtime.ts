import { z } from "zod";

/**
 * The same provider boundary used by Construct's Mastra runtime: the client
 * resolves credentials and preferences, then Mastra receives an
 * OpenAI-compatible model descriptor. Mastra owns streaming and tool-call
 * protocol normalization.
 */
export const resolvedProviderSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().trim().min(1),
});

export type ResolvedProviderInput = z.infer<typeof resolvedProviderSchema>;
export type MastraProviderModel = {
  providerId: string;
  modelId: string;
  url: string;
  apiKey: string;
};

export function toMastraProviderModel(input: ResolvedProviderInput): MastraProviderModel {
  const provider = resolvedProviderSchema.parse(input);
  return {
    providerId: provider.provider,
    modelId: provider.model,
    url: provider.baseUrl.replace(/\/$/, ""),
    apiKey: provider.apiKey,
  };
}
