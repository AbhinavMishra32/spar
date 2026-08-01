import { useState } from "react";
import { Check, KeyRound, Lock, ShieldCheck } from "lucide-react";
import type { PracticeApi } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { message } from "@/lib/format";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--app-shadow-card)]">
      <h2 className="border-b border-border bg-[var(--color-background-elevated-secondary)] px-3.5 py-2 text-ui font-semibold">
        {title}
      </h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function Row({
  title,
  description,
  control,
  children,
}: {
  title: string;
  description: string;
  control?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-3.5 py-3">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-content font-medium">{title}</p>
          <p className="mt-0.5 text-ui leading-[1.6] text-muted-foreground">{description}</p>
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children}
    </div>
  );
}

function Locked({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-background-elevated-secondary)] px-2 py-1 text-ui-sm text-muted-foreground">
      <Lock className="size-3" />
      {children}
    </span>
  );
}

export function SettingsPage({ api }: { api: PracticeApi | undefined }) {
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!api) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await api.saveProviderSecret({
        provider: "openrouter",
        model: "openrouter/free",
        baseUrl: "https://openrouter.ai/api/v1",
        secret,
      });
      setSecret("");
      setSaved(true);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[44rem] px-6 pb-16 pt-8">
        <h1 className="text-[1.35rem] font-semibold tracking-[-0.03em]">Settings</h1>
        <p className="mt-1 text-content text-muted-foreground">Runtime, privacy, and execution boundaries.</p>

        <Section title="AI provider">
          <Row
            description="Routes each request to a compatible free model on OpenRouter."
            title="OpenRouter free models router"
          >
            <div className="mt-3 max-w-[30rem]">
              <label className="mb-1.5 flex items-center gap-1.5 text-ui font-medium" htmlFor="openrouter-key">
                <KeyRound className="size-3 text-muted-foreground" />
                API key
              </label>
              <div className="flex gap-2">
                <input
                  autoComplete="off"
                  className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-ui outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground/70 focus-visible:border-[var(--border-strong)]"
                  id="openrouter-key"
                  onChange={(event) => {
                    setSecret(event.target.value);
                    setSaved(false);
                  }}
                  placeholder="Stored only in the macOS Keychain"
                  type="password"
                  value={secret}
                />
                <Button disabled={saving || secret.trim().length < 8} onClick={() => void save()} size="sm">
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
              {error && <p className="mt-1.5 text-ui text-destructive">{error}</p>}
              {saved && (
                <p className="mt-1.5 inline-flex items-center gap-1 text-ui text-[var(--success)]">
                  <Check className="size-3" />
                  Saved to the macOS Keychain. The renderer cannot read it back.
                </p>
              )}
            </div>
          </Row>

          <Row
            control={<Locked>Main process only</Locked>}
            description="The configured Practice AI provider is authoritative. The authenticated gateway is used only when no local key exists."
            title="Provider resolution"
          />
        </Section>

        <Section title="Execution">
          <Row
            control={
              <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-background-elevated-secondary)] px-2 py-1 text-ui-sm text-[var(--success)]">
                <ShieldCheck className="size-3" />
                Enforced
              </span>
            }
            description="Generated programs run in per-session workspaces under time and output limits, in a separate utility process."
            title="Workspace isolation"
          />
          <Row
            control={<Locked>Sandboxed</Locked>}
            description="The renderer has no Node.js access. All persistence and permissions are owned by the main process."
            title="Renderer boundary"
          />
        </Section>
      </div>
    </div>
  );
}
