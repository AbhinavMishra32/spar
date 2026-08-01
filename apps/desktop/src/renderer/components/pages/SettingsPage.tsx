import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ExternalLink, Ellipsis, Laptop, Loader2, Lock, Moon, Plus, RotateCw, ShieldCheck, Sun, Trash2 } from "lucide-react";
import type { SparApi, ProviderId, ProviderInventory, ProviderOAuthEvent, ThemePreference } from "../../../shared/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { message } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProviderGlyph } from "../common/ProviderGlyph";
import { SparWordmark } from "../common/SparWordmark";

type Provider = ProviderInventory["providers"][number];

const KIND_LABEL: Record<Provider["kind"], string> = {
  subscription: "Subscription",
  "api-key": "API",
  local: "Local",
  custom: "Custom",
};

/** Ordered so the connect menu groups read the way the list itself does. */
const KIND_ORDER: Array<Provider["kind"]> = ["subscription", "api-key", "local", "custom"];

/** A labelled stack of rows. The label sits above the card, not inside it — the
 *  card is then one uninterrupted surface instead of a header plus a body. */
function Group({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("mt-7", className)}>
      <h2 className="mb-2 px-0.5 text-ui font-medium text-muted-foreground">{label}</h2>
      <div className="overflow-hidden rounded-[calc(0.875rem*var(--squircle-factor))] border border-border bg-card shadow-[var(--app-shadow-card)]">
        <div className="divide-y divide-border">{children}</div>
      </div>
    </section>
  );
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex min-h-[3.375rem] items-center gap-3 px-3.5 py-2", className)}>{children}</div>;
}

/** Bare mark, no tile — the glyph reads as a logo rather than a favicon. */
function Mark({ provider }: { provider: ProviderId }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center text-foreground/85">
      <ProviderGlyph className="size-[1.15rem]" provider={provider} />
    </span>
  );
}

function ModelPicker({ provider, onSelect }: { provider: Provider; onSelect(model: string): void }) {
  const current = provider.models.find((model) => model.id === provider.selectedModel);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-7 max-w-[11.5rem] shrink-0 items-center gap-1.5 rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2 text-ui text-foreground transition-colors outline-none hover:bg-accent aria-expanded:bg-accent focus-visible:border-[var(--border-strong)] dark:bg-input/30 dark:hover:bg-input/50"
        title={`${provider.name} model`}
      >
        <ProviderGlyph className="size-3.5 shrink-0 opacity-70" provider={provider.id} />
        <span className="truncate">{current?.name ?? provider.selectedModel}</span>
        <ChevronDown className="size-3 shrink-0 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 min-w-[14rem]">
        <DropdownMenuLabel>{provider.name}</DropdownMenuLabel>
        {provider.models.map((model) => (
          <DropdownMenuCheckItem
            checked={model.id === provider.selectedModel}
            key={model.id}
            onSelect={() => onSelect(model.id)}
          >
            <span className="min-w-0 flex-1 truncate">{model.name}</span>
            {model.reasoning && <span className="shrink-0 text-ui-sm text-muted-foreground">reasoning</span>}
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProviderRow({
  provider,
  isDefault,
  onModel,
  onMakeDefault,
  onOpen,
  onDisconnect,
  onKeyUrl,
}: {
  provider: Provider;
  isDefault: boolean;
  onModel(model: string): void;
  onMakeDefault(): void;
  onOpen(): void;
  onDisconnect(): void;
  onKeyUrl(): void;
}) {
  const expired = provider.state === "auth-expired";

  return (
    <Row>
      <Mark provider={provider.id} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-content font-medium">{provider.name}</p>
          {isDefault && (
            <span className="shrink-0 rounded-full bg-success/12 px-1.5 py-px text-ui-sm font-medium text-success">Default</span>
          )}
          {expired && (
            <span className="shrink-0 rounded-full bg-destructive/12 px-1.5 py-px text-ui-sm font-medium text-destructive">
              Sign in again
            </span>
          )}
        </div>
        <p className="truncate text-ui text-muted-foreground">{KIND_LABEL[provider.kind]}</p>
      </div>

      {provider.models.length > 0 && <ModelPicker onSelect={onModel} provider={provider} />}

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${provider.name} options`}
          className="grid size-7 shrink-0 place-items-center rounded-[min(var(--radius-md),12px)] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isDefault && provider.models.length > 0 && (
            <DropdownMenuItem onSelect={onMakeDefault}>
              <Check />
              Use as default
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onOpen}>
            {provider.kind === "subscription" ? <RotateCw /> : <Lock />}
            {provider.kind === "subscription" ? "Reconnect account" : "Edit credentials"}
          </DropdownMenuItem>
          {provider.keyUrl && (
            <DropdownMenuItem onSelect={onKeyUrl}>
              <ExternalLink />
              Get an API key
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDisconnect} variant="destructive">
            <Trash2 />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Row>
  );
}

/** The last row of the providers card: one affordance that opens everything
 *  still available, grouped by how it authenticates. */
function ConnectRow({ available, onPick }: { available: Provider[]; onPick(provider: Provider): void }) {
  const groups = KIND_ORDER.map((kind) => [kind, available.filter((provider) => provider.kind === kind)] as const).filter(
    ([, list]) => list.length > 0,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 px-3.5 py-2.5 text-ui text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground">
        <span className="grid size-6 shrink-0 place-items-center">
          <Plus className="size-4" />
        </span>
        Connect a provider
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-[15rem]">
        {groups.map(([kind, list], groupIndex) => (
          <div key={kind}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{KIND_LABEL[kind]}</DropdownMenuLabel>
            {list.map((provider) => (
              <DropdownMenuItem key={provider.id} onSelect={() => onPick(provider)}>
                <ProviderGlyph className="size-3.5" provider={provider.id} />
                <span className="truncate">{provider.name}</span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Boundary({ title, detail, badge, tone = "muted" }: { title: string; detail: string; badge: React.ReactNode; tone?: "muted" | "success" }) {
  return (
    <Row className="items-start gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-content font-medium">{title}</p>
        <p className="mt-0.5 text-ui leading-[1.6] text-muted-foreground">{detail}</p>
      </div>
      <span
        className={cn(
          "mt-px inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-background-elevated-secondary)] px-2 py-1 text-ui-sm",
          tone === "success" ? "text-success" : "text-muted-foreground",
        )}
      >
        {badge}
      </span>
    </Row>
  );
}

export function SettingsPage({ api, onThemeChange, theme }: { api: SparApi | undefined; onThemeChange(theme: ThemePreference): Promise<void>; theme: ThemePreference }) {
  const [inventory, setInventory] = useState<ProviderInventory | null>(null);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [secret, setSecret] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [oauth, setOauth] = useState<ProviderOAuthEvent | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [themeBusy, setThemeBusy] = useState(false);

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
  const defaultProvider = useMemo(
    () => connected.find((provider) => provider.id === inventory?.defaultModel.provider),
    [connected, inventory],
  );

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

  const disconnect = async (provider: Provider) => {
    if (!api) return;
    setError("");
    try { await api.disconnectProvider(provider.id); await refresh(); setSelected(null); }
    catch (cause) { setError(message(cause)); }
  };

  const close = (next: boolean) => {
    if (next) return;
    if (api && oauth && !["connected", "cancelled", "error"].includes(oauth.status)) void api.cancelProviderOAuth(oauth.flowId);
    setSelected(null); setOauth(null); setBusy(false); setError("");
  };

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[42rem] px-6 pb-20 pt-9">
        <h1 className="text-[1.55rem] font-semibold tracking-[-0.035em]">Settings</h1>
        <p className="mt-1 text-content text-muted-foreground">Appearance and model runtime for this Mac.</p>

        {error && !selected && (
          <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">{error}</p>
        )}

        <Group label="Appearance">
          <Row className="gap-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-content font-medium">Theme</p>
              <p className="mt-0.5 text-ui text-muted-foreground">Pick an appearance, or follow the system setting.</p>
            </div>
            <Segmented
              ariaLabel="Application theme"
              disabled={themeBusy}
              onChange={(value) => {
                setThemeBusy(true);
                setError("");
                void onThemeChange(value).catch((cause) => setError(message(cause))).finally(() => setThemeBusy(false));
              }}
              options={[
                { value: "system", label: "Auto", icon: Laptop },
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
              ]}
              value={theme}
            />
          </Row>
        </Group>

        <Group label="Providers">
          {!inventory && (
            <Row>
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              <span className="text-ui text-muted-foreground">Reading the provider inventory…</span>
            </Row>
          )}
          {connected.map((provider) => (
            <ProviderRow
              isDefault={inventory?.defaultModel.provider === provider.id}
              key={provider.id}
              onDisconnect={() => void disconnect(provider)}
              onKeyUrl={() => provider.keyUrl && void api?.openExternal(provider.keyUrl)}
              onMakeDefault={() => void setDefault(provider, provider.selectedModel)}
              onModel={(model) => void setDefault(provider, model)}
              onOpen={() => open(provider)}
              provider={provider}
            />
          ))}
          {available.length > 0 && <ConnectRow available={available} onPick={open} />}
        </Group>

        {defaultProvider && (
          <Group label="Training Agent">
            <Row className="gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-content font-medium">Default model</p>
                <p className="mt-0.5 text-ui text-muted-foreground">Every new run starts here until you switch provider.</p>
              </div>
              <ModelPicker onSelect={(model) => void setDefault(defaultProvider, model)} provider={defaultProvider} />
            </Row>
          </Group>
        )}

        <Group label="Runtime boundary">
          <Boundary
            badge={<><Lock className="size-3" />Main process only</>}
            detail="API keys and refresh tokens are stored in macOS Keychain and resolved by the main process immediately before a run."
            title="Credential isolation"
          />
          <Boundary
            badge={<><ShieldCheck className="size-3" />Enforced</>}
            detail="Every provider protocol feeds the same Mastra Training Agent inside its utility process."
            title="Training Agent isolation"
            tone="success"
          />
        </Group>
      </div>

      <Dialog onOpenChange={close} open={!!selected}>
        {selected && (
          <DialogContent className="sm:max-w-[30rem]">
            <DialogHeader>
              <div className="flex items-center gap-2.5">
                <Mark provider={selected.id} />
                <DialogTitle>{selected.state === "connected" ? `Update ${selected.name}` : `Connect ${selected.name}`}</DialogTitle>
              </div>
              <DialogDescription className="flex items-center gap-1.5">
                <SparWordmark className="text-[0.82rem] text-foreground" />
                <span>{selected.kind === "subscription" ? `will use your subscription to reach ${selected.name} models. Sign in to connect the account.` : selected.description}</span>
              </DialogDescription>
            </DialogHeader>

            {selected.kind === "subscription" ? (
              <div className="space-y-3">
                {oauth && (
                  <div className="rounded-xl border border-border bg-[var(--color-background-elevated-secondary)] p-3 text-ui">
                    <p className="flex items-center gap-1.5 font-medium">
                      {!["connected", "error", "cancelled"].includes(oauth.status) && <Loader2 className="size-3 animate-spin" />}
                      {oauth.status === "connected" ? "Connected" : oauth.status === "error" ? "Sign-in failed" : "Waiting for sign-in"}
                    </p>
                    <p className="mt-1 text-muted-foreground">{oauth.message}</p>
                  </div>
                )}
                {oauth?.status === "prompt" && (
                  <div className="space-y-2 rounded-xl border border-border p-3">
                    <label className="text-ui font-medium" htmlFor="provider-oauth-code">Authorization code</label>
                    <Input autoFocus id="provider-oauth-code" onChange={(event) => setManualCode(event.target.value)} placeholder={oauth.placeholder ?? "Paste code or redirect URL"} value={manualCode} />
                    <Button disabled={busy || (!manualCode.trim() && !oauth.allowEmpty)} onClick={() => { if (api) void api.submitProviderOAuth(oauth.flowId, manualCode); }} size="sm">Continue</Button>
                  </div>
                )}
                {oauth?.status === "connected" && <p className="inline-flex items-center gap-1 text-ui text-success"><Check className="size-3.5" />Your subscription is ready for the Training Agent.</p>}
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
              <div>{selected.state === "connected" && <Button disabled={busy} onClick={() => void disconnect(selected)} variant="destructive"><Trash2 />Disconnect</Button>}</div>
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
