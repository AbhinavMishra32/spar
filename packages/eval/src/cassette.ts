import { digest } from "./hash.js";

/**
 * Model calls, recorded once and replayed for nothing.
 *
 * ## Why at `fetch` and not at the provider
 *
 * Spar's turn goes through a phase controller, through pi's agent loop, through
 * pi-ai's per-provider request builders, and out. Every one of those is a place
 * a stub could be installed, and every one of them would quietly stop testing
 * the layers below it. Recording at `fetch` is the only seam where what is
 * captured is *what the provider actually received and returned* — SSE framing,
 * tool-call deltas, the lot — so a replay exercises every line of Spar's own
 * code including the parts that translate for one provider family and not
 * another.
 *
 * It also costs the product nothing. No injection point, no test mode, no
 * environment variable read by shipping code: the harness swaps the global
 * `fetch` for the length of a run and puts it back.
 *
 * ## The key
 *
 * Content-addressed: method, URL, and a digest of the request body. The body of
 * a model call *is* the prompt, the transcript so far, the tool schemas and the
 * forced tool choice — so two requests share a key exactly when the model was
 * asked the same question.
 *
 * That is a deliberate choice, and it is what makes counterfactual replay
 * meaningful. Change the host and re-run against a cassette: every turn where
 * the new code asked the same thing replays for free, and every turn where it
 * asked something different is a **miss**, reported by name. The misses are the
 * finding — they are precisely the turns the change affected. A fuzzy key that
 * matched "near enough" would hand back an answer to a question nobody asked
 * and call it a passing run.
 *
 * ## What is not recorded
 *
 * Authorization headers, api keys, cookies. A cassette is committed to a
 * repository and read by people; it holds prompts and completions and nothing
 * that would let anybody make a request with it.
 */

export type CassetteMode = "record" | "replay" | "auto";

export type CassetteEntry = {
  key: string;
  /** Kept for a human reading the file. Nothing matches on them. */
  method: string;
  url: string;
  requestBody: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** How long the real call took. Replayed runs report it rather than their own
   *  microseconds, so a latency number from a replay is the latency that was
   *  actually observed and not a measure of how fast the disk is. */
  durationMs: number;
  recordedAt: string;
};

export type Cassette = {
  version: 1;
  entries: CassetteEntry[];
};

export type CassetteMiss = { key: string; url: string; requestBody: string };

export type CassetteDeck = {
  fetch: typeof globalThis.fetch;
  /** Everything known after the run: what replayed, what was recorded fresh,
   *  and every request the cassette had no answer for. */
  readonly hits: number;
  readonly recorded: number;
  readonly misses: CassetteMiss[];
  cassette(): Cassette;
  /** Undo the global swap. Always call it in a `finally`. */
  restore(): void;
};

const SECRET_HEADERS = new Set(["authorization", "x-api-key", "api-key", "cookie", "set-cookie", "openai-organization", "anthropic-api-key"]);

export function cassetteKey(method: string, url: string, body: string): string {
  /* The URL without its query, because several providers put a cache-busting
     or account-scoped parameter on it that has nothing to do with the question
     being asked. Everything that decides the answer is in the body. */
  const path = (() => { try { return new URL(url).origin + new URL(url).pathname; } catch { return url; } })();
  return digest({ method: method.toUpperCase(), path, body: normalizeBody(body) });
}

/**
 * Fields a provider varies per call that say nothing about what was asked.
 *
 * Kept very short on purpose. Every entry here is a claim that two requests
 * differing only in this field deserve the same answer, and a long list of such
 * claims is how a cassette starts replaying responses to questions that were
 * never asked.
 */
const VOLATILE_FIELDS = ["user", "metadata", "request_id", "idempotency_key"];

function normalizeBody(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    for (const field of VOLATILE_FIELDS) delete parsed[field];
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

export type CassetteCall = {
  key: string;
  url: string;
  requestBody: string;
  /** Bytes of the response, not parsed. The cassette deliberately knows nothing
   *  about any provider's wire format — whoever is listening does. */
  responseBody: string;
  status: number;
  latencyMs: number;
  /** True when the answer came off the tape. A latency from a replayed call is
   *  the latency that was originally observed, which is the only honest thing to
   *  report; `replayed` is carried beside it so nobody mistakes it for now. */
  replayed: boolean;
};

/**
 * Install a cassette over the global `fetch`.
 *
 * In `replay` a request with no entry is an error rather than a live call: a
 * replay that silently reached the network would produce a run that is neither
 * reproducible nor free, and would do it without saying so. `auto` is the mode
 * that fills gaps — it replays what it has and records what it does not, which
 * is what you want the first time a new scenario is added to an existing
 * cassette.
 */
export function installCassette(options: { cassette?: Cassette; mode: CassetteMode; now?: () => number; onCall?: (call: CassetteCall) => void }): CassetteDeck {
  const entries = new Map((options.cassette?.entries ?? []).map((entry) => [entry.key, entry]));
  const fresh: CassetteEntry[] = [];
  const misses: CassetteMiss[] = [];
  const real = globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  let hits = 0;

  const patched: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init as RequestInit);
    const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
    const key = cassetteKey(request.method, request.url, body);

    const recorded = entries.get(key);
    if (recorded && options.mode !== "record") {
      hits += 1;
      options.onCall?.({ key, url: request.url, requestBody: body, responseBody: recorded.body, status: recorded.status, latencyMs: recorded.durationMs, replayed: true });
      return replayResponse(recorded);
    }

    if (options.mode === "replay") {
      misses.push({ key, url: request.url, requestBody: body });
      throw new Error(`No recorded response for ${request.method} ${request.url} (${key}). The run asked the model something this cassette has never seen — re-record, or look at what changed in the prompt.`);
    }

    const started = now();
    const response = await real(request);
    /* Drained whole rather than teed. A streamed body handed to both the caller
       and the recorder is one body read twice, and the provider does not offer
       it twice; reading it here and handing back a reconstruction is the only
       version of this that cannot lose the tail of a stream. */
    const text = await response.text();
    const entry: CassetteEntry = {
      key, method: request.method, url: request.url, requestBody: body,
      status: response.status, statusText: response.statusText,
      headers: safeHeaders(response.headers), body: text,
      durationMs: now() - started, recordedAt: new Date(now()).toISOString(),
    };
    entries.set(key, entry);
    fresh.push(entry);
    options.onCall?.({ key, url: request.url, requestBody: body, responseBody: text, status: entry.status, latencyMs: entry.durationMs, replayed: false });
    return replayResponse(entry);
  };

  globalThis.fetch = patched;
  return {
    fetch: patched,
    get hits() { return hits; },
    get recorded() { return fresh.length; },
    get misses() { return misses; },
    cassette: () => ({ version: 1, entries: [...entries.values()].sort((a, b) => a.key.localeCompare(b.key)) }),
    restore: () => { globalThis.fetch = real; },
  };
}

/**
 * A recorded response, handed back as a real streaming one.
 *
 * Chunked rather than delivered whole, because the thing on the other end is an
 * SSE parser and a body that arrives in one piece exercises a path the live run
 * never takes. The chunk boundaries are at event boundaries, which is the one
 * property real SSE guarantees and the one a parser is entitled to rely on.
 */
function replayResponse(entry: CassetteEntry): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of splitEvents(entry.body)) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: entry.status, statusText: entry.statusText, headers: entry.headers });
}

function splitEvents(body: string): string[] {
  if (!body.includes("data:")) return [body];
  const parts = body.split(/(?<=\n\n)/);
  return parts.filter((part) => part.length > 0);
}

function safeHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (SECRET_HEADERS.has(name.toLowerCase())) return;
    /* Content-Encoding and Content-Length describe bytes that no longer exist:
       `response.text()` has already decompressed, and the replayed body is a
       fresh stream of its own length. Keeping either makes the reconstruction
       unreadable to the client. */
    if (name.toLowerCase() === "content-encoding" || name.toLowerCase() === "content-length") return;
    kept[name] = value;
  });
  return kept;
}

/** Everything a request carried that a person reading a miss would want. Used by
 *  the report rather than by the matcher, which only ever looks at the key. */
export function describeRequest(body: string): { model?: string; messages?: number; tools?: number; toolChoice?: unknown } {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return {
      ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
      ...(Array.isArray(parsed.messages) ? { messages: parsed.messages.length } : {}),
      ...(Array.isArray(parsed.tools) ? { tools: parsed.tools.length } : {}),
      ...(parsed.tool_choice !== undefined ? { toolChoice: parsed.tool_choice } : {}),
    };
  } catch {
    return {};
  }
}
