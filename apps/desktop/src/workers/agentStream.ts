export type NormalizedAgentStreamPart = {
  type: "text" | "reasoning" | "tool" | "status" | "error";
  text: string;
  tool?: string;
  detail?: string;
  /** Boundaries of a reasoning block, so the transcript can close one and start
   *  another rather than growing one block for a whole turn. */
  phase?: "start" | "end";
};

/**
 * Mastra's public stream wraps model deltas in `payload.text`. Older AI SDK
 * stream shapes exposed `textDelta` directly, so accept both without ever
 * coercing an unknown object into learner-visible text.
 *
 * Reasoning is forwarded as its own kind of part. It used to fall through to the
 * status branch and get filtered out as protocol noise, which is why the
 * transcript could only show a fixed "Thinking" label with nothing behind it: the
 * model's actual reasoning was arriving and being thrown away one delta at a
 * time.
 */
export function normalizeAgentStreamPart(part: Record<string, unknown>): NormalizedAgentStreamPart {
  const type = String(part.type);
  if (type === "text-delta") return { type: "text", text: textDelta(part) };
  if (type === "reasoning-delta") return { type: "reasoning", text: textDelta(part) };
  if (type === "reasoning-start") return { type: "reasoning", text: "", phase: "start" };
  if (type === "reasoning-end") return { type: "reasoning", text: "", phase: "end" };
  if (type === "error") return { type: "error", text: errorText(part.error ?? part) };

  /* A rejected tool call, kept rather than collapsed.
   *
   * Everything else here is protocol mechanics — host tool calls already report
   * the real activity — but this one part carries the only account of *why* a
   * call did not land: the schema path that failed, the field that was missing.
   * Dropping it is what made a stalled phase unfixable, both for the model,
   * which was told only "that was not valid", and for whoever read the log
   * afterwards. So the fault text rides along in `detail`, where the phase loop
   * reads it and quotes it back in the retry. */
  if (type.includes("tool") && (type.includes("error") || type.includes("repair"))) {
    return { type: "status", text: "", detail: `${type}:${String(part.toolName ?? "tool")}:${errorText(part.error ?? part)}` };
  }
  // Provider stream parts describe protocol mechanics, not work. Host tool
  // calls already report the real activity, so these remain status trace data.
  if (type.includes("tool")) {
    return { type: "status", text: "", detail: `${type}:${String(part.toolName ?? "tool")}` };
  }
  return { type: "status", text: "", detail: type };
}

function textDelta(part: Record<string, unknown>): string {
  for (const candidate of [part.textDelta, part.delta]) {
    if (typeof candidate === "string") return candidate;
  }

  const payload = part.payload;
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    for (const candidate of [record.text, record.textDelta, record.delta]) {
      if (typeof candidate === "string") return candidate;
    }
  }

  return "";
}

function errorText(value: unknown): string {
  const find = (candidate: unknown, depth = 0): string | null => {
    if (depth > 8 || candidate == null) return null;
    if (candidate instanceof Error) return candidate.message.slice(0, 1_000);
    if (typeof candidate === "string") {
      if (candidate.length < 1_200 && !candidate.trimStart().startsWith("{")) return candidate;
      try {
        return find(JSON.parse(candidate), depth + 1);
      } catch {
        const match = candidate.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/);
        return match?.[1] ? JSON.parse(`"${match[1]}"`) : null;
      }
    }
    if (typeof candidate !== "object") return null;
    const record = candidate as Record<string, unknown>;
    for (const key of ["message", "payload", "error", "data", "cause"]) {
      const found = find(record[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return (find(value) ?? "The model provider returned an unknown error.")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .slice(0, 1_000);
}
