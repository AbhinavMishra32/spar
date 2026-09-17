import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrainCircuit, Check, ChevronDown, ExternalLink, Ellipsis, Eye, Globe, KeyRound, Laptop, Link2, Loader2, Lock, LogOut, Moon, Palette, Plus, RotateCw, Settings2, Sun, Trash2, UserRound } from "lucide-react";
import { LANGUAGES as SUPPORTED_LANGUAGES, type BaselineState, type Language } from "@spar/domain";
import type { SparApi, ProviderAccount, ProviderId, ProviderInventory, SubscriptionUsage, ThemePreference, UsageWindow } from "../../../shared/api";
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
import { Switch } from "@/components/ui/switch";
import { initials, message } from "@/lib/format";
import { credentialStore, deviceNoun } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsHeader, SettingsRow, SettingsSection } from "../settings/layout";
import { SectionRail } from "../settings/SectionRail";
import { SettingsSidebar, type SidebarGroup } from "../settings/SettingsSidebar";
import { refreshProviders } from "../../hooks/use-providers";
import { LanguageGlyph, LANGUAGE_LABEL, SelectableLanguageGlyph } from "../common/LanguageGlyph";
import { ProviderGlyph } from "../common/ProviderGlyph";
import { SparWordmark } from "../common/SparWordmark";
import { AboutSpar } from "../settings/AboutSpar";
import { PracticeSourceGroup } from "../settings/PracticeSource";
import { UpdateSettings } from "../settings/UpdateSettings";
import { ProviderConnectDialog } from "../settings/ProviderConnectDialog";
import { SparDots } from "@/components/common/SparDots";

type Provider = ProviderInventory["providers"][number];
type SettingsSection = "account" | "models" | "connections" | "learning" | "privacy" | "appearance" | "advanced";
type NavItem = SidebarGroup<SettingsSection>["items"][number];

/**
 * Seven destinations under three headings.
 *
 * Seven unlabelled rows floating at the top of a tall empty column read as an
 * unfinished screen, and the fix is to say what the seven are rather than to
 * invent an eighth. The division is the honest one: two pages about this copy
 * of Spar and the person signed into it, three about the machinery that reads
 * and teaches, two about what is kept.
 */
const SETTINGS_NAV: Array<SidebarGroup<SettingsSection>> = [
  {
    label: "Spar",
    items: [
      { id: "account", label: "Account", icon: UserRound, sections: ["Account", "About"] },
      { id: "appearance", label: "Appearance", icon: Palette, sections: ["Appearance", "Updates"] },
    ],
  },
  {
    label: "Training",
    items: [
      { id: "models", label: "Models", icon: BrainCircuit, sections: ["Providers", "Agent", "Web search"] },
      { id: "learning", label: "Learning", icon: Settings2, sections: ["Baseline", "Training preferences"] },
      { id: "connections", label: "Connections", icon: Link2, sections: ["Practice sources"] },
    ],
  },
  {
    label: "Your record",
    items: [
      { id: "privacy", label: "Data & Privacy", icon: Eye, sections: ["Data & Privacy"] },
      { id: "advanced", label: "Learning Engine", icon: Globe, sections: ["Learning Engine", "Raw snapshot"] },
    ],
  },
];

/** Flat, for the one question the groups cannot answer: what this page is called. */
const SETTINGS_PAGES: NavItem[] = SETTINGS_NAV.flatMap((group) => group.items);

/** Resolved in the main process before the window paints, so it is already here. */
const buildInfo = window.spar?.build;

const LANGUAGES: Language[] = [...SUPPORTED_LANGUAGES];

const KIND_LABEL: Record<Provider["kind"], string> = {
  subscription: "Subscription",
  "api-key": "API",
  local: "Local",
  custom: "Custom",
};

/** Ordered so the connect menu groups read the way the list itself does. */
const KIND_ORDER: Array<Provider["kind"]> = ["subscription", "api-key", "local", "custom"];

/**
 * Whether the agent may reach the web, and the key that lets it.
 *
 * Two facts, so two rows. The switch is the setting — a learner who wants a
 * session read only from their own record can have one without throwing their
 * key away — and the key is a credential, which appears once it is relevant and
 * gets out of the way once it is held. An input box sitting open under a key
 * that is already stored is a form asking to be filled in for no reason.
 *
 * Write-only, like every other credential here: the field takes a key and the
 * main process never hands one back, so what these rows can report is whether
 * one is set and where it came from. A key supplied through `EXA_API_KEY` says
 * so rather than showing an empty box that mysteriously works.
 */
function WebSearchRow({ api }: { api: SparApi | undefined }) {
  const [source, setSource] = useState<"keychain" | "env" | "none" | "loading">("loading");
  const [enabled, setEnabled] = useState(true);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  const read = useCallback(async () => {
    if (!api) return;
    const status = await api.webSearchStatus();
    setSource(status.source);
    setEnabled(status.enabled);
  }, [api]);

  useEffect(() => { void read().catch(() => setSource("none")); }, [read]);

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setFailure("");
    try { await run(); setDraft(""); setEditing(false); await read(); }
    catch (cause) { setFailure(message(cause)); }
    finally { setBusy(false); }
  };

  const held = source === "keychain" || source === "env";
  /* The switch reads the setting, but a key-less agent cannot search whatever the
     setting says — so the row shows off, and says why, rather than showing on and
     quietly doing nothing. */
  const active = enabled && held;

  return (
    <>
      <Row className="gap-4">
        <span className={cn("grid size-6 shrink-0 place-items-center transition-colors", active ? "text-foreground/85" : "text-muted-foreground/50")}>
          <Globe className="size-[1.15rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-content font-medium">Web search</p>
          <p className="mt-0.5 text-ui text-muted-foreground">
            {source === "loading"
              ? "Checking…"
              : !held
                ? "Needs an Exa key. Without one the agent works entirely from your own record."
                : enabled
                  ? "The agent can look up what a company's interviews cover or what a library's current API is."
                  : "Off. The agent works entirely from your own record."}
          </p>
        </div>
        <Switch
          aria-label="Web search"
          checked={active}
          disabled={busy || !held}
          onCheckedChange={(next) => void act(async () => api?.setWebSearchEnabled(next))}
        />
      </Row>

      {/* The key. Shown while there is none to hold, and folded away once there
          is — replacing one is a deliberate act, not the default state. */}
      {held && !editing ? (
        <Row className="gap-3">
          <span className="grid size-6 shrink-0 place-items-center text-muted-foreground/70"><KeyRound className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-ui text-muted-foreground">
              {source === "env" ? "Key supplied by the EXA_API_KEY environment variable." : `Key stored in ${credentialStore}.`}
            </p>
          </div>
          {source === "keychain" && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Exa key options"
                className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Ellipsis className="size-4" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}><KeyRound />Replace key</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void api?.openExternal("https://dashboard.exa.ai/api-keys")}><ExternalLink />Exa dashboard</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void act(async () => api?.clearWebSearchKey())} variant="destructive">
                  <Trash2 />Remove key
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </Row>
      ) : source !== "loading" && (source === "none" || editing) ? (
        <Row className="gap-3">
          <span className="grid size-6 shrink-0 place-items-center text-muted-foreground/70"><KeyRound className="size-4" /></span>
          <Input
            autoComplete="off"
            autoFocus={editing}
            className="min-w-0 flex-1 font-mono text-ui"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && draft.trim()) void act(async () => api?.saveWebSearchKey(draft.trim())); if (event.key === "Escape") { setEditing(false); setDraft(""); } }}
            placeholder={editing ? "Paste the replacement key…" : "Paste your Exa API key…"}
            type="password"
            value={draft}
          />
          <Button disabled={busy || !draft.trim()} onClick={() => void act(async () => api?.saveWebSearchKey(draft.trim()))} size="sm">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
          </Button>
          {editing
            ? <Button onClick={() => { setEditing(false); setDraft(""); }} size="sm" variant="ghost">Cancel</Button>
            : <Button onClick={() => void api?.openExternal("https://dashboard.exa.ai/api-keys")} size="sm" variant="ghost"><ExternalLink className="size-3.5" />Get one</Button>}
        </Row>
      ) : null}

      {failure && <Row><p className="text-ui text-destructive">{failure}</p></Row>}
    </>
  );
}

function ComplexityCheckRow({api}:{api:SparApi|undefined}){
  const [enabled,setEnabled]=useState(true);
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState("");
  useEffect(()=>{void api?.complexityCheckStatus().then((value)=>setEnabled(value.enabled)).catch((cause)=>setFailure(message(cause)));},[api]);
  const change=(next:boolean)=>{if(!api)return;setBusy(true);setFailure("");void api.setComplexityCheckEnabled(next).then(()=>setEnabled(next)).catch((cause)=>setFailure(message(cause))).finally(()=>setBusy(false));};
  return <Row className="items-center gap-4 py-3">
    <div className="min-w-0 flex-1">
      <p className="text-content font-medium">Complexity check after a solve</p>
      <p className="mt-0.5 max-w-[28rem] text-ui leading-[1.55] text-muted-foreground">For challenges that explicitly train algorithmic efficiency, ask for time and space complexity before the full post-solve review.</p>
      {failure&&<p className="mt-1 text-ui text-destructive">{failure}</p>}
    </div>
    <Switch aria-label="Complexity check after a solve" checked={enabled} disabled={busy||!api} onCheckedChange={change}/>
  </Row>;
}

/** A labelled stack of rows. The label sits above the card, not inside it — the
 *  card is then one uninterrupted surface instead of a header plus a body. */
/* The page's own two names for the shared vocabulary, kept so every existing
   row reads the same as it did. `Group` is a section and its card together,
   which is what every group on this page happens to be. */
function Group({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <SettingsSection title={label}>
      <SettingsGroup className={className}>{children}</SettingsGroup>
    </SettingsSection>
  );
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <SettingsRow className={className}>{children}</SettingsRow>;
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

/** Which account the subscription on this row is signed in as. Asked once per
 *  mount and answered from the main process's own cache, so the hover it feeds
 *  opens on a value that is already there rather than on a spinner. */
function useProviderAccount(api: SparApi | undefined, provider: Provider) {
  const [account, setAccount] = useState<ProviderAccount | null>(null);
  const wanted = provider.kind === "subscription" && provider.state !== "disconnected";

  useEffect(() => {
    if (!api || !wanted) return;
    let live = true;
    void api.providerAccount(provider.id)
      .then((value) => { if (live) setAccount(value); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [api, provider.id, wanted]);

  return wanted ? account : null;
}

/** The row's name and kind, with the signed-in account behind a hover.
 *
 *  Behind a hover rather than on the row: three subscriptions each showing an
 *  address would put a line of small grey text under every provider, and which
 *  account is a thing you check occasionally, not something you read every time
 *  the page opens. A provider that never answered simply has no hover — the
 *  name is plain text then, and nothing invites a pointer that gets nothing. */
function ProviderIdentity({ account, name }: { account: ProviderAccount | null; name: string }) {
  const label = <span className="block truncate text-content font-medium">{name}</span>;
  if (!account) return label;

  return (
    <HoverCard closeDelay={80} openDelay={180}>
      {/* A button, not the bare text: the card has to open on focus too, or the
          only way to read which account this is would be to own a pointer. */}
      <HoverCardTrigger asChild>
        <button
          className="min-w-0 cursor-default rounded-[var(--radius-sm)] text-left decoration-muted-foreground/40 underline-offset-4 outline-none hover:underline hover:decoration-dotted focus-visible:underline focus-visible:decoration-dotted"
          type="button"
        >
          {label}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-auto max-w-[18rem] px-3 py-2">
        <p className="text-ui text-muted-foreground">Signed in as</p>
        <p className="mt-0.5 truncate text-content text-foreground">{account.label}</p>
      </HoverCardContent>
    </HoverCard>
  );
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
  const account = useProviderAccount(api, provider);

  return (
    <Row>
      <Mark provider={provider.id} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <ProviderIdentity account={account} name={provider.name} />
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
      {/* Carries the row surface, not a bare trigger: it is the last row of the
          card, and without the background it floated below one. */}
      <DropdownMenuTrigger className="flex min-h-[3.25rem] w-full items-center gap-3 bg-[var(--surface-secondary)] p-2.5 text-content text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground">
        <span className="grid size-6 shrink-0 place-items-center">
          <Plus className="size-[1.15rem]" />
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

function LearningEngineInspector({ api }: { api: SparApi | undefined }) {
  const [snapshot,setSnapshot]=useState<Record<string,unknown>|null>(null);
  const [failure,setFailure]=useState("");
  const read=useCallback(()=>{if(!api)return;setFailure("");void api.learningEngine().then(setSnapshot).catch((cause)=>setFailure(message(cause)));},[api]);
  useEffect(read,[read]);
  const model=snapshot?.model as Record<string,unknown>|undefined;
  return <><Group label="Learning Engine">
    <Row><div className="min-w-0 flex-1"><p className="text-content font-medium">Internal learner system</p><p className="mt-0.5 text-ui text-muted-foreground">Structured state, evidence, patterns, training decisions, rating history, and model metadata. This is inspectability—not a normal training surface.</p></div><Button onClick={read} size="sm" variant="outline"><RotateCw data-icon="inline-start" />Refresh</Button></Row>
    <Row><div className="grid w-full grid-cols-3 gap-4 text-ui"><div><p className="text-muted-foreground">Schema</p><p className="mt-0.5 font-mono">v{String(model?.schemaVersion??"…")}</p></div><div><p className="text-muted-foreground">Policy</p><p className="mt-0.5 truncate font-mono">{String(model?.policyVersion??"…")}</p></div><div><p className="text-muted-foreground">Registry</p><p className="mt-0.5 truncate font-mono">{String(model?.abilityRegistry??"…")}</p></div></div></Row>
  </Group>
  <Group label="Raw snapshot"><div className="max-h-[30rem] overflow-auto p-3.5">{failure?<p className="text-ui text-destructive">{failure}</p>:snapshot?<pre className="whitespace-pre-wrap break-words font-mono text-[0.68rem] leading-5 text-muted-foreground">{JSON.stringify(snapshot,null,2)}</pre>:<p className="flex items-center gap-2 text-ui text-muted-foreground"><SparDots pattern="pulse" size={16} />Reading learner state…</p>}</div></Group></>;
}

export function SettingsPage({
  account,
  api,
  language,
  onLanguageChange,
  onSignedOut,
  onThemeChange,
  baseline,
  onBaseline,
  theme,
}: {
  account: { displayName: string; email: string };
  api: SparApi | undefined;
  language: Language;
  onLanguageChange(language: Language): void;
  onSignedOut(): Promise<void>;
  onThemeChange(theme: ThemePreference): Promise<void>;
  baseline: BaselineState;
  onBaseline(): void;
  theme: ThemePreference;
}) {
  const [inventory, setInventory] = useState<ProviderInventory | null>(null);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [themeBusy, setThemeBusy] = useState(false);
  const [languageBusy, setLanguageBusy] = useState(false);
  const [accountAction, setAccountAction] = useState<"sign-out" | "delete" | null>(null);
  const [section, setSection] = useState<SettingsSection>("account");
  /* Both the rail in the margin and the sidebar's search read the rendered
     tree, so the page has to hand them the two nodes it owns: the thing that
     scrolls, and the thing inside it the sections live in. */
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLElement>(null);

  /**
   * Going to a page, and optionally to a heading on it.
   *
   * The heading cannot be scrolled to in the tick that asks for the page — it
   * does not exist yet — and it may not exist in the next one either, since a
   * section can be waiting on its own data. So this polls for it briefly and
   * gives up rather than scrolling to whatever happens to be there. Landing is
   * a flash, not just a scroll: on a page that is nothing but headings,
   * arriving silently at one is indistinguishable from not having moved.
   */
  const goto = useCallback((next: SettingsSection, heading?: string) => {
    setSection(next);
    if (!heading) return;
    let tries = 0;
    const find = () => {
      const node = content.current?.querySelector<HTMLElement>(`[data-settings-section="${CSS.escape(heading)}"] h2`);
      if (!node) {
        if (++tries < 40) setTimeout(find, 50);
        return;
      }
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.classList.remove("settings-search-focus");
      void node.offsetWidth;
      node.classList.add("settings-search-focus");
      setTimeout(() => node.classList.remove("settings-search-focus"), 2_250);
    };
    setTimeout(find, 0);
  }, []);

  /* A page you arrive at is a page you start at the top of. Without this,
     switching from a long page to a short one lands you in its footer. */
  useEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; }, [section]);

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
    /* Two surfaces, not one. The nav sits on the window's own ground — it is
       chrome, and chrome belongs to the window — while the page it points at is
       a sheet laid on top, the same card every other content pane gets. A
       settings screen drawn as one flat field reads as a web page that happened
       to open here rather than as a place in the app. */
    <div className="flex h-full min-h-0">
      <SettingsSidebar
        active={section}
        footer={
          /* The bottom of the column, and the reason it no longer reads as
             empty: a list that ends in mid-air looks unfinished, one that ends
             on a line of type looks placed. It also answers from anywhere in
             Settings the question the About panel answers only from Account. */
          buildInfo ? (
            <p className="mt-auto shrink-0 px-2.5 pt-3 pb-1 text-xs font-medium text-muted-foreground/60">
              Spar {buildInfo.version}
              {!buildInfo.packaged && " · dev"}
            </p>
          ) : null
        }
        groups={SETTINGS_NAV}
        onSelect={goto}
      />


      {/* The sheet: the window's own paper, lifted off the chrome by a hairline
          and a contact shadow rather than by a fill. Everything you operate sits
          on it as a bordered card, so the sheet itself has to stay quiet — a
          tinted page under tinted cards is two materials competing to be the
          background. */}
      <div className="min-w-0 min-h-0 flex-1 p-1.5">
        <div className="settings-sheet relative size-full @container">
          <div className="app-scroll size-full overflow-y-auto rounded-[inherit]" ref={viewport}>
            {/* Wide top padding rather than a title bar: the heading sits in air,
                which is what makes it read as the page's name rather than as the
                first row of the list under it. */}
            <main className="mx-auto w-full max-w-2xl px-8 pt-16 pb-40 text-left" ref={content}>
        <SettingsHeader>
          <h1>{SETTINGS_PAGES.find((item) => item.id === section)?.label ?? "Settings"}</h1>
        </SettingsHeader>

        {error && !selected && (
          <p className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">{error}</p>
        )}

        {/* One rhythm for the whole page. Each group used to carry its own top
            margin, which meant the gap between two groups depended on which
            ones happened to be rendered. */}
        <div className="space-y-8">

        {section === "appearance" && <Group label="Appearance">
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
        </Group>}

        {section === "learning" && <><Group label="Baseline">
          <Row><div className="min-w-0 flex-1"><p className="text-content font-medium">Build your baseline</p><p className="mt-0.5 text-ui text-muted-foreground">{baseline.status === "complete" ? `Complete · ${Math.round(baseline.confidence*100)}% confidence from ${baseline.directEvidenceCount} direct calibration attempts.` : "Direct adaptive calibration is required before personalization can fully begin."}</p></div><Button onClick={onBaseline} size="sm" variant="outline">{baseline.status === "not-started" || baseline.status === "skipped" ? "Begin" : baseline.status === "complete" ? "Recalibrate" : "Continue"}</Button></Row>
        </Group><Group label="Training preferences">
          <ComplexityCheckRow api={api}/>
          <Row className="items-center gap-6 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-content font-medium">Default language</p>
              <p className="mt-0.5 max-w-[20rem] text-ui leading-[1.55] text-muted-foreground">New sessions start here. Asking for another language in a session still wins.</p>
            </div>

            {/* A compact two-row matrix keeps ten choices inside a normal setting
                row. The colour and shape identify the languages; the accessible
                name and native tooltip spell them out without making ten labels
                compete with the setting itself. */}
            <div
              aria-busy={languageBusy}
              aria-label="Default language for new sessions"
              className="grid w-[13.5rem] shrink-0 grid-cols-5 gap-1"
              role="radiogroup"
            >
              {LANGUAGES.map((option) => (
                <button
                  aria-checked={language === option}
                  aria-label={LANGUAGE_LABEL[option]}
                  className={cn(
                    "grid size-10 place-items-center rounded-[var(--radius-lg)] outline-none transition-[background-color,box-shadow,transform] duration-150 hover:bg-accent/55 focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.96]",
                    language === option
                      ? "bg-accent shadow-[inset_0_0_0_1px_var(--border-strong),var(--app-shadow-card)]"
                      : "",
                    languageBusy && "opacity-60",
                  )}
                  disabled={languageBusy || !api}
                  key={option}
                  onClick={() => language !== option && changeLanguage(option)}
                  role="radio"
                  title={LANGUAGE_LABEL[option]}
                  type="button"
                >
                  <SelectableLanguageGlyph className="size-[1.3rem]" language={option} selected={language === option} />
                </button>
              ))}
            </div>
          </Row>
        </Group></>}

        {section === "models" && <><Group label="Providers">
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

        {/* Not under Providers, and deliberately above Web search: this is where
            the problems come from, which is a bigger fact about how Spar behaves
            than either of the things below it. */}
        <Group label="Web search">
          <WebSearchRow api={api} />
        </Group></>}

        {section === "connections" && <Group label="Practice sources">
          <PracticeSourceGroup api={api} />
        </Group>}

        {/* Its own group rather than a row under Providers: this is not a model,
            and grouping it with them would imply the agent could run on it. */}
        {section === "appearance" && <Group label="Updates">
          <UpdateSettings api={api} />
        </Group>}

        {section === "account" && <><Group label="Account">
          {/* Who you are signed in as, before anything you can do about it. The
              sidebar's row says the name and hides the address in a tooltip;
              Settings is the one place that owes you both in plain sight. */}
          <Row className="gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--color-background-elevated-secondary)] text-content font-semibold text-foreground">
              {initials(account.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-content font-medium">{account.displayName}</p>
              <p className="mt-0.5 truncate text-ui text-muted-foreground">{account.email}</p>
            </div>
          </Row>
          <Row>
            <div className="min-w-0 flex-1">
              <p className="text-content font-medium">Sign out</p>
              <p className="mt-0.5 text-ui text-muted-foreground">Remove this account and clear its sessions from this {deviceNoun}. Anything already synced stays in your cloud history.</p>
            </div>
            <Button onClick={() => setAccountAction("sign-out")} size="sm" variant="secondary"><LogOut />Sign out</Button>
          </Row>
        </Group><AboutSpar /></>}

        {section === "privacy" && <Group label="Data & Privacy">
          <Row>
            <div className="min-w-0 flex-1">
              <p className="text-content font-medium">Delete account</p>
              <p className="mt-0.5 text-ui text-muted-foreground">Permanently remove your account and cloud-backed learning history. This cannot be undone.</p>
            </div>
            <Button onClick={() => setAccountAction("delete")} size="sm" variant="destructive"><Trash2 />Delete account</Button>
          </Row>
        </Group>}

        {section === "advanced" && <LearningEngineInspector api={api} />}
            </div>
            </main>
          </div>
          <SectionRail contentRef={content} viewportRef={viewport} />
        </div>
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
