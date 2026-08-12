/** Everything the page says about where Spar lives, in one place. */

export const REPO = "https://github.com/AbhinavMishra32/spar";

export const site = {
  name: "Spar",
  tagline: "Stop guessing. Solve the right problems.",
  description:
    "Spar builds a living map of your programming abilities from how you solve — what you understand, where you get stuck, which cases break your approach — then chooses or creates the next challenge from it. LeetCode, Codeforces and generated challenges in one training system, graded by execution rather than by a model.",
  url: "https://tryspar.dev",
  repo: REPO,
  releases: `${REPO}/releases/latest`,
  docs: `${REPO}#readme`,
} as const;

export const nav = [
  { label: "Ability map", href: "#abilities" },
  { label: "How it works", href: "#how" },
  { label: "Problems", href: "#sources" },
  { label: "The app", href: "#app" },
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
