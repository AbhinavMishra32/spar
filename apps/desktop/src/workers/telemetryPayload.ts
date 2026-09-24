const SECRET_KEY = /(?:api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|password|secret|cookie)/i;
const MAX_TELEMETRY_VALUE_CHARS = 750_000;

/**
 * Telemetry is an operator surface, so unlike the learner transcript it keeps
 * complete prompts, challenge candidates, hidden validation output, and model
 * messages. It still must never become a credential exfiltration path: keys
 * whose names conventionally carry secrets are redacted recursively before the
 * value leaves the utility process.
 */
export function telemetryValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let text: string;
  try {
    text = JSON.stringify(value, (key, nested) => {
      if (SECRET_KEY.test(key)) return "[REDACTED]";
      if (nested && typeof nested === "object") {
        if (seen.has(nested)) return "[CIRCULAR]";
        seen.add(nested);
      }
      return typeof nested === "bigint" ? nested.toString() : nested;
    }) ?? "null";
  } catch (error) {
    return { serializationError: error instanceof Error ? error.message : String(error) };
  }
  if (text.length <= MAX_TELEMETRY_VALUE_CHARS) return JSON.parse(text) as unknown;
  return {
    truncated: true,
    originalCharacters: text.length,
    preview: text.slice(0, MAX_TELEMETRY_VALUE_CHARS),
  };
}
