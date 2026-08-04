/** Beyond this a payload is not something anyone reads, and it is stored per call
 *  for the life of the session. Generous enough that redaction, not truncation,
 *  is what removes the bulk. */
export const MAX_PAYLOAD = 16_000;

/** The field every tool carries so the agent can name the row it will draw. */
export const ACTION_TITLE_KEY = "actionTitle";
/** A transcript row, not a paragraph. */
const MAX_TITLE = 70;

/**
 * The agent's title for this step, separated from the arguments it belongs to.
 *
 * Two reasons this is a split rather than a read. The title is rendered and stored,
 * so it is trimmed and capped here instead of being trusted at whatever length the
 * model produced. And the remainder is what reaches the host: `create_question`
 * forwards its whole input to the deterministic compiler, which would reject a key
 * it never declared — so the caption must not travel with the call it describes.
 */
export function splitActionTitle(input: unknown): { actionTitle: string; arguments: unknown } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { actionTitle: "", arguments: input };
  const { [ACTION_TITLE_KEY]: title, ...rest } = input as Record<string, unknown>;
  const text = typeof title === "string" ? title.trim().replace(/\s+/g, " ").replace(/\.$/, "") : "";
  return { actionTitle: text.slice(0, MAX_TITLE), arguments: rest };
}

/** Every key whose value is, or contains, the answer to a challenge. */
const SOLUTION_KEYS = new Set(["referenceFiles", "hiddenTests", "knownIncorrectFiles"]);

/**
 * A tool's arguments or result, formatted for the transcript.
 *
 * The learner can open any call and read exactly what it sent and what came
 * back — except the parts of a challenge design that are the answer. A
 * `create_question` call carries the reference solution, the hidden tests, and
 * the deliberately-wrong implementations; rendering those would mean the turn
 * that wrote a challenge also published its solution one scroll above it. Those
 * keys are replaced by a count of what they held, so the row is honest about
 * having been redacted rather than quietly incomplete.
 *
 * This runs in the worker, which is the only place that ever holds the unredacted
 * design — so nothing downstream, in the renderer or in storage, has to be
 * trusted to redact it again.
 */
export function toolPayload(name: string, value: unknown): string {
  try {
    const text = JSON.stringify(value, (key, nested) => {
      if (!SOLUTION_KEYS.has(key)) return nested;
      const count = Array.isArray(nested) ? nested.length : nested && typeof nested === "object" ? Object.keys(nested as object).length : 0;
      return `⟨withheld — ${count} ${count === 1 ? "entry" : "entries"}; showing this would give away the challenge⟩`;
    }, 2) ?? "";
    return text.length > MAX_PAYLOAD ? `${text.slice(0, MAX_PAYLOAD)}\n… truncated (${text.length - MAX_PAYLOAD} more characters)` : text;
  } catch {
    /* A payload that cannot be serialised is not worth failing a turn over —
       circular references and host objects both land here. */
    return `⟨could not serialise the ${name} payload⟩`;
  }
}
