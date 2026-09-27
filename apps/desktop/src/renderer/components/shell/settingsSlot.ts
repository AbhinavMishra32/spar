import { useSyncExternalStore } from "react";

/**
 * Where Settings puts its navigation while it is open: inside the app's own
 * sidebar, in place of the session list.
 *
 * Settings owns the state (which page, what the search says), and the sidebar
 * owns the glass. A portal lets each keep what it owns. The sidebar publishes
 * an element here while Settings is the page, and Settings renders its nav into
 * it. With no slot, as in the browser harness where there is no shell, Settings
 * draws the nav beside its sheet the way it used to.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setSettingsSlot(element: HTMLElement | null) {
  if (slot === element) return;
  slot = element;
  for (const listener of listeners) listener();
}

export function useSettingsSlot() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => slot,
  );
}
