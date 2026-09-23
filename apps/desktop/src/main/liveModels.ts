import type { Api, Model } from "@earendil-works/pi-ai";
import { getModels } from "@earendil-works/pi-ai/compat";

const CATALOG_URL = "https://pi.dev/api/models";
const REFRESH_MS = 60 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 4_000;

/** Pi's published catalog is newer than the snapshot bundled into a release.
 * Keep complete model descriptors so the worker receives current limits and
 * reasoning controls, not just a new name in the picker. */
export class LiveModels {
  private catalog = new Map<string, Model<Api>[]>();
  private checkedAt = 0;
  private pending: Promise<void> | undefined;

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  get(provider: string): Model<Api>[] {
    const bundled = bundledModels(provider);
    const live = this.catalog.get(provider);
    if (!live) return bundled;
    const liveIds = new Set(live.map((model) => model.id));
    return [...live, ...bundled.filter((model) => !liveIds.has(model.id))];
  }

  async refresh(): Promise<void> {
    if (this.pending) return this.pending;
    if (Date.now() - this.checkedAt < REFRESH_MS) return;
    this.checkedAt = Date.now();
    this.pending = this.fetchCatalog().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async fetchCatalog(): Promise<void> {
    try {
      const response = await this.fetcher(CATALOG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) return;
      const value: unknown = await response.json();
      if (!isRecord(value)) return;
      const next = new Map<string, Model<Api>[]>();
      for (const [provider, entries] of Object.entries(value)) {
        if (!isRecord(entries)) continue;
        const bundled = bundledModels(provider);
        if (!bundled.length) continue;
        const supportedApis = new Set(bundled.map((model) => model.api));
        const trustedUrls = new Set(bundled.map((model) => model.baseUrl));
        const models = Object.entries(entries).flatMap(([id, candidate]) => {
          if (!isRecord(candidate) || candidate.id !== id || candidate.provider !== provider
            || !supportedApis.has(candidate.api as Api) || !trustedUrls.has(candidate.baseUrl as string)
            || typeof candidate.name !== "string" || typeof candidate.reasoning !== "boolean"
            || !Array.isArray(candidate.input) || !isRecord(candidate.cost)
            || typeof candidate.contextWindow !== "number" || typeof candidate.maxTokens !== "number") return [];
          return [candidate as unknown as Model<Api>];
        });
        if (models.length) next.set(provider, models);
      }
      if (next.size) this.catalog = next;
    } catch {
      // Offline, timeout, or a bad catalog leaves the last good reading in use.
    }
  }
}

function bundledModels(provider: string): Model<Api>[] {
  try { return (getModels as unknown as (id: string) => Model<Api>[])(provider); } catch { return []; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
