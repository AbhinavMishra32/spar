/**
 * The evidence block, and what to do when it stops fitting.
 *
 * Every phase of a Spar turn restates everything the earlier phases found, as
 * one JSON block inside one user message. That is the whole transcript — the
 * messages are rebuilt per phase — so Spar's version of "the context is full"
 * is not a long conversation that could be summarised. It is a single prompt
 * that got too big, and it got too big in exactly one place: this block.
 *
 * Which is why pi's native compaction does not apply here as shipped. What
 * applies is the detection under it: pi maintains the per-provider spelling of
 * "your prompt is too long" (fifteen-odd families, several of which do not say
 * it in the error at all), and that is the part Spar could not have kept
 * current on its own. The response to it is this file.
 */

/** Deterministic JSON. Two identical results have to render identically or the
 *  per-turn de-duplication below them stops seeing them as identical. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

/** No entry is ever cut below this. A phase that ran has to still be visible as
 *  having run — the controller plans the next phase from which keys are present,
 *  and an entry trimmed to nothing would re-plan work that is already done. */
const MIN_EVIDENCE_CHARS = 240;

/** How far a single overflow retry is allowed to cut. Halving is enough to
 *  clear a prompt that is over by the usual margin, and cutting harder than
 *  necessary throws away findings the phase is about to reason from. */
const SHRINK_FACTOR = 2;

/**
 * The budget to try after a prompt came back too long, or `null` when there is
 * nothing left worth cutting.
 *
 * Measured against what was actually rendered rather than the previous budget,
 * so the first retry after an unbounded attempt is a real cut and not a budget
 * the prompt was already under.
 */
export function nextEvidenceBudget(rendered: number, budget: number, entries: number): number | null {
  const floor = Math.max(MIN_EVIDENCE_CHARS, MIN_EVIDENCE_CHARS * entries);
  const next = Math.floor(Math.min(rendered, budget) / SHRINK_FACTOR);
  return next < floor ? null : next;
}

/**
 * The same evidence, cut to fit.
 *
 * Shared out equally rather than proportionally: an entry under its share keeps
 * all of it and donates the remainder to the ones over. Almost every real
 * overflow here is one enormous result — a file read, a long visualiser trace —
 * next to a dozen small ones, and a proportional cut would clip the twelve
 * small findings to save a fraction of the one big one.
 *
 * A cut entry becomes a string ending in its own account of what was dropped.
 * The model is told it is reading a truncated result rather than being handed a
 * short one and left to conclude the tool returned that little.
 */
export function fitEvidence(evidence: Record<string, unknown>, budget: number): Record<string, unknown> {
  if (!Number.isFinite(budget)) return evidence;
  const entries = Object.entries(evidence).map(([name, value]) => ({ name, value, text: stableJson(value) }));
  if (!entries.length) return evidence;
  /* The keys and the punctuation around them are not negotiable, so the share
     being divided is what is left after them. */
  const structural = entries.reduce((sum, entry) => sum + entry.name.length + 4, 1);
  const allowances = shareEqually(entries.map((entry) => entry.text.length), Math.max(budget - structural, MIN_EVIDENCE_CHARS * entries.length));
  return Object.fromEntries(entries.map((entry, index) => [
    entry.name,
    entry.text.length <= allowances[index]! ? entry.value : clip(entry.text, allowances[index]!),
  ]));
}

/** Equal shares, with what the small entries do not need passed to the rest. */
function shareEqually(sizes: number[], room: number): number[] {
  const order = sizes.map((size, index) => ({ size, index })).sort((left, right) => left.size - right.size);
  const allowances = new Array<number>(sizes.length).fill(0);
  let remaining = room;
  let left = order.length;
  for (const { size, index } of order) {
    const share = Math.floor(remaining / left);
    const given = Math.min(size, share);
    allowances[index] = given;
    remaining -= given;
    left -= 1;
  }
  return allowances;
}

/* The allowance is a budget on the rendered prompt, and a clipped entry renders
   as a JSON string — so what has to fit is the quoted, escaped form, not the
   characters themselves. A result full of quotes and newlines can be half again
   as long once encoded, which is why this measures rather than assumes. */
function clip(text: string, allowance: number): string {
  const note = (dropped: number) => `…[truncated to fit the context window; ${dropped} characters dropped. Call the tool again if you need the rest.]`;
  let kept = Math.max(allowance - note(text.length).length, MIN_EVIDENCE_CHARS);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const clipped = `${text.slice(0, kept)}${note(text.length - kept)}`;
    const over = stableJson(clipped).length - allowance;
    if (over <= 0 || kept <= MIN_EVIDENCE_CHARS) return clipped;
    kept = Math.max(kept - over, MIN_EVIDENCE_CHARS);
  }
  return `${text.slice(0, kept)}${note(text.length - kept)}`;
}
