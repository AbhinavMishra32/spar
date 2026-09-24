import { useSyncExternalStore } from "react";

/** How full the context window got, for one session's most recent turn. */
export type ContextReading = { usedTokens: number; totalTokens: number };

/**
 * The context reading, held per session for the whole renderer.
 *
 * It outlives the run it came from on purpose. A run is cleared the moment its
 * turn finishes, and the fill of the window that turn built is exactly what the
 * learner wants to look at once it has stopped moving — a ring that emptied
 * itself on `done` would only ever be readable while it was changing.
 *
 * Nothing persists it. The reading describes what the next turn will be sent,
 * and after a restart Spar has not sent one yet, so there is nothing to say
 * until it does.
 */
const readings = new Map<string, ContextReading>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Record what a turn reported. Fed from the one agent-event listener in
 *  `App.tsx`, which is where every stream already lands. */
export function recordContextUsage(sessionId: string, usage: ContextReading) {
  const current = readings.get(sessionId);
  if (current && current.usedTokens === usage.usedTokens && current.totalTokens === usage.totalTokens) return;
  readings.set(sessionId, usage);
  for (const listener of listeners) listener();
}

export function useContextUsage(sessionId: string | undefined): ContextReading | null {
  return useSyncExternalStore(
    subscribe,
    () => (sessionId ? readings.get(sessionId) ?? null : null),
  );
}
