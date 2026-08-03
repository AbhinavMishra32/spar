/** Every header ChatGPT uses to report what a Codex subscription has left. */
const RATE_LIMIT_HEADERS = [
  "x-codex-primary-used-percent", "x-codex-primary-window-minutes", "x-codex-primary-reset-at", "x-codex-primary-reset-after-seconds",
  "x-codex-secondary-used-percent", "x-codex-secondary-window-minutes", "x-codex-secondary-reset-at", "x-codex-secondary-reset-after-seconds",
] as const;

let installed = false;

/**
 * ChatGPT reports a subscription's remaining quota only on the response headers
 * of the turn that spent it, and pi-ai's stream surfaces parsed events rather
 * than the response — so the one place those headers exist is the `fetch` call
 * pi-ai makes. Wrapping it here is the only way to read them without forking
 * the provider; the wrapper is otherwise transparent and never fails a turn.
 *
 * Returns whether it installed, so a second call cannot stack wrappers.
 */
export function captureCodexRateLimits(report: (headers: Record<string, string>) => void): boolean {
  const original = globalThis.fetch;
  if (!original || installed) return false;
  installed = true;
  globalThis.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const response = await original.call(globalThis, input, init);
    try {
      const found: Record<string, string> = {};
      for (const name of RATE_LIMIT_HEADERS) {
        const value = response.headers.get(name);
        if (value !== null) found[name] = value;
      }
      if (Object.keys(found).length) report(found);
    } catch {
      // Reading headers is observation. A turn must complete regardless.
    }
    return response;
  };
  return true;
}
