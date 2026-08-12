/** Everything the page says about where Spar lives, in one place. */

export const REPO = "https://github.com/AbhinavMishra32/spar";

export const site = {
  name: "Spar",
  tagline: "A coding gym that watches you work and writes your next exercise.",
  description:
    "Spar records how an attempt actually goes — what you wrote, what you ran, where you stalled — and generates your next challenge against the specific thing it thinks you can't do yet. Tests decide the verdict, never the model.",
  url: "https://tryspar.dev",
  repo: REPO,
  releases: `${REPO}/releases/latest`,
  docs: `${REPO}#readme`,
} as const;

export const nav = [
  { label: "How it works", href: "#how" },
  { label: "The app", href: "#app" },
  { label: "The agent", href: "#agent" },
  { label: "Models", href: "#models" },
  { label: "FAQ", href: "#faq" },
] as const;

/** The languages a challenge can be set in. Order is the app's own. */
export const languages = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Java",
  "C++",
  "C",
  "Go",
  "Rust",
  "Swift",
  "Ruby",
] as const;

/** How you can drive the agent. Three routes, and the site says so plainly. */
export const modelRoutes = [
  {
    kind: "Subscription",
    line: "Sign in with a plan you already pay for.",
    names: ["OpenAI Codex", "Claude Code", "GitHub Copilot"],
  },
  {
    kind: "API key",
    line: "Any key, or any OpenAI-compatible endpoint.",
    names: [
      "OpenAI",
      "Anthropic",
      "Google",
      "xAI",
      "DeepSeek",
      "Moonshot",
      "Z.ai",
      "MiniMax",
      "OpenRouter",
      "Vercel AI Gateway",
    ],
  },
  {
    kind: "Local",
    line: "Nothing leaves the machine.",
    names: ["Ollama", "LM Studio"],
  },
] as const;
