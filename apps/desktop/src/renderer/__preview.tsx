// Throwaway harness: mounts the surfaces being restyled with a fake bridge so
// they can be screenshotted without the Electron main process. Not shipped.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Target } from "lucide-react";
import "./theme.css";
import type { SparApi, ProviderInventory, ThemePreference } from "../shared/api";
import { SettingsPage } from "./components/pages/SettingsPage";
import { Composer, ComposerPill } from "./components/agent/Composer";

const models = (...names: string[]) => names.map((name) => ({ id: name.toLowerCase().replace(/\s+/g, "-"), name, reasoning: name.includes("5") }));

const inventory: ProviderInventory = {
  defaultModel: { provider: "openai-codex", model: "gpt-5.4-mini" },
  providers: [
    { id: "openai-codex", name: "ChatGPT", description: "Reuse your ChatGPT Plus or Pro subscription", kind: "subscription", state: "connected", selectedModel: "gpt-5.4-mini", baseUrl: "", models: models("GPT-5.4 Mini", "GPT-5.4", "GPT-5.4 Codex") },
    { id: "opencode-go", name: "OpenCode Go", description: "OpenCode Go subscription models", kind: "api-key", state: "connected", selectedModel: "glm-5", baseUrl: "https://opencode.ai", models: models("GLM-5", "GLM-5.2", "Qwen3.7 Max") },
    { id: "anthropic", name: "Anthropic", description: "Claude models", kind: "api-key", state: "auth-expired", selectedModel: "claude-opus-5", baseUrl: "https://api.anthropic.com", keyUrl: "https://console.anthropic.com", models: models("Claude Opus 5", "Claude Sonnet 5") },
    { id: "claude-code", name: "Claude", description: "Reuse your Claude Pro or Max subscription", kind: "subscription", state: "disconnected", selectedModel: "", baseUrl: "", models: models("Claude Opus 5") },
    { id: "github-copilot", name: "GitHub Copilot", description: "Reuse your GitHub Copilot subscription", kind: "subscription", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
    { id: "openai", name: "OpenAI", description: "OpenAI API models", kind: "api-key", state: "disconnected", selectedModel: "", baseUrl: "https://api.openai.com/v1", models: models("GPT-5.4") },
    { id: "google", name: "Google", description: "Gemini models", kind: "api-key", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
    { id: "xai", name: "xAI", description: "Grok models", kind: "api-key", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
    { id: "openrouter", name: "OpenRouter", description: "Use models through OpenRouter", kind: "api-key", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
    { id: "deepseek", name: "DeepSeek", description: "DeepSeek models", kind: "api-key", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
    { id: "moonshotai", name: "Moonshot AI", description: "Kimi models", kind: "api-key", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
    { id: "kimi-coding", name: "Kimi Code", description: "Kimi coding plan", kind: "subscription", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
    { id: "zai", name: "Z.ai", description: "GLM models", kind: "api-key", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
    { id: "minimax", name: "MiniMax", description: "MiniMax models", kind: "api-key", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
    { id: "vercel-ai-gateway", name: "Vercel AI Gateway", description: "Any model through Vercel", kind: "api-key", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
    { id: "cloudflare-ai-gateway", name: "Cloudflare AI Gateway", description: "Any model through Cloudflare", kind: "api-key", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
    { id: "ollama", name: "Ollama", description: "Local models via Ollama", kind: "local", state: "disconnected", selectedModel: "", baseUrl: "http://localhost:11434", models: [] },
    { id: "lm-studio", name: "LM Studio", description: "Local models via LM Studio", kind: "local", state: "disconnected", selectedModel: "", baseUrl: "http://localhost:1234", models: [] },
    { id: "custom", name: "Custom endpoint", description: "Any OpenAI-compatible endpoint", kind: "custom", state: "disconnected", selectedModel: "", baseUrl: "", models: [] },
  ],
};

const api = {
  listProviders: async () => inventory,
  onProviderOAuthEvent: () => () => undefined,
  setDefaultProvider: async () => undefined,
  disconnectProvider: async () => undefined,
  openExternal: async () => undefined,
} as unknown as SparApi;

function Preview() {
  const [theme, setTheme] = useState<ThemePreference>("dark");
  const [draft, setDraft] = useState("");

  document.documentElement.classList.toggle("dark", theme === "dark");

  return (
    <div className="app-opaque flex h-full">
      <div className="min-w-0 flex-1">
        <SettingsPage api={api} onThemeChange={async (next) => setTheme(next)} theme={theme} />
      </div>
      <div className="flex w-[30rem] shrink-0 flex-col justify-end gap-4 border-l border-border p-5">
        <Composer
          hint="The agent retrieves your history, then compiles a runnable challenge."
          leading={<ComposerPill icon={Target}>New session</ComposerPill>}
          onChange={setDraft}
          onSubmit={() => setDraft("")}
          placeholder="I want to understand graph algorithms deeply…"
          value={draft}
        />
        <Composer
          leading={
            <>
              <ComposerPill chevron onClick={() => undefined}>typescript</ComposerPill>
              <ComposerPill active chevron onClick={() => undefined}>Remark</ComposerPill>
            </>
          }
          onAttach={() => undefined}
          onChange={() => undefined}
          onSubmit={() => undefined}
          placeholder="Ask for a hint, or explain your approach…"
          value="Why did the memoised version still blow the stack on the 10^5 case?"
        />
        <Composer busy hint="The agent is working…" onChange={() => undefined} onStop={() => undefined} onSubmit={() => undefined} value="" />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Preview />);
