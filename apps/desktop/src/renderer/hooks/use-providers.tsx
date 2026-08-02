import { useEffect, useSyncExternalStore } from "react";
import type { ProviderInventory } from "../../shared/api";

/**
 * The provider inventory, held once for the whole renderer.
 *
 * Which model is in force — and whether one exists at all — is a property of
 * the runtime, not of the screen you happen to be on. Every composer asks, and
 * connecting a provider in Settings has to reach the composer on the workspace
 * behind it, so the answer lives here rather than in each caller's state.
 */
let inventory: ProviderInventory | null = null;
let inflight: Promise<ProviderInventory> | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Re-read the inventory and push it to everyone. Rejects like any bridge call,
 *  so a screen that shows credential errors can still show this one. */
export function refreshProviders(): Promise<ProviderInventory> {
  const api = window.spar;
  if (!api) return Promise.reject(new Error("Spar must run inside its Electron desktop shell."));
  // Several composers mount at once on a page change; they share one read.
  inflight ??= api
    .listProviders()
    .then((next) => {
      inventory = next;
      for (const listener of listeners) listener();
      return next;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Optimistic local edit, for a picker that must paint the choice it just made
 *  before the main process confirms it. */
export function patchProviders(patch: (current: ProviderInventory) => ProviderInventory) {
  if (!inventory) return;
  inventory = patch(inventory);
  for (const listener of listeners) listener();
}

export function useProviders() {
  const value = useSyncExternalStore(subscribe, () => inventory);
  useEffect(() => {
    if (!inventory) void refreshProviders().catch(() => undefined);
  }, []);
  /* Unread is not the same as unconnected. Until the first read lands, assume a
     provider is there: a "connect one" notice that flashes on every mount and
     then retracts is worse than a send that the main process refuses. */
  return { inventory: value, ready: value?.ready ?? true, reload: refreshProviders };
}
