import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ExternalLink, Ellipsis, Laptop, Loader2, Lock, LogOut, Moon, Plus, RotateCw, ShieldCheck, Sun, Trash2 } from "lucide-react";
import type { Language } from "@spar/domain";
import type { SparApi, ProviderId, ProviderInventory, SubscriptionUsage, ThemePreference, UsageWindow } from "../../../shared/api";
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { message } from "@/lib/format";
import { credentialStore, deviceNoun } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { refreshProviders } from "../../hooks/use-providers";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { ProviderGlyph } from "../common/ProviderGlyph";
import { SparWordmark } from "../common/SparWordmark";
import { AboutSpar } from "../settings/AboutSpar";
import { ProviderConnectDialog } from "../settings/ProviderConnectDialog";
import { SparDots } from "@/components/common/SparDots";

type Provider = ProviderInventory["providers"][number];

const LANGUAGES: Language[] = ["javascript", "typescript", "cpp"];

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
      <div className="overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card shadow-[var(--app-shadow-card)]">
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
        className="inline-flex h-7 max-w-[11.5rem] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-background px-2 text-ui text-foreground transition-colors outline-none hover:bg-accent aria-expanded:bg-accent focus-visible:border-[var(--border-strong)] dark:bg-input/30 dark:hover:bg-input/50"
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
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A subscription's remaining quota, in the only two windows either upstream
 *  rations by. The ring reads the weekly window because that is the one that
 *  ends a week's work; the card behind it spells both out. */
function UsageRing({ provider, api }: { provider: Provider; api: SparApi | undefined }) {
  const [usage, setUsage] = useState<SubscriptionUsage | null>(null);
  const [read, setRead] = useState(false);

  useEffect(() => {
    if (!api || provider.kind !== "subscription") return;
    let live = true;
    void api.providerUsage(provider.id)
      .then((value) => { if (live) setUsage(value); })
      .catch(() => undefined)
      .finally(() => { if (live) setRead(true); });
    return () => { live = false; };
  }, [api, provider.id, provider.kind]);

  const weekly = usage?.windows.find((window) => window.kind === "weekly") ?? null;
  const fiveHour = usage?.windows.find((window) => window.kind === "five-hour") ?? null;
  /* Nothing to say and nothing still coming: no dimmed ring standing in for a
     reading that will never arrive. ChatGPT reports quota only on a turn's own
     response headers, so this row stays empty until one has run. */
  if (provider.kind !== "subscription" || (read && !weekly && !fiveHour)) return null;

  const left = weekly ? percentLeft(weekly) : 0;
  return (
    <HoverCard>
      {/* A button, not Radix's default anchor: this is not a link, and focusing
          it is the only way the card opens without a pointer. */}
      <HoverCardTrigger asChild>
        <button
          aria-label={`${provider.name} subscription usage`}
          className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground"
          type="button"
        >
          <svg className={cn("size-4 -rotate-90", weekly ? "" : "opacity-30")} viewBox="0 0 20 20">
            <circle className="fill-none stroke-current opacity-25" cx="10" cy="10" r="8" strokeWidth="3" />
            <circle
              className="fill-none stroke-current"
              cx="10"
              cy="10"
              pathLength={100}
              r="8"
              strokeDasharray={`${left} 100`}
              strokeLinecap="round"
              strokeWidth="3"
            />
          </svg>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-auto min-w-[13rem] gap-1 p-0 py-2 tabular-nums">
        <UsageLine entry={fiveHour} label="5 hours" />
        <UsageLine entry={weekly} label="Weekly" />
      </HoverCardContent>
    </HoverCard>
  );
}

function UsageLine({ label, entry }: { label: string; entry: UsageWindow | null }) {
  return (
    <div className="flex items-center justify-between gap-6 px-3 py-0.5 text-ui">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{entry ? describeWindow(entry) : "Not available"}</span>
    </div>
  );
}

const percentLeft = (entry: UsageWindow) => Math.min(100, Math.max(0, Math.round(100 - entry.usedPercent)));

/** Once a window is spent, when it comes back is the only useful thing left to
 *  say about it. Above zero, how much is left says it better than a reset time. */
function describeWindow(entry: UsageWindow) {
  const left = percentLeft(entry);
  if (left > 0 || entry.resetsAt === null) return `${left}% left`;
  return `resets ${new Date(entry.resetsAt * 1_000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function ProviderRow({
  provider,
  api,
  isDefault,
  onModel,
  onMakeDefault,
  onOpen,
  onDisconnect,
  onKeyUrl,
}: {
  provider: Provider;
  api: SparApi | undefined;
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

      <UsageRing api={api} provider={provider} />

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${provider.name} options`}
          className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
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

export function SettingsPage({
  api,
  language,
  onLanguageChange,
  onSignedOut,
  onThemeChange,
  theme,
}: {
  api: SparApi | undefined;
  language: Language;
  onLanguageChange(language: Language): void;
  onSignedOut(): Promise<void>;
  onThemeChange(theme: ThemePreference): Promise<void>;
  theme: ThemePreference;
}) {
  const [inventory, setInventory] = useState<ProviderInventory | null>(null);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [themeBusy, setThemeBusy] = useState(false);
  const [languageBusy, setLanguageBusy] = useState(false);
  const [accountAction, setAccountAction] = useState<"sign-out" | "delete" | null>(null);

  /* Through the shared store, not the bridge directly: connecting here has to
     retire the "no model provider" notice on the composer waiting behind this
     page, not only the rows on it. */
  const refresh = useCallback(async () => {
    if (!api) return;
    setInventory(await refreshProviders());
  }, [api]);

  useEffect(() => { void refresh().catch((cause) => setError(message(cause))); }, [refresh]);

  const connected = useMemo(() => inventory?.providers.filter((provider) => provider.state !== "disconnected") ?? [], [inventory]);
  const available = useMemo(() => inventory?.providers.filter((provider) => provider.state === "disconnected") ?? [], [inventory]);
  const defaultProvider = useMemo(
    () => connected.find((provider) => provider.id === inventory?.defaultModel.provider),
    [connected, inventory],
  );

  const open = (provider: Provider) => {
    setSelected(provider);
    setError("");
  };

  const setDefault = async (provider: Provider, nextModel: string) => {
    if (!api) return;
    setError("");
    try { await api.setDefaultProvider(provider.id, nextModel); await refresh(); }
    catch (cause) { setError(message(cause)); }
  };

  const disconnect = async (provider: Provider) => {
    if (!api) return;
    setError("");
    try { await api.disconnectProvider(provider.id); await refresh(); setSelected(null); }
    catch (cause) { setError(message(cause)); }
  };

  const changeLanguage = (next: Language) => {
    if (!api) return;
    setLanguageBusy(true);
    setError("");
    void api.setPreferredLanguage(next).then(() => onLanguageChange(next)).catch((cause) => setError(message(cause))).finally(() => setLanguageBusy(false));
  };

  const finishAccountAction = async () => {
    if (!api || !accountAction) return;
    setBusy(true); setError("");
    try {
      if (accountAction === "delete") await api.deleteAccount();
      else await api.signOut();
      await onSignedOut();
      setAccountAction(null);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };

  return (
    <div className="app-scroll h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[42rem] px-6 pb-20 pt-9">
        <h1 className="text-[1.55rem] font-semibold tracking-[-0.035em]">Settings</h1>
        <p className="mt-1 text-content text-muted-foreground">{`Appearance and model runtime for this ${deviceNoun}.`}</p>

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

        <Group label="Training">
          <Row className="gap-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-content font-medium">Language for new sessions</p>
              <p className="mt-0.5 text-ui text-muted-foreground">The default every session starts in. Asking for another language inside a session still wins.</p>
            </div>
            {/* Marks, not names: three of them side by side is exactly where a logo
                beats a word, and the name still reaches the pointer and the reader. */}
            <div className="flex shrink-0 gap-1" role="radiogroup" aria-label="Language for new sessions">
              {LANGUAGES.map((option) => (
                <button
                  aria-checked={language === option}
                  aria-label={LANGUAGE_LABEL[option]}
                  className={cn(
                    "grid size-9 place-items-center rounded-[var(--radius-lg)] transition-all duration-150",
                    languageBusy && "pointer-events-none opacity-60",
                    language === option
                      ? "bg-accent text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]"
                      : "text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground",
                  )}
                  key={option}
                  onClick={() => language !== option && changeLanguage(option)}
                  role="radio"
                  title={LANGUAGE_LABEL[option]}
                  type="button"
                >
                  <LanguageGlyph className="size-[1.15rem]" language={option} />
                </button>
              ))}
            </div>
          </Row>
        </Group>

        <Group label="Providers">
          {!inventory && (
            <Row>
              <SparDots className="text-muted-foreground" pattern="pulse" size={16} />
              <span className="text-ui text-muted-foreground">Reading the provider inventory…</span>
            </Row>
          )}
          {connected.map((provider) => (
            <ProviderRow
              api={api}
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
          <Group label="Agent">
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
            detail={`API keys and refresh tokens are stored in ${credentialStore} and resolved by the main process immediately before a run.`}
            title="Credential isolation"
          />
          <Boundary
            badge={<><ShieldCheck className="size-3" />Enforced</>}
            detail="Every provider protocol feeds the same Spar agent inside its isolated utility process."
            title="Agent isolation"
            tone="success"
          />
        </Group>

        <Group label="Account">
          <Row>
            <div className="min-w-0 flex-1">
              <p className="text-content font-medium">Sign out</p>
              <p className="mt-0.5 text-ui text-muted-foreground">Remove this account and clear its sessions from this {deviceNoun}. Anything already synced stays in your cloud history.</p>
            </div>
            <Button onClick={() => setAccountAction("sign-out")} size="sm" variant="secondary"><LogOut />Sign out</Button>
          </Row>
          <Row>
            <div className="min-w-0 flex-1">
              <p className="text-content font-medium">Delete account</p>
              <p className="mt-0.5 text-ui text-muted-foreground">Permanently remove your account and cloud-backed learning history. This cannot be undone.</p>
            </div>
            <Button onClick={() => setAccountAction("delete")} size="sm" variant="destructive"><Trash2 />Delete account</Button>
          </Row>
        </Group>

        <AboutSpar />
      </div>

      <ProviderConnectDialog api={api} onClose={() => setSelected(null)} onConnected={refresh} provider={selected} />

      <Dialog onOpenChange={(next) => { if (!next && !busy) setAccountAction(null); }} open={!!accountAction}>
        <DialogContent className="sm:max-w-[28rem]">
          <DialogHeader>
            <DialogTitle>{accountAction === "delete" ? "Delete your account?" : "Sign out of Spar?"}</DialogTitle>
            <DialogDescription>
              {accountAction === "delete"
                ? "This permanently deletes your account, synced sessions, attempts, ability evidence, and local workspaces."
                : `This clears your sessions, challenges, and workspaces from this ${deviceNoun}. Spar pushes anything still pending first, and signing back in restores nothing that never reached the cloud.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={busy} onClick={() => setAccountAction(null)} variant="secondary">Cancel</Button>
            <Button disabled={busy} onClick={() => void finishAccountAction()} variant={accountAction === "delete" ? "destructive" : "default"}>
              {busy && <Loader2 className="animate-spin" />}{accountAction === "delete" ? "Delete permanently" : "Sign out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
