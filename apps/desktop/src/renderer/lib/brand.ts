import type { Language } from "@spar/domain";
import type { ProviderId } from "../../shared/api";

/**
 * Canonical identity colours belong to the identity layer, not to whichever
 * screen happens to render a mark. Keeping them here means Settings,
 * onboarding, the workspace, and compact model controls cannot drift apart.
 *
 * A missing provider entry is deliberate: some providers (and custom OpenAI-
 * compatible endpoints) have no chromatic mark, so their glyph should continue
 * to inherit the surrounding semantic foreground rather than receive a made-up
 * colour.
 */
export const LANGUAGE_BRAND_COLOR: Record<Language, string> = {
  javascript: "#f7df1e",
  typescript: "#3178c6",
  python:"#3776ab",java:"#e76f00",c:"#555555",
  cpp: "#00599c",
  go:"#00add8",rust:"#b7410e",swift:"#f05138",ruby:"#cc342d",
};

export const PROVIDER_BRAND_COLOR: Partial<Record<ProviderId, string>> = {
  openai: "#10a37f",
  "openai-codex": "#10a37f",
  "claude-code": "#d97757",
  google: "#4285f4",
  openrouter: "#94a3b8",
  deepseek: "#5786fe",
  minimax: "#e73562",
  "cloudflare-ai-gateway": "#f38020",
};
