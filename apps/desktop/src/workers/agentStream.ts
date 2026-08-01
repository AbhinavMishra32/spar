export type NormalizedAgentStreamPart = {
  type: "text" | "tool" | "status" | "error";
  text: string;
  tool?: string;
  detail?: string;
};

/**
 * Mastra's public stream wraps model deltas in `payload.text`. Older AI SDK
 * stream shapes exposed `textDelta` directly, so accept both without ever
 * coercing an unknown object into learner-visible text.
 */
export function normalizeAgentStreamPart(part: Record<string, unknown>): NormalizedAgentStreamPart {
  const type = String(part.type);
  if (type === "text-delta") return { type: "text", text: textDelta(part) };
  if (type === "error") return { type: "error", text: errorText(part.error ?? part) };

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
