import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Search } from "lucide-react";
import type { ProviderInventory } from "../../../shared/api";
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProviderGlyph } from "../common/ProviderGlyph";

type Provider = ProviderInventory["providers"][number];

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
    <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
      <DropdownMenuTrigger
        className="inline-flex h-7 max-w-[12rem] shrink-0 items-center gap-1.5 rounded-[min(var(--radius-md),12px)] px-2 text-ui text-muted-foreground transition-colors outline-none hover:bg-[var(--color-background-elevated-secondary)] hover:text-foreground aria-expanded:bg-[var(--color-background-elevated-secondary)] aria-expanded:text-foreground"
        title="Model"
      >
        <ProviderGlyph className="size-4 shrink-0" provider={active.id} />
        <span className="truncate">{activeModel?.name ?? inventory?.defaultModel.model}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[13.5rem]" side="top">
        {/* Reads as the menu's first row, not a separate header: same inset, same
            height, no rule under it. Radix runs a typeahead on printable keys, so
            the field has to swallow them to stay typable. */}
        <div
          className="flex min-h-8 items-center gap-2.5 px-2.5"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Search className="size-4 shrink-0 text-muted-foreground/70" />
          <input
            className="w-full bg-transparent text-content outline-none placeholder:text-muted-foreground/60"
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
                  <span className="shrink-0 text-ui text-muted-foreground">{provider.name}</span>
                </DropdownMenuCheckItem>
              ))
            ) : (
              <p className="px-2.5 py-2 text-content text-muted-foreground">No model matches “{query.trim()}”.</p>
            )
          ) : (
            connected.map((provider) => (
              <DropdownMenuSub key={provider.id}>
                <DropdownMenuSubTrigger>
                  <ProviderGlyph className="size-4 shrink-0" provider={provider.id} />
                  <span className="truncate">{provider.name}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 min-w-[13.5rem]">
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
              <ArrowUpRight className="opacity-50" />
            </DropdownMenuItem>
          </>
        )}
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
  const [inventory, setInventory] = useState<ProviderInventory | null>(null);

  const reload = useCallback(async () => {
    const api = window.spar;
    if (!api) return;
    try { setInventory(await api.listProviders()); } catch { /* reported on the settings page */ }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const select = useCallback(
    async (provider: Provider, model: string) => {
      const api = window.spar;
      if (!api) return;
      // Paint the choice immediately; the reload reconciles with the store.
      setInventory((current) => (current ? { ...current, defaultModel: { provider: provider.id, model } } : current));
      try { await api.setDefaultProvider(provider.id, model); } finally { void reload(); }
    },
    [reload],
  );

  return (
    <ModelPicker
      inventory={inventory}
      onSelect={(provider, model) => void select(provider, model)}
      {...(onOpenSettings ? { onOpenSettings } : {})}
    />
  );
}
