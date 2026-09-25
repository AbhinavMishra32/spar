import { FeatureSection, Intro } from "@/components/feature/Feature";
import { ProviderGlyph, providerColor, type ProviderId } from "@/components/providers";

/* Three rows, the way they would sit on a shelf: the routes people use most at
   the front, the long tail behind. Every one is a route the app actually
   ships — nothing here is aspirational. */
const ROWS: readonly (readonly { id: ProviderId; name: string }[])[] = [
  [
    { id: "openai-codex", name: "OpenAI Codex" },
    { id: "claude-code", name: "Claude Code" },
    { id: "github-copilot", name: "GitHub Copilot" },
    { id: "openai", name: "OpenAI" },
    { id: "anthropic", name: "Anthropic" },
    { id: "google", name: "Google" },
  ],
  [
    { id: "xai", name: "xAI" },
    { id: "deepseek", name: "DeepSeek" },
    { id: "ollama", name: "Ollama" },
    { id: "lm-studio", name: "LM Studio" },
    { id: "openrouter", name: "OpenRouter" },
    { id: "moonshotai", name: "Moonshot" },
    { id: "minimax", name: "MiniMax" },
  ],
  [
    { id: "zai", name: "Z.ai" },
    { id: "vercel-ai-gateway", name: "Vercel AI Gateway" },
    { id: "cloudflare-ai-gateway", name: "Cloudflare AI Gateway" },
    { id: "cline", name: "Cline" },
  ],
];

/* A repeatable scatter: the same wall falls the same way on every visit. */
const seed = (a: number, b: number) => {
  const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

/** When a tile settles, as a percentage of the wall's pass through the
 *  viewport. */
function landsAt(row: number, column: number, count: number) {
  const offset = column - (count - 1) / 2;
  return 26 + row * 4 + Math.abs(offset) * 2 + seed(row * 7 + column, 1) * 2;
}

/**
 * Where a tile starts before the scroll brings it down, and when it lands.
 *
 * Tiles fall from above the camera toward their seat, thrown out from the
 * centre so the wall opens rather than drops. The centre of the front row
 * lands first, the edges and the back rows after, so the wall assembles front
 * to back the way you would stock a shelf.
 */
function flight(row: number, column: number, count: number) {
  const offset = column - (count - 1) / 2;
  const a = seed(row * 7 + column, 1);
  const b = seed(row * 7 + column, 2);
  const c = seed(row * 7 + column, 3);
  const start = landsAt(row, column, count) - 15;
  const px = (value: number) => `${value.toFixed(0)}px`;
  const deg = (value: number) => `${value.toFixed(1)}deg`;
  const pct = (value: number) => `${value.toFixed(1)}%`;
  return {
    ["--dx" as string]: px(offset * 46 + (a - 0.5) * 60),
    ["--dy" as string]: px(-(80 + b * 110)),
    ["--dz" as string]: px(140 + c * 180),
    ["--rx" as string]: deg(-(40 + a * 35)),
    ["--rz" as string]: deg((b - 0.5) * 60),
    ["--land-from" as string]: pct(start),
    ["--land-to" as string]: pct(start + 15),
  };
}

/** Which models can drive it, shown as the icons you would recognise. */
export function Providers() {
  const names = ROWS.flat().map((provider) => provider.name);
  return (
    <FeatureSection id="models">
      <Intro
        center
        eyebrow="Bring your own model"
        title="Runs on the model you already have."
        lede="Sign in with a subscription, paste a key, or run one on your own machine."
      />

      <div className="provider-wall relative mt-10 md:mt-12" aria-hidden>
        <div className="provider-wall-floor">
          {ROWS.map((row, index) => (
            <div key={index} className="provider-row" style={{ ["--row" as string]: index }}>
              {row.map((provider, column) => (
                <span
                  key={provider.id}
                  className="provider-tile"
                  style={{ ["--tint" as string]: providerColor(provider.id) ?? "#8b8b94", ...flight(index, column, row.length) }}
                >
                  <span className="provider-tile-body">
                    <ProviderGlyph provider={provider.id} className="size-[46%]" />
                  </span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="sr-only">Supported providers: {names.join(", ")}.</p>
    </FeatureSection>
  );
}
