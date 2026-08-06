/**
 * Web retrieval for the Training Agent, over Exa.
 *
 * Two calls, because they answer two different questions. `search` finds pages
 * the agent did not know about, and returns short extracts — enough to decide
 * which of them is worth reading. `fetch` reads named URLs in full, and is what
 * the agent reaches for once it has decided.
 *
 * The key is the learner's own, held in the keychain beside their provider keys
 * rather than in the local database, and `EXA_API_KEY` is honoured so a dev build
 * can run without one being stored. Unconfigured is a first-class answer: the
 * tool returns a result saying so, because a thrown error would end the turn and
 * the agent has plenty of other ways to make progress.
 */

const SEARCH_URL = "https://api.exa.ai/search";
const CONTENTS_URL = "https://api.exa.ai/contents";
/** Per page. Enough to reason from, short of pulling a whole book into context. */
const SEARCH_EXTRACT = 1_200;
const FETCH_EXTRACT = 8_000;
const TIMEOUT_MS = 20_000;

export type WebSearchResult = {
  configured: boolean;
  note?: string;
  results?: Array<{ title: string; url: string; published?: string; author?: string; extract: string }>;
};

export type WebKeySource = "keychain" | "env" | "none";

export class WebSearchService {
  constructor(private readonly readKey: () => Promise<string | null>) {}

  /** Whether a key is present, and where it came from — so Settings can say
   *  "set by EXA_API_KEY" instead of showing an empty field that works anyway. */
  async keySource(): Promise<WebKeySource> {
    if (await this.readKey()) return "keychain";
    return process.env.EXA_API_KEY?.trim() ? "env" : "none";
  }

  private async key(): Promise<string> {
    return (await this.readKey())?.trim() || process.env.EXA_API_KEY?.trim() || "";
  }

  async search(query: string, limit: number): Promise<WebSearchResult> {
    const trimmed = query.trim();
    if (!trimmed) return { configured: true, results: [], note: "No query was given, so nothing was searched." };
    return this.call(SEARCH_URL, {
      query: trimmed,
      numResults: clamp(limit, 1, 10),
      type: "auto",
      contents: { text: { maxCharacters: SEARCH_EXTRACT } },
    });
  }

  async fetch(urls: string[]): Promise<WebSearchResult> {
    /* Only http(s). A tool that will fetch whatever string it is handed is a way
       to read the local filesystem through `file:` and to reach the loopback
       services on this machine, and the model chooses these arguments. */
    const safe = urls.map((value) => value.trim()).filter((value) => /^https?:\/\//i.test(value)).slice(0, 5);
    if (!safe.length) return { configured: true, results: [], note: "No http or https URL was given, so nothing was fetched." };
    return this.call(CONTENTS_URL, { urls: safe, text: { maxCharacters: FETCH_EXTRACT } });
  }

  private async call(url: string, body: Record<string, unknown>): Promise<WebSearchResult> {
    const key = await this.key();
    if (!key) {
      return { configured: false, note: "Web search is not set up: no Exa API key is saved. Add one in Settings › Web search, then this tool will work. Continue without it." };
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const response = await globalThis.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return { configured: true, note: `Exa answered ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}. Continue without this result.` };
      }
      const payload = await response.json() as { results?: unknown };
      return { configured: true, results: normalize(payload.results) };
    } catch (error) {
      const reason = abort.signal.aborted ? `no answer within ${TIMEOUT_MS / 1_000}s` : error instanceof Error ? error.message : String(error);
      return { configured: true, note: `The web request did not complete (${reason}). Continue without this result.` };
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalize(results: unknown): Array<{ title: string; url: string; published?: string; author?: string; extract: string }> {
  if (!Array.isArray(results)) return [];
  return results.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url : "";
    if (!url) return [];
    const text = typeof row.text === "string" ? row.text : "";
    return [{
      title: typeof row.title === "string" && row.title.trim() ? row.title : url,
      url,
      ...(typeof row.publishedDate === "string" ? { published: row.publishedDate } : {}),
      ...(typeof row.author === "string" && row.author.trim() ? { author: row.author } : {}),
      extract: collapse(text),
    }];
  });
}

/** Page text arrives with the whitespace of the markup it was lifted from, which
 *  is most of its length and none of its meaning. */
function collapse(value: string): string {
  return value.replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : low;
}
