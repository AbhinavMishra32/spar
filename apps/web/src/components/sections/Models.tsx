import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";
import { ArrowGlyph } from "@/components/icons";
import { ProviderGlyph, type ProviderId } from "@/components/providers";

type Route = "Subscription" | "API key" | "Local";

const PROVIDERS: readonly { id: ProviderId; name: string; route: Route }[] = [
  { id: "openai-codex", name: "OpenAI Codex", route: "Subscription" },
  { id: "claude-code", name: "Claude Code", route: "Subscription" },
  { id: "github-copilot", name: "GitHub Copilot", route: "Subscription" },
  { id: "openai", name: "OpenAI", route: "API key" },
  { id: "anthropic", name: "Anthropic", route: "API key" },
  { id: "google", name: "Google", route: "API key" },
  { id: "xai", name: "xAI", route: "API key" },
  { id: "deepseek", name: "DeepSeek", route: "API key" },
  { id: "moonshotai", name: "Moonshot", route: "API key" },
  { id: "zai", name: "Z.ai", route: "API key" },
  { id: "minimax", name: "MiniMax", route: "API key" },
  { id: "openrouter", name: "OpenRouter", route: "API key" },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", route: "API key" },
  { id: "cloudflare-ai-gateway", name: "Cloudflare Gateway", route: "API key" },
  { id: "cline", name: "Cline", route: "API key" },
  { id: "ollama", name: "Ollama", route: "Local" },
  { id: "lm-studio", name: "LM Studio", route: "Local" },
];

const ROUTES: readonly { route: Route; line: string }[] = [
  { route: "Subscription", line: "Sign in with a plan you already pay for. No key to paste." },
  { route: "API key", line: "Your own key, held in the system keychain." },
  { route: "Local", line: "Nothing leaves the machine." },
];

export function Models() {
  return (
    <Section id="models" bloom="tr">
      <SectionHead
        index="10"
        label="Bring your own model"
        title="Use whichever model you want to drive it."
        lede="Spar doesn't ship one and doesn't resell one. There is no Spar subscription — point it at a model you already pay for, or run one on your own machine. Your ability map, attempts and history belong to Spar's training system, not to a model provider, so switching models doesn't reset what it knows about you."
      />

      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((provider, index) => (
          <Reveal key={provider.id} delay={(index % 3) * 70}>
            <div className="group flex h-full items-center gap-4 rounded-xl border border-line bg-surface px-5 py-4 transition-colors duration-300 hover:border-line-strong hover:bg-surface-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] transition-transform duration-300 group-hover:scale-[1.08]">
                <ProviderGlyph provider={provider.id} className="size-[19px]" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[0.95rem] leading-tight">{provider.name}</span>
                <span className="mt-1 block font-mono text-[10px] tracking-[0.14em] text-ghost uppercase">
                  {provider.route}
                </span>
              </span>
            </div>
          </Reveal>
        ))}

        <Reveal delay={140}>
          <a
            href="https://github.com/AbhinavMishra32/spar#bring-your-own-model"
            target="_blank"
            rel="noreferrer"
            className="group flex h-full items-center gap-4 rounded-xl border border-dashed border-line bg-transparent px-5 py-4 transition-colors duration-300 hover:border-line-strong"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-faint transition-colors group-hover:text-paper">
              +
            </span>
            <span className="min-w-0">
              <span className="block text-[0.95rem] leading-tight">Anything OpenAI-compatible</span>
              <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-ghost uppercase">
                name the endpoint
                <ArrowGlyph className="size-3 transition-transform group-hover:translate-x-0.5" />
              </span>
            </span>
          </a>
        </Reveal>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {ROUTES.map((entry, index) => (
          <Reveal key={entry.route} delay={index * 80}>
            <div className="h-full rounded-xl border border-line bg-surface p-5">
              <p className="font-mono text-[10px] tracking-[0.18em] text-faint uppercase">{entry.route}</p>
              <p className="mt-2.5 text-[0.9rem] leading-relaxed text-muted">{entry.line}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={140}>
        <p className="lede mt-12 max-w-[64ch]">
          Your challenge and your conversation with the agent go to whichever provider you picked, because
          that is what running a model means. Run a local one if that matters —{" "}
          <span className="text-paper">Spar itself has no analytics and no telemetry.</span>
        </p>
      </Reveal>
    </Section>
  );
}
