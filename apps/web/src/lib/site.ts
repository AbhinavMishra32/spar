/** Everything the page says about where Spar lives, in one place. */

export const REPO = "https://github.com/AbhinavMishra32/spar";

/**
 * The release the download buttons point at. Bumping this is the only edit a
 * release needs on the site — every asset URL below is derived from it, and the
 * names match what `electron-builder` publishes.
 */
export const VERSION = "0.3.0";

const RELEASE = `${REPO}/releases/download/v${VERSION}`;

export const site = {
  name: "Spar",
  tagline: "A coding gym that watches you work and writes your next exercise.",
  description:
    "Spar records how an attempt actually goes — what you wrote, what you ran, where you stalled — and generates your next challenge against the specific thing it thinks you can't do yet. Tests decide the verdict, never the model.",
  url: "https://spar.sh",
  repo: REPO,
  releases: `${REPO}/releases/latest`,
  docs: `${REPO}#readme`,
  version: VERSION,
} as const;

export const nav = [
  { label: "How it works", href: "#how" },
  { label: "The app", href: "#app" },
  { label: "The agent", href: "#agent" },
  { label: "Models", href: "#models" },
  { label: "FAQ", href: "#faq" },
] as const;

export type Download = {
  platform: string;
  detail: string;
  href: string;
  /** Second build for the same platform, where one exists. */
  alt?: { label: string; href: string };
};

export const downloads: readonly Download[] = [
  {
    platform: "macOS",
    detail: "Apple silicon · M1 and later",
    href: `${RELEASE}/Spar-${VERSION}-arm64.dmg`,
    alt: { label: "Intel", href: `${RELEASE}/Spar-${VERSION}.dmg` },
  },
  {
    platform: "Windows",
    detail: "x64 installer",
    href: `${RELEASE}/Spar-${VERSION}-x64.exe`,
  },
  {
    platform: "Linux",
    detail: "AppImage, x86_64",
    href: `${RELEASE}/Spar-${VERSION}-x86_64.AppImage`,
    alt: { label: ".deb", href: `${RELEASE}/Spar-${VERSION}-amd64.deb` },
  },
];

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
