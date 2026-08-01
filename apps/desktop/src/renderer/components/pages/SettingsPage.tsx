import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, ChevronRight, GitBranch, KeyRound, Loader2, Lock, Plug, Server, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import type { PracticeApi, ProviderId, ProviderInventory, ProviderOAuthEvent } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { message } from "@/lib/format";

type Provider = ProviderInventory["providers"][number];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--app-shadow-card)]">
      <h2 className="border-b border-border bg-[var(--color-background-elevated-secondary)] px-3.5 py-2 text-ui font-semibold">{title}</h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function ProviderMark({ provider }: { provider: Provider }) {
  const iconClass = "size-4";
  const icon = provider.id === "openai-codex" ? <Sparkles className={iconClass} />
    : provider.id === "claude-code" || provider.id === "anthropic" ? <Bot className={iconClass} />
    : provider.id === "github-copilot" ? <GitBranch className={iconClass} />
    : provider.kind === "local" ? <Server className={iconClass} />
    : provider.kind === "custom" ? <Plug className={iconClass} />
    : <KeyRound className={iconClass} />;
  return <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">{icon}</span>;
}

function ProviderRow({ provider, active, onOpen, onModel }: { provider: Provider; active: boolean; onOpen(): void; onModel(model: string): void }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-3.5 py-2.5">
      <ProviderMark provider={provider} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-content font-medium">{provider.name}</p>
          {active && <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">DEFAULT</span>}
          {provider.state === "auth-expired" && <span className="text-ui-sm text-destructive">Expired</span>}
        </div>
        <p className="truncate text-ui text-muted-foreground">{provider.description}</p>
      </div>
      {provider.state === "connected" && provider.models.length > 0 && (
        <select
          aria-label={`${provider.name} model`}
          className="h-7 max-w-48 rounded-lg border border-border bg-background px-2 text-ui outline-none focus-visible:border-[var(--border-strong)]"
          onChange={(event) => onModel(event.target.value)}
          value={provider.selectedModel}
        >
          {provider.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      )}
      <Button onClick={onOpen} size="sm" variant={provider.state === "connected" ? "outline" : "secondary"}>
        {provider.state === "connected" ? "Update" : "Connect"}
        <ChevronRight data-icon="inline-end" />
      </Button>
    </div>
  );
}

export function SettingsPage({ api }: { api: PracticeApi | undefined }) {
  const [inventory, setInventory] = useState<ProviderInventory | null>(null);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [secret, setSecret] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [oauth, setOauth] = useState<ProviderOAuthEvent | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!api) return;
    setInventory(await api.listProviders());
  }, [api]);

  useEffect(() => { void refresh().catch((cause) => setError(message(cause))); }, [refresh]);
  useEffect(() => {
    if (!api) return;
    return api.onProviderOAuthEvent((event) => {
      setOauth((current) => current?.flowId === event.flowId || !current ? event : current);
      if (event.status === "connected") {
        void refresh();
        setBusy(false);
      }
      if (event.status === "error" || event.status === "cancelled") setBusy(false);
    });
  }, [api, refresh]);

  const connected = useMemo(() => inventory?.providers.filter((provider) => provider.state !== "disconnected") ?? [], [inventory]);
  const available = useMemo(() => inventory?.providers.filter((provider) => provider.state === "disconnected") ?? [], [inventory]);

  const open = (provider: Provider) => {
    setSelected(provider);
    setSecret("");
    setModelId(provider.selectedModel || provider.models[0]?.id || "");
    setBaseUrl(provider.baseUrl);
    setOauth(null);
    setManualCode("");
    setError("");
  };

  const setDefault = async (provider: Provider, nextModel: string) => {
    if (!api) return;
    setError("");
    try { await api.setDefaultProvider(provider.id, nextModel); await refresh(); }
    catch (cause) { setError(message(cause)); }
  };

  const save = async () => {
    if (!api || !selected || selected.kind === "subscription") return;
    setBusy(true); setError("");
    try {
      await api.saveProviderSecret({ provider: selected.id as Exclude<ProviderId, "openai-codex" | "claude-code" | "github-copilot">, model: modelId.trim(), baseUrl: baseUrl.trim(), secret });
      await refresh(); setSelected(null);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  const startOAuth = async () => {
    if (!api || !selected || selected.kind !== "subscription") return;
    setBusy(true); setError("");
    try {
      const value = await api.startProviderOAuth(selected.id as "openai-codex" | "claude-code" | "github-copilot");
      setOauth((current) => current?.flowId === value.flowId ? current : { flowId: value.flowId, provider: selected.id, status: "starting", message: "Opening sign-in…" });
    } catch (cause) { setBusy(false); setError(message(cause)); }
  };

  const disconnect = async () => {
    if (!api || !selected) return;
    setBusy(true); setError("");
    try { await api.disconnectProvider(selected.id); await refresh(); setSelected(null); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  const close = (next: boolean) => {
    if (next) return;
    if (api && oauth && !["connected", "cancelled", "error"].includes(oauth.status)) void api.cancelProviderOAuth(oauth.flowId);
    setSelected(null); setOauth(null); setBusy(false); setError("");
  };

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[44rem] px-6 pb-16 pt-8">
        <h1 className="text-[1.35rem] font-semibold tracking-[-0.03em]">AI providers</h1>
        <p className="mt-1 text-content text-muted-foreground">Connect subscriptions, API providers, or local models. Credentials stay outside the renderer.</p>

        {error && !selected && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">{error}</p>}
        {!inventory && <div className="mt-6 flex items-center gap-2 text-ui text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading provider inventory…</div>}

        {connected.length > 0 && (
          <Section title="Connected">
            {connected.map((provider) => <ProviderRow active={inventory?.defaultModel.provider === provider.id} key={provider.id} onModel={(model) => void setDefault(provider, model)} onOpen={() => open(provider)} provider={provider} />)}
          </Section>
        )}
        {available.length > 0 && (
          <Section title="Available providers">
            {available.map((provider) => <ProviderRow active={false} key={provider.id} onModel={() => undefined} onOpen={() => open(provider)} provider={provider} />)}
          </Section>
        )}

        <Section title="Runtime boundary">
          <div className="flex items-start gap-4 px-3.5 py-3">
            <div className="min-w-0 flex-1"><p className="text-content font-medium">Credential isolation</p><p className="mt-0.5 text-ui leading-[1.6] text-muted-foreground">API keys and refresh tokens are stored in macOS Keychain and resolved by the main process immediately before a run.</p></div>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-background-elevated-secondary)] px-2 py-1 text-ui-sm text-muted-foreground"><Lock className="size-3" />Main process only</span>
          </div>
          <div className="flex items-start gap-4 px-3.5 py-3">
            <div className="min-w-0 flex-1"><p className="text-content font-medium">Training Agent isolation</p><p className="mt-0.5 text-ui leading-[1.6] text-muted-foreground">Every provider protocol feeds the same Mastra Training Agent inside its utility process.</p></div>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-background-elevated-secondary)] px-2 py-1 text-ui-sm text-emerald-600 dark:text-emerald-400"><ShieldCheck className="size-3" />Enforced</span>
          </div>
        </Section>
      </div>

      <Dialog onOpenChange={close} open={!!selected}>
        {selected && (
          <DialogContent className="sm:max-w-[30rem]">
            <DialogHeader>
              <div className="flex items-center gap-2.5"><ProviderMark provider={selected} /><DialogTitle>{selected.state === "connected" ? `Update ${selected.name}` : `Connect with ${selected.name}`}</DialogTitle></div>
              <DialogDescription>{selected.kind === "subscription" ? `Practice AI will use your subscription to access ${selected.name} supported models. Sign in to connect your account.` : selected.description}</DialogDescription>
            </DialogHeader>

            {selected.kind === "subscription" ? (
              <div className="space-y-3">
                {oauth && <div className="rounded-lg border border-border bg-muted/30 p-3 text-ui"><p className="font-medium">{oauth.status === "connected" ? "Connected" : oauth.status === "error" ? "Sign-in failed" : "Waiting for sign-in to complete"}</p><p className="mt-1 text-muted-foreground">{oauth.message}</p></div>}
                {oauth?.status === "prompt" && (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <label className="text-ui font-medium" htmlFor="provider-oauth-code">Authorization code</label>
                    <Input autoFocus id="provider-oauth-code" onChange={(event) => setManualCode(event.target.value)} placeholder={oauth.placeholder ?? "Paste code or redirect URL"} value={manualCode} />
                    <Button disabled={busy || (!manualCode.trim() && !oauth.allowEmpty)} onClick={() => { if (api) void api.submitProviderOAuth(oauth.flowId, manualCode); }} size="sm">Continue</Button>
                  </div>
                )}
                {oauth?.status === "connected" && <p className="inline-flex items-center gap-1 text-ui text-emerald-600"><Check className="size-3.5" />Your subscription is ready for the Training Agent.</p>}
              </div>
            ) : (
              <div className="space-y-3">
                {selected.keyUrl && <p className="text-ui text-muted-foreground">Get a key from <button className="underline underline-offset-2 hover:text-foreground" onClick={() => void api?.openExternal(selected.keyUrl!)} type="button">{selected.name}</button>.</p>}
                <label className="block space-y-1.5 text-ui font-medium">Model<Input list={`models-${selected.id}`} onChange={(event) => setModelId(event.target.value)} value={modelId} /></label>
                <datalist id={`models-${selected.id}`}>{selected.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist>
                <label className="block space-y-1.5 text-ui font-medium">Base URL<Input onChange={(event) => setBaseUrl(event.target.value)} value={baseUrl} /></label>
                {selected.kind !== "local" && <label className="block space-y-1.5 text-ui font-medium">API Key<Input autoComplete="off" onChange={(event) => setSecret(event.target.value)} placeholder={selected.state === "connected" ? "Leave blank to keep the current key" : "Stored only in macOS Keychain"} type="password" value={secret} /></label>}
              </div>
            )}

            {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">{error}</p>}
            <DialogFooter className="justify-between sm:justify-between">
              <div>{selected.state === "connected" && <Button disabled={busy} onClick={() => void disconnect()} variant="destructive"><Trash2 />Disconnect</Button>}</div>
              <div className="flex gap-2">
                <Button onClick={() => close(false)} variant="secondary">Cancel</Button>
                {selected.kind === "subscription"
                  ? <Button disabled={busy || (!!oauth && !["error", "cancelled"].includes(oauth.status))} onClick={() => void startOAuth()}>{busy && <Loader2 className="animate-spin" />}Connect</Button>
                  : <Button disabled={busy || !modelId.trim() || !baseUrl.trim() || (selected.kind === "api-key" && selected.state !== "connected" && !secret.trim())} onClick={() => void save()}>{busy && <Loader2 className="animate-spin" />}{selected.state === "connected" ? "Update" : "Connect"}</Button>}
              </div>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
