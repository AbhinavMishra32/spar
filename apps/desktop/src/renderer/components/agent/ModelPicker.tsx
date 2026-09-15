import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Search, Unplug } from "lucide-react";
import type { ProviderInventory, ReasoningEffort } from "../../../shared/api";
import { patchProviders, refreshProviders, useProviders } from "../../hooks/use-providers";
import { ComposerPill } from "./Composer";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipKeys, TooltipTrigger } from "@/components/ui/tooltip";
import { isMac } from "../../lib/platform";
import { ProviderGlyph } from "../common/ProviderGlyph";

type Provider = ProviderInventory["providers"][number];

/** The keys Aside puts on these two controls, and there is no reason to invent
 *  different ones: a learner who knows one desktop AI composer knows this one. */
const MODEL_KEYS = isMac ? "⇧⌘M" : "Shift+Ctrl+M";
const EFFORT_KEYS = isMac ? "⇧⌘." : "Shift+Ctrl+.";

/* More than one composer can be mounted at a time — a challenge keeps its chat
   alive behind the problem view — so a shortcut cannot simply be a listener per
   picker or it opens every one of them at once. Pickers register here, one
   listener serves all of them, and the key goes to the last picker that is
   actually on screen, which is the one the learner is typing into. */
type Opener = { readonly el: HTMLElement | null; readonly key: string; open(): void };

const openers = new Set<Opener>();
let listening: ((event: KeyboardEvent) => void) | null = null;

function onShortcut(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
  /* `event.key` under Shift is the shifted character — ">" for the period on a
     US layout — so the physical key is what this has to match on. */
  const code = event.code === "Period" ? "." : event.key.toLowerCase();
  /* `offsetParent` is null for anything display:none or inside a hidden pane,
     which is exactly the composer that should not answer for the key. */
  const target = [...openers].filter((opener) => opener.key === code && opener.el?.offsetParent).at(-1);
  if (!target) return;
  event.preventDefault();
  target.open();
}

/** Registers a composer control for its shortcut, and returns the ref its
 *  trigger must carry — the element is how the handler tells an on-screen
 *  control from one parked behind another view. */
function useComposerShortcut(key: string, open: () => void) {
  const trigger = useRef<HTMLButtonElement>(null);
  const latest = useRef(open);
  latest.current = open;

  useEffect(() => {
    const opener: Opener = {
      get el() { return trigger.current; },
      key,
      open: () => latest.current(),
    };
    openers.add(opener);
    if (!listening) {
      listening = onShortcut;
      addEventListener("keydown", listening);
    }
    return () => {
      openers.delete(opener);
      // Last control out turns the listener off; anything else would leave a
      // key bound to a menu that no longer exists.
      if (openers.size === 0 && listening) {
        removeEventListener("keydown", listening);
        listening = null;
      }
    };
  }, [key]);

  return trigger;
}

const REASONING_EFFORTS: Array<{ id: ReasoningEffort; label: string }> = [
  { id: "off", label: "Off" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
];

/**
 * The composer's model control. Providers are submenus rather than one long
 * list, because the list is only long once several are connected — and typing
 * collapses the whole thing into a flat search, which is faster than either.
 */
export function ModelPicker({
  inventory,
  onSelect,
  onOpenSettings,
}: {
  inventory: ProviderInventory | null;
  onSelect(provider: Provider, model: string): void;
  onOpenSettings?(): void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const trigger = useComposerShortcut("m", () => setOpen(true));
  const field = useRef<HTMLInputElement>(null);

  const connected = useMemo(
    () => inventory?.providers.filter((provider) => provider.state !== "disconnected" && provider.models.length > 0) ?? [],
    [inventory],
  );
  const active = connected.find((provider) => provider.id === inventory?.defaultModel.provider);
  const activeModel = active?.models.find((model) => model.id === inventory?.defaultModel.model);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return connected
      .flatMap((provider) => provider.models.map((model) => ({ provider, model })))
      .filter(({ provider, model }) => `${provider.name} ${model.name}`.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [connected, query]);

  if (!active) return null;

  return (
    <DropdownMenu
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      open={open}
    >
      {/* At rest this is a label that happens to be clickable: no fill, no
          chevron, just the mark and the name at full strength, because the model
          in force is worth reading and nothing else here is. The pill and the
          chevron are what the pointer brings — the affordance arrives when
          something is there to use it. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            aria-label="Model"
            className="group inline-flex h-7 max-w-[13rem] shrink-0 items-center gap-1.5 rounded-full py-0 pr-2 pl-1.5 text-thread text-foreground/90 transition-colors outline-none hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground aria-expanded:bg-[var(--color-background-elevated-secondary)] aria-expanded:text-foreground"
            ref={trigger}
          >
            <ProviderGlyph className="size-4 shrink-0" provider={active.id} />
            <span className="truncate">{activeModel?.name ?? inventory?.defaultModel.model}</span>
            {/* Collapsed rather than hidden, so the name does not shift sideways
                the moment the pointer lands on it. */}
            <ChevronDown className="size-3.5 w-0 shrink-0 opacity-0 transition-[width,opacity] duration-150 group-hover:w-3.5 group-hover:opacity-50 group-aria-expanded:w-3.5 group-aria-expanded:opacity-50" />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Model
          <TooltipKeys>{MODEL_KEYS}</TooltipKeys>
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        align="end"
        className="min-w-[12.5rem]"
        /* While a query is being typed the keyboard owns the list. Radix
           highlights — and focuses — whatever row the pointer crosses, which
           silently takes the caret out of the field mid-word; preventing the
           default on the way down is what stops it, since Radix's own handlers
           skip an event that has already been defaulted. Lifted from Aside's
           model picker, which solves it the same way. */
        onPointerMoveCapture={(event) => {
          if (!query.trim()) return;
          event.preventDefault();
          requestAnimationFrame(() => field.current?.focus({ preventScroll: true }));
        }}
        side="top"
      >
        {/* Reads as the menu's first row, not a separate header: same inset, same
            height, no rule under it. Radix runs a typeahead on printable keys, so
            the field has to swallow them to stay typable. */}
        <div
          className="flex min-h-8 items-center gap-2 px-2.5"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Search className="size-4 shrink-0 text-muted-foreground/70" />
          <input
            ref={field}
            className="w-full bg-transparent text-thread leading-none outline-none placeholder:text-muted-foreground/60"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search models"
            value={query}
          />
        </div>

        <div>
          {query.trim() ? (
            matches.length > 0 ? (
              matches.map(({ provider, model }) => (
                <DropdownMenuCheckItem
                  checked={provider.id === active.id && model.id === inventory?.defaultModel.model}
                  key={`${provider.id}:${model.id}`}
                  onSelect={() => onSelect(provider, model.id)}
                >
                  <ProviderGlyph className="size-4 shrink-0 opacity-80" provider={provider.id} />
                  <span className="min-w-0 flex-1 truncate">{model.name}</span>
                  <span className="shrink-0 text-thread text-muted-foreground">{provider.name}</span>
                </DropdownMenuCheckItem>
              ))
            ) : (
              <p className="px-2.5 py-1.5 text-thread text-muted-foreground">No model matches “{query.trim()}”.</p>
            )
          ) : (
            connected.map((provider) => (
              <DropdownMenuSub key={provider.id}>
                <DropdownMenuSubTrigger>
                  <ProviderGlyph className="size-4 shrink-0" provider={provider.id} />
                  <span className="truncate">{provider.name}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-[17rem] min-w-[12.5rem]">
                  {provider.models.map((model) => (
                    <DropdownMenuCheckItem
                      checked={provider.id === active.id && model.id === inventory?.defaultModel.model}
                      key={model.id}
                      onSelect={() => onSelect(provider, model.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">{model.name}</span>
                    </DropdownMenuCheckItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))
          )}
        </div>

        {onOpenSettings && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenSettings}>
              <span className="flex-1">Settings</span>
              <ArrowUpRight className="size-3.5 opacity-45" />
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Composer's effort control. Only the active model's own `reasoning` flag
 * decides whether it renders — offering an effort dial for a model that cannot
 * think is a control with nothing to control.
 *
 * Two sections, because the menu answers two different questions. The efforts
 * are one choice out of a ladder, so they check. Fast mode is not a rung on
 * that ladder — it is how the same turn is served, which is why it sits under
 * its own heading with a switch rather than as a sixth effort.
 */
export function ReasoningPicker({
  effort,
  fastMode,
  onSelect,
  onFastMode,
}: {
  effort: ReasoningEffort;
  fastMode: boolean;
  onSelect(effort: ReasoningEffort): void;
  onFastMode(enabled: boolean): void;
}) {
  const current = REASONING_EFFORTS.find((item) => item.id === effort) ?? REASONING_EFFORTS[0]!;
  const [open, setOpen] = useState(false);
  const trigger = useComposerShortcut(".", () => setOpen(true));

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      {/* The quieter of the pair: muted at rest against the model's full
          strength, and it keeps its chevron there — the effort is a setting you
          change, where the model is a fact you read. Same pill on hover. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            aria-label="Reasoning effort"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-thread text-muted-foreground transition-colors outline-none hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground aria-expanded:bg-[var(--color-background-elevated-secondary)] aria-expanded:text-foreground"
            ref={trigger}
          >
            <span className="truncate">{current.label}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-50" />
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Effort
          <TooltipKeys>{EFFORT_KEYS}</TooltipKeys>
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="min-w-[9rem]" side="top">
        <DropdownMenuLabel>Effort</DropdownMenuLabel>
        {REASONING_EFFORTS.map((item) => (
          <DropdownMenuCheckItem checked={item.id === effort} key={item.id} onSelect={() => onSelect(item.id)}>
            <span className="flex-1 truncate">{item.label}</span>
          </DropdownMenuCheckItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Options</DropdownMenuLabel>
        {/* The whole row toggles, and `onSelect` is prevented so it does not:
            a switch you can only hit by landing on the switch is a 32px row
            with an 18px target, and closing the menu on a setting you are
            plainly about to compare against the efforts above it is the wrong
            answer to a click either way. */}
        <DropdownMenuItem
          aria-checked={fastMode}
          onSelect={(event) => {
            event.preventDefault();
            onFastMode(!fastMode);
          }}
          role="menuitemcheckbox"
        >
          <span className="flex-1 truncate">Fast mode</span>
          <Switch
            checked={fastMode}
            className="pointer-events-none ml-auto"
            size="sm"
            onCheckedChange={onFastMode}
            tabIndex={-1}
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Drop-in footer control. It talks to the bridge itself rather than having the
 * inventory threaded through every composer's parent — the model in force is a
 * property of the runtime, not of the screen you happen to be on.
 */
export function ComposerModelPicker({ onOpenSettings }: { onOpenSettings?(): void }) {
  const { inventory } = useProviders();

  const reload = useCallback(() => void refreshProviders().catch(() => undefined), []);

  const select = useCallback(
    async (provider: Provider, model: string) => {
      const api = window.spar;
      if (!api) return;
      // Paint the choice immediately; the reload reconciles with the store.
      patchProviders((current) => ({ ...current, defaultModel: { ...current.defaultModel, provider: provider.id, model } }));
      try { await api.setDefaultProvider(provider.id, model); } finally { reload(); }
    },
    [reload],
  );

  const setEffort = useCallback(
    async (effort: ReasoningEffort) => {
      const api = window.spar;
      if (!api) return;
      patchProviders((current) => ({ ...current, defaultModel: { ...current.defaultModel, reasoningEffort: effort } }));
      try { await api.setReasoningEffort(effort); } finally { reload(); }
    },
    [reload],
  );

  const setFastMode = useCallback(
    async (enabled: boolean) => {
      const api = window.spar;
      if (!api) return;
      patchProviders((current) => ({ ...current, defaultModel: { ...current.defaultModel, fastMode: enabled } }));
      try { await api.setFastMode(enabled); } finally { reload(); }
    },
    [reload],
  );

  const active = inventory?.providers.find((provider) => provider.id === inventory.defaultModel.provider);
  const reasons = !!active?.models.find((model) => model.id === inventory?.defaultModel.model)?.reasoning;

  /* An unrunnable runtime still gets a control, in the place the model name
     would be. The old picker simply vanished, which left the toolbar looking
     complete while the one thing it reports was missing. */
  if (inventory && !inventory.ready) {
    const expired = active?.state === "auth-expired";
    return (
      <ComposerPill
        icon={Unplug}
        tone="warning"
        {...(onOpenSettings ? { onClick: onOpenSettings } : {})}
        title={expired ? `${active?.name} needs signing in again` : "No model provider is connected"}
      >
        {expired ? `Reconnect ${active?.name}` : "No model"}
      </ComposerPill>
    );
  }

  return (
    <>
      <ModelPicker
        inventory={inventory}
        onSelect={(provider, model) => void select(provider, model)}
        {...(onOpenSettings ? { onOpenSettings } : {})}
      />
      {reasons && inventory && (
        <ReasoningPicker
          effort={inventory.defaultModel.reasoningEffort}
          fastMode={inventory.defaultModel.fastMode}
          onFastMode={(enabled) => void setFastMode(enabled)}
          onSelect={(effort) => void setEffort(effort)}
        />
      )}
    </>
  );
}
