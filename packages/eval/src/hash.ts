import { createHash } from "node:crypto";

/**
 * Content addressing, so two runs can be compared without keeping two copies of
 * everything they said.
 *
 * A trace is mostly large repeated values: the same system prompt on every step,
 * the same tool arguments on a retry, the same ability document read four times.
 * Diffing two runs means asking "is this the same thing as that" several thousand
 * times, and doing it on the values themselves makes the comparison quadratic in
 * the size of the prompt. Hashing once at write time makes it a string compare.
 *
 * The hash is also the replay key. A recorded model response is filed under the
 * hash of the request that produced it, so a replayed run finds the response by
 * asking the same question rather than by counting steps — which matters because
 * the whole point of replaying new code against old responses is that the new
 * code may take a different number of steps to get there.
 */

/**
 * JSON with its object keys in a fixed order, at every depth.
 *
 * `JSON.stringify` preserves insertion order, so two structurally identical
 * objects built by different code paths serialise differently and hash
 * differently. That would make replay miss on requests that are in fact the same
 * request, and a replay that silently misses is worse than no replay at all: it
 * quietly becomes a live run, spends money, and reports numbers nobody can
 * reproduce. Arrays keep their order, because in an array order is meaning.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** Twelve hex characters of SHA-256. Short enough to read in a terminal diff and
 *  far past the collision risk of a corpus that is thousands of values, not
 *  billions — this addresses one machine's eval runs, not a content network. */
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 12);
}
